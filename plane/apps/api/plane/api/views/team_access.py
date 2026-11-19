# [team 二开] 编辑权限接口（网页用会话、Agent 用 API Token，逻辑相同，见 utils/team_access.py）
import uuid

from django.core.exceptions import ValidationError

from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from plane.utils.team_access import handle_access, pending_for_user
from plane.api.views.base import BaseAPIView


class TeamAccessAPIEndpoint(BaseAPIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, slug, entity_type, entity_id):
        return handle_access(request, slug, entity_type, entity_id)

    def post(self, request, slug, entity_type, entity_id):
        return handle_access(request, slug, entity_type, entity_id)


class TeamAccessPendingAPIEndpoint(BaseAPIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, slug):
        return Response(pending_for_user(request.user, slug))


class TeamSearchAPIEndpoint(BaseAPIView):
    """跨项目、跨文档统一搜索：?q=关键词&types=page,issue&project=项目ID（可多个，逗号分隔）&limit=20"""

    permission_classes = [IsAuthenticated]

    def get(self, request, slug):
        from plane.db.models import WorkspaceMember
        from plane.utils.team_search import team_search

        if not WorkspaceMember.objects.filter(workspace__slug=slug, member=request.user, is_active=True).exists():
            return Response({"error": "找不到这个工作区"}, status=404)
        q = (request.query_params.get("q") or "").strip()
        if not q:
            return Response({"error": "需要 q 参数"}, status=400)
        types = [t for t in (request.query_params.get("types") or "page,issue").split(",") if t in ("page", "issue")] or ["page", "issue"]
        raw_pids = request.query_params.get("project")
        # 参数存在但为空表示「没有可搜的项目」，不能当成不限范围
        pids = None if raw_pids is None else [p for p in raw_pids.split(",") if p]
        return Response(team_search(request.user, slug, q, tuple(types), pids, request.query_params.get("limit") or 20))


class TeamProjectSettingsAPIEndpoint(BaseAPIView):
    """项目的置顶（每人自己的）和图标（项目管理员）。PATCH {is_pinned?, logo_props?}；logo_props 传 {} 表示移除图标。"""

    permission_classes = [IsAuthenticated]

    def _member(self, request, slug, project_id):
        from plane.db.models import ProjectMember

        return ProjectMember.objects.filter(
            workspace__slug=slug, project_id=project_id, member=request.user, is_active=True
        ).first()

    def get(self, request, slug, project_id):
        from plane.db.models import Project, ProjectUserProperty

        if self._member(request, slug, project_id) is None:
            return Response({"error": "找不到这个项目"}, status=404)
        project = Project.objects.get(pk=project_id)
        prop = ProjectUserProperty.objects.filter(project_id=project_id, user=request.user).first()
        return Response({"is_pinned": bool(prop and prop.is_pinned), "logo_props": project.logo_props or {}})

    def patch(self, request, slug, project_id):
        from plane.db.models import Project, ProjectUserProperty

        member = self._member(request, slug, project_id)
        if member is None:
            return Response({"error": "找不到这个项目"}, status=404)
        project = Project.objects.get(pk=project_id)
        if "is_pinned" in request.data:
            prop, _ = ProjectUserProperty.objects.get_or_create(
                project_id=project_id, user=request.user, defaults={"workspace_id": project.workspace_id}
            )
            prop.is_pinned = bool(request.data["is_pinned"])
            prop.save(update_fields=["is_pinned", "updated_at"])
        if "logo_props" in request.data:
            if member.role < 20:
                return Response({"error": "只有项目管理员能改项目图标"}, status=403)
            logo = request.data["logo_props"] or {}
            if logo:
                use = logo.get("in_use")
                if use == "emoji" and isinstance(logo.get("emoji"), dict) and logo["emoji"].get("value"):
                    logo = {"in_use": "emoji", "emoji": {"value": str(logo["emoji"]["value"])}}
                elif use == "icon" and isinstance(logo.get("icon"), dict) and logo["icon"].get("name"):
                    logo = {"in_use": "icon", "icon": {"name": str(logo["icon"]["name"]), "color": str(logo["icon"].get("color") or "#6d7b8a")}}
                else:
                    return Response({"error": "logo_props 格式不对"}, status=400)
            project.logo_props = logo
            project.save(update_fields=["logo_props", "updated_at"])
        prop = ProjectUserProperty.objects.filter(project_id=project_id, user=request.user).first()
        return Response({"is_pinned": bool(prop and prop.is_pinned), "logo_props": project.logo_props or {}})


