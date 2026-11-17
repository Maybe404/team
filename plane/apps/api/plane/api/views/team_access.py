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
