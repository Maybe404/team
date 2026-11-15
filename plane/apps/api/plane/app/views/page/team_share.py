# [team 二开] 文档公开只读链接：只有工作区管理员能开、能关；项目成员能看到链接。
# 只走网页登录态（session），Agent 的 API Token 调不到这里，公开出去的内容由人决定。
from rest_framework import status
from rest_framework.response import Response

from plane.app.views.base import BaseAPIView
from plane.db.models import Page, ProjectMember, TeamPageShare, WorkspaceMember


class TeamPageShareEndpoint(BaseAPIView):
    def _page(self, slug, project_id, page_id):
        return Page.objects.filter(
            pk=page_id,
            workspace__slug=slug,
            project_pages__project_id=project_id,
            project_pages__deleted_at__isnull=True,
        ).first()

    def _is_admin(self, request, slug):
        return WorkspaceMember.objects.filter(
            workspace__slug=slug, member=request.user, is_active=True, role=20
        ).exists()

    def _payload(self, request, slug, share):
        return {"anchor": share.anchor if share else None, "can_manage": self._is_admin(request, slug)}

    def get(self, request, slug, project_id, page_id):
        if not ProjectMember.objects.filter(
            project_id=project_id, member=request.user, is_active=True
        ).exists() and not self._is_admin(request, slug):
            return Response({"error": "没有权限"}, status=status.HTTP_403_FORBIDDEN)
        share = TeamPageShare.objects.filter(page_id=page_id, project_id=project_id).first()
        return Response(self._payload(request, slug, share))

    def post(self, request, slug, project_id, page_id):
        if not self._is_admin(request, slug):
            return Response({"error": "只有工作区管理员能公开文档"}, status=status.HTTP_403_FORBIDDEN)
        page = self._page(slug, project_id, page_id)
        if not page:
            return Response({"error": "文档不存在"}, status=status.HTTP_404_NOT_FOUND)
        if page.access != Page.PUBLIC_ACCESS:
            return Response({"error": "私有文档不能公开，先把它改成项目内公开"}, status=status.HTTP_400_BAD_REQUEST)
        if page.archived_at:
            return Response({"error": "已归档的文档不能公开"}, status=status.HTTP_400_BAD_REQUEST)
        share, _ = TeamPageShare.objects.get_or_create(page=page, project_id=project_id)
        return Response(self._payload(request, slug, share), status=status.HTTP_200_OK)

    def delete(self, request, slug, project_id, page_id):
        if not self._is_admin(request, slug):
            return Response({"error": "只有工作区管理员能关闭公开链接"}, status=status.HTTP_403_FORBIDDEN)
        # 真删：关掉后旧链接立即失效，重新打开会生成新链接
        TeamPageShare.all_objects.filter(page_id=page_id, project_id=project_id).delete()
        return Response(self._payload(request, slug, None))
