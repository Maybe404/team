# [team 二开] 网页用的统一搜索（会话认证），逻辑和 api/v1 的 team-search 相同
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from plane.app.views.base import BaseAPIView
from plane.db.models import WorkspaceMember
from plane.utils.team_search import team_search


class TeamSearchEndpoint(BaseAPIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, slug):
        if not WorkspaceMember.objects.filter(workspace__slug=slug, member=request.user, is_active=True).exists():
            return Response({"error": "找不到这个工作区"}, status=404)
        q = (request.query_params.get("q") or "").strip()
        if not q:
            return Response({"error": "需要 q 参数"}, status=400)
        types = [t for t in (request.query_params.get("types") or "page,issue").split(",") if t in ("page", "issue")] or ["page", "issue"]
        raw = request.query_params.get("project")
        pids = None if raw is None else [p for p in raw.split(",") if p]
        return Response(team_search(request.user, slug, q, tuple(types), pids, request.query_params.get("limit") or 30))


class TeamTemplateEndpoint(BaseAPIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, slug, template_id=None):
        from plane.utils.team_template import handle_templates

        return handle_templates(request, slug, template_id)

    post = patch = delete = get
