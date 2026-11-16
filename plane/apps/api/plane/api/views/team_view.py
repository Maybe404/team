# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.
#
# [team 二开] 用 API Token 读写项目视图（保存下来的筛选）。社区版的 /api/v1 没有视图接口。
# 只做列表、新建、修改；删除由人在网页上做。改视图只有创建人和工作区管理员能改。
from django.db.models import Q
from rest_framework import status
from rest_framework.response import Response

from plane.app.permissions import ProjectEntityPermission
from plane.db.models import IssueView, Project
from plane.db.models.view import get_default_display_filters
from plane.utils.team_edit_policy import is_workspace_admin

from .base import BaseAPIView

LAYOUTS = {"list", "kanban", "calendar", "spreadsheet", "gantt_chart"}
ORDER_BYS = {
    "-created_at", "created_at", "-updated_at", "updated_at", "-priority", "priority",
    "sort_order", "-start_date", "start_date", "-target_date", "target_date",
}
GROUP_BYS = {None, "state", "priority", "labels", "assignees", "created_by", "state_detail.group", "cycle", "module"}


def serialize_view(v):
    return {
        "id": str(v.id),
        "name": v.name,
        "description": v.description,
        "rich_filters": v.rich_filters,
        "display_filters": v.display_filters,
        "access": v.access,
        "owned_by_id": str(v.owned_by_id),
        "is_locked": v.is_locked,
        "updated_at": v.updated_at.isoformat(),
    }


def clean_display(raw, base):
    """只接受已知的布局、分组、排序，其余字段保持原样，避免写进网页不认识的值。"""
    out = dict(base or {})
    if not isinstance(raw, dict):
        return out, None
    if "layout" in raw:
        if raw["layout"] not in LAYOUTS:
            return None, f"layout 只能是 {sorted(LAYOUTS)}"
        out["layout"] = raw["layout"]
    if "group_by" in raw:
        if raw["group_by"] not in GROUP_BYS:
            return None, f"group_by 只能是 {sorted(x for x in GROUP_BYS if x)} 或 null"
        out["group_by"] = raw["group_by"]
    if "order_by" in raw:
        if raw["order_by"] not in ORDER_BYS:
            return None, f"order_by 只能是 {sorted(ORDER_BYS)}"
        out["order_by"] = raw["order_by"]
    return out, None


def valid_rich_filters(value):
    """rich_filters 的形状：{} 或 {"and": [{"state_id__in": "id1,id2"}, ...]}。"""
    if value in ({}, None):
        return True
    if not isinstance(value, dict) or set(value) != {"and"} or not isinstance(value["and"], list):
        return False
    return all(isinstance(c, dict) and len(c) == 1 and "__" in next(iter(c)) for c in value["and"])


FEATURE_OFF = "这个项目没有开启「视图」功能。请项目管理员在网页上打开：项目设置 → 功能 → 视图。"


class TeamViewBase(BaseAPIView):
    permission_classes = [ProjectEntityPermission]

    def feature_off(self, slug, project_id):
        return not Project.objects.filter(pk=project_id, workspace__slug=slug, issue_views_view=True).exists()

    def visible(self, slug, project_id):
        return IssueView.objects.filter(
            workspace__slug=slug,
            project_id=project_id,
            archived_at__isnull=True,
            project__project_projectmember__member=self.request.user,
            project__project_projectmember__is_active=True,
        ).filter(Q(owned_by=self.request.user) | Q(access=1)).distinct()


class TeamViewListCreateAPIEndpoint(TeamViewBase):
    def get(self, request, slug, project_id):
        if self.feature_off(slug, project_id):
            return Response({"error": FEATURE_OFF}, status=status.HTTP_400_BAD_REQUEST)
        views = self.visible(slug, project_id).order_by("name")
        return Response([serialize_view(v) for v in views])

    def post(self, request, slug, project_id):
        if self.feature_off(slug, project_id):
            return Response({"error": FEATURE_OFF}, status=status.HTTP_400_BAD_REQUEST)
        name = (request.data.get("name") or "").strip()
        if not name:
            return Response({"error": "name 不能为空"}, status=status.HTTP_400_BAD_REQUEST)
        rich = request.data.get("rich_filters") or {}
        if not valid_rich_filters(rich):
            return Response({"error": "rich_filters 格式不对"}, status=status.HTTP_400_BAD_REQUEST)
        display, err = clean_display(request.data.get("display_filters"), get_default_display_filters())
        if err:
            return Response({"error": err}, status=status.HTTP_400_BAD_REQUEST)
        project = Project.objects.get(pk=project_id, workspace__slug=slug)
        view = IssueView.objects.create(
            name=name,
            description=request.data.get("description") or "",
            project=project,
            workspace_id=project.workspace_id,
            owned_by=request.user,
            rich_filters=rich,
            display_filters=display,
            filters={},
        )
        return Response(serialize_view(view), status=status.HTTP_201_CREATED)


class TeamViewDetailAPIEndpoint(TeamViewBase):
    def patch(self, request, slug, project_id, pk):
        view = self.visible(slug, project_id).filter(pk=pk).first()
        if not view:
            return Response({"error": "视图不存在"}, status=status.HTTP_404_NOT_FOUND)
        if view.owned_by_id != request.user.id and not is_workspace_admin(request.user, view.workspace_id):
            return Response(
                {"error": "这是别人的视图，只有创建人或管理员能改。"}, status=status.HTTP_403_FORBIDDEN
            )
        if view.is_locked:
            return Response({"error": "视图已锁定，请先在网页上解锁。"}, status=status.HTTP_400_BAD_REQUEST)
        if "name" in request.data:
            name = (request.data.get("name") or "").strip()
            if not name:
                return Response({"error": "name 不能为空"}, status=status.HTTP_400_BAD_REQUEST)
            view.name = name
        if "description" in request.data:
            view.description = request.data.get("description") or ""
        if "rich_filters" in request.data:
            rich = request.data.get("rich_filters") or {}
            if not valid_rich_filters(rich):
                return Response({"error": "rich_filters 格式不对"}, status=status.HTTP_400_BAD_REQUEST)
            view.rich_filters = rich
        if "display_filters" in request.data:
            display, err = clean_display(request.data.get("display_filters"), view.display_filters)
            if err:
                return Response({"error": err}, status=status.HTTP_400_BAD_REQUEST)
            view.display_filters = display
        view.save()
        return Response(serialize_view(view))
