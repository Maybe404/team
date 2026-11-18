# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.db.models import (
    IssueVersion,
    IssueDescriptionVersion,
    Project,
    ProjectMember,
    Issue,
)
from ..base import BaseAPIView
from plane.app.serializers import (
    IssueVersionDetailSerializer,
    IssueDescriptionVersionDetailSerializer,
)
from plane.app.permissions import allow_permission, issue_hidden_from_guest, ROLE
from plane.utils.global_paginator import paginate
from plane.utils.timezone_converter import user_timezone_converter


class IssueVersionEndpoint(BaseAPIView):
    def process_paginated_result(self, fields, results, timezone):
        paginated_data = results.values(*fields)

        datetime_fields = ["created_at", "updated_at"]
        paginated_data = user_timezone_converter(paginated_data, datetime_fields, timezone)

        return paginated_data

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id, issue_id, pk=None):
        # A restricted guest may only see the versions of issues they created,
        # mirroring the issue-detail visibility rule.
        if issue_hidden_from_guest(request, slug, project_id, issue_id):
            return Response(
                {"error": "You are not allowed to view this issue"},
                status=status.HTTP_403_FORBIDDEN,
            )
        if pk:
            issue_version = IssueVersion.objects.get(
                workspace__slug=slug, project_id=project_id, issue_id=issue_id, pk=pk
            )

            serializer = IssueVersionDetailSerializer(issue_version)
            return Response(serializer.data, status=status.HTTP_200_OK)

        cursor = request.GET.get("cursor", None)

        required_fields = [
            "id",
            "workspace",
            "project",
            "issue",
            "last_saved_at",
            "owned_by",
            "created_at",
            "updated_at",
            "created_by",
            "updated_by",
        ]

        issue_versions_queryset = IssueVersion.objects.filter(
            workspace__slug=slug, project_id=project_id, issue_id=issue_id
        )

        paginated_data = paginate(
            base_queryset=issue_versions_queryset,
            queryset=issue_versions_queryset,
            cursor=cursor,
            on_result=lambda results: self.process_paginated_result(
                required_fields, results, request.user.user_timezone
            ),
        )

        return Response(paginated_data, status=status.HTTP_200_OK)


class WorkItemDescriptionVersionEndpoint(BaseAPIView):
    def process_paginated_result(self, fields, results, timezone):
        paginated_data = results.values(*fields)

        datetime_fields = ["created_at", "updated_at"]
        paginated_data = user_timezone_converter(paginated_data, datetime_fields, timezone)

        return paginated_data

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id, work_item_id, pk=None):
        project = Project.objects.get(pk=project_id)
        issue = Issue.objects.get(workspace__slug=slug, project_id=project_id, pk=work_item_id)

        if (
            ProjectMember.objects.filter(
                workspace__slug=slug,
                project_id=project_id,
                member=request.user,
                role=ROLE.GUEST.value,
                is_active=True,
            ).exists()
            and not project.guest_view_all_features
            and not issue.created_by == request.user
        ):
            return Response(
                {"error": "You are not allowed to view this issue"},
                status=status.HTTP_403_FORBIDDEN,
            )

        if pk:
            issue_description_version = IssueDescriptionVersion.objects.get(
                workspace__slug=slug,
                project_id=project_id,
                issue_id=work_item_id,
                pk=pk,
            )

            serializer = IssueDescriptionVersionDetailSerializer(issue_description_version)
            return Response(serializer.data, status=status.HTTP_200_OK)

        cursor = request.GET.get("cursor", None)

        required_fields = [
            "id",
            "workspace",
            "project",
            "issue",
            "last_saved_at",
            "owned_by",
            "is_locked",
            "label",
            "source",
            "created_at",
            "updated_at",
            "created_by",
            "updated_by",
        ]

        issue_description_versions_queryset = IssueDescriptionVersion.objects.filter(
            workspace__slug=slug, project_id=project_id, issue_id=work_item_id
        ).order_by("-last_saved_at")
        paginated_data = paginate(
            base_queryset=issue_description_versions_queryset,
            queryset=issue_description_versions_queryset,
            cursor=cursor,
            on_result=lambda results: self.process_paginated_result(
                required_fields, results, request.user.user_timezone
            ),
        )
        return Response(paginated_data, status=status.HTTP_200_OK)

    # [team 二开] 网页上保存快照、命名、锁定（和文档版本一致）
    def _editable_issue(self, request, slug, project_id, work_item_id):
        from plane.utils.team_edit_policy import can_edit_issue

        issue = Issue.objects.filter(workspace__slug=slug, project_id=project_id, pk=work_item_id).first()
        if issue is None:
            return None, Response({"error": "工作项不存在"}, status=status.HTTP_404_NOT_FOUND)
        if issue_hidden_from_guest(request, slug, project_id, work_item_id) or not can_edit_issue(request.user, issue):
            return None, Response({"error": "没有编辑权限"}, status=status.HTTP_403_FORBIDDEN)
        return issue, None

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def post(self, request, slug, project_id, work_item_id, pk=None):
        from plane.utils import team_issue_version as iv

        issue, err = self._editable_issue(request, slug, project_id, work_item_id)
        if err:
            return err
        src = "before-restore" if request.data.get("source") == "before-restore" else "manual"
        v, created = iv.snapshot_current(issue, request.user, label=request.data.get("label") or "", lock=bool(request.data.get("lock")), source=src)
        return Response({**iv.version_dict(v), "created": created})

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def patch(self, request, slug, project_id, work_item_id, pk=None):
        from plane.utils import team_issue_version as iv

        issue, err = self._editable_issue(request, slug, project_id, work_item_id)
        if err:
            return err
        v = IssueDescriptionVersion.objects.filter(issue_id=work_item_id, pk=pk).first() if pk else None
        if v is None:
            return Response({"error": "版本不存在"}, status=status.HTTP_404_NOT_FOUND)
        fields = ["updated_at"]
        if "is_locked" in request.data:
            v.is_locked = bool(request.data["is_locked"])
            fields.append("is_locked")
        if "label" in request.data:
            v.label = str(request.data["label"] or "")[:255]
            fields.append("label")
        v.save(update_fields=fields)
        return Response(iv.version_dict(v))
