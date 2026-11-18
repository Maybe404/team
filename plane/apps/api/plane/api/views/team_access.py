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
