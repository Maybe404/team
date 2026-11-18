# [team 二开] 编辑权限接口（网页用会话、Agent 用 API Token，逻辑相同，见 utils/team_access.py）
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