class TeamTemplateAPIEndpoint(BaseAPIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, slug, template_id=None):
        from plane.utils.team_template import handle_templates

        return handle_templates(request, slug, template_id)

    post = patch = get


class TeamArchiveAPIEndpoint(BaseAPIView):
    """[team 二开] 归档 / 取消归档工作项和文档（MCP 用）。POST {"archive": true|false}。
    工作项只能归档已完成或已取消的；规则和网页上一致，拥有者、共同维护人、管理员才能操作。"""

    permission_classes = [IsAuthenticated]

    def post(self, request, slug, project_id, entity_type, entity_id):
        import json
        from datetime import datetime

        from django.core.serializers.json import DjangoJSONEncoder
        from django.utils import timezone

        from plane.api.serializers import IssueSerializer
        from plane.bgtasks.issue_activities_task import issue_activity
        from plane.db.models import Issue, Page, ProjectMember, UserFavorite
        from plane.utils.host import base_host
        from plane.utils.team_edit_policy import can_edit_issue, can_edit_page

        member = ProjectMember.objects.filter(
            workspace__slug=slug, project_id=project_id, member=request.user, is_active=True
        ).first()
        if member is None or member.role < 15:
            return Response({"error": "没有权限"}, status=403)
        archive = bool(request.data.get("archive", True))
        if entity_type == "issue":
            # 已归档的任务按编号查不到，所以也接受序号（如 12）：归档的任务要靠它恢复
            lookup = {"sequence_id": int(entity_id)} if str(entity_id).isdigit() else {"pk": entity_id}
            try:
                issue = Issue.objects.filter(workspace__slug=slug, project_id=project_id, **lookup).first()
            except (ValueError, ValidationError):
                issue = None
            if issue is None:
                return Response({"error": "找不到这个工作项"}, status=404)
            if not can_edit_issue(request.user, issue):
                return Response({"error": "没有编辑权限，不能归档"}, status=403)
            if archive:
                if issue.state is None or issue.state.group not in ("completed", "cancelled"):
                    return Response({"error": "只能归档状态为已完成或已取消的工作项"}, status=400)
                if issue.archived_at:
                    return Response({"archived_at": str(issue.archived_at)})
            elif not issue.archived_at:
                return Response({"archived_at": None})
            issue_activity.delay(
                type="issue.activity.updated",
                requested_data=json.dumps({"archived_at": str(timezone.now().date()) if archive else None, "automation": False}),
                actor_id=str(request.user.id),
                issue_id=str(issue.id),
                project_id=str(project_id),
                current_instance=json.dumps(IssueSerializer(issue).data, cls=DjangoJSONEncoder),
                epoch=int(timezone.now().timestamp()),
                notification=True,
                origin=base_host(request=request, is_app=False),
            )
            issue.archived_at = timezone.now().date() if archive else None
            issue.save()
            return Response({"archived_at": str(issue.archived_at) if issue.archived_at else None})
        if entity_type == "page":
            from plane.app.views.page.base import unarchive_archive_page_and_descendants

            try:
                uuid.UUID(str(entity_id))
            except ValueError:
                return Response({"error": "找不到这篇文档"}, status=404)

            page = Page.objects.filter(
                pk=entity_id, workspace__slug=slug, projects__id=project_id, project_pages__deleted_at__isnull=True
            ).first()
            if page is None or not can_view_page(request.user, page, project_id):
                return Response({"error": "找不到这篇文档"}, status=404)
            if not can_edit_page(request.user, page):
                return Response({"error": "没有编辑权限，不能归档"}, status=403)
            if archive:
                UserFavorite.objects.filter(entity_type="page", entity_identifier=entity_id, project_id=project_id, workspace__slug=slug).delete()
                unarchive_archive_page_and_descendants(entity_id, datetime.now())
                return Response({"archived_at": str(datetime.now())})
            # 父页面已归档时取消归档会打断层级，先摘出来
            if page.parent_id and Page.objects.filter(pk=page.parent_id, archived_at__isnull=False).exists():
                page.parent_id = None
                page.save(update_fields=["parent_id"])
            unarchive_archive_page_and_descendants(entity_id, None)
            return Response({"archived_at": None})
        return Response({"error": "类型只能是 issue 或 page"}, status=400)


def can_view_page(user, page, project_id):
    from plane.utils.team_access import can_view_entity

    return can_view_entity(user, "page", page, project_id=project_id)
