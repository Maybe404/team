# [team 二开] 文档公开只读链接：文档作者、工作区管理员、项目管理员、项目负责人能开、能关；项目成员能看到链接。
# 只走网页登录态（session），Agent 的 API Token 调不到这里，公开出去的内容由人决定。
from rest_framework import status
from rest_framework.response import Response

from plane.app.views.base import BaseAPIView
from plane.utils.team_page_tree import descendant_ids
from plane.db.models import Page, Project, ProjectMember, TeamPageShare, WorkspaceMember


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

    def _can_manage(self, request, slug, project_id, page_id):
        user = request.user
        if self._is_admin(request, slug):
            return True
        if Page.objects.filter(pk=page_id, owned_by=user).exists() and ProjectMember.objects.filter(
            project_id=project_id, member=user, is_active=True
        ).exists():
            return True
        if ProjectMember.objects.filter(project_id=project_id, member=user, is_active=True, role=20).exists():
            return True
        return Project.objects.filter(pk=project_id, project_lead=user).exists()

    def _payload(self, request, slug, project_id, page_id, share):
        ids = descendant_ids(page_id, project_id)
        return {
            "anchor": share.anchor if share else None,
            "children_total": len(ids),
            "children_shared": TeamPageShare.objects.filter(page_id__in=ids, project_id=project_id).count() if ids else 0,
            "can_manage": self._can_manage(request, slug, project_id, page_id),
        }

    def get(self, request, slug, project_id, page_id):
        if not ProjectMember.objects.filter(
            project_id=project_id, member=request.user, is_active=True
        ).exists() and not self._is_admin(request, slug):
            return Response({"error": "没有权限"}, status=status.HTTP_403_FORBIDDEN)
        share = TeamPageShare.objects.filter(page_id=page_id, project_id=project_id).first()
        return Response(self._payload(request, slug, project_id, page_id, share))

    def post(self, request, slug, project_id, page_id):
        if not self._can_manage(request, slug, project_id, page_id):
            return Response({"error": "只有文档作者、项目管理员、项目负责人或工作区管理员能公开文档"}, status=status.HTTP_403_FORBIDDEN)
        page = self._page(slug, project_id, page_id)
        if not page:
            return Response({"error": "文档不存在"}, status=status.HTTP_404_NOT_FOUND)
        if page.access != Page.PUBLIC_ACCESS:
            return Response({"error": "私有文档不能公开，先把它改成项目内公开"}, status=status.HTTP_400_BAD_REQUEST)
        if page.archived_at:
            return Response({"error": "已归档的文档不能公开"}, status=status.HTTP_400_BAD_REQUEST)
        share, _ = TeamPageShare.objects.get_or_create(page=page, project_id=project_id)
        # 「同时公开子页面」：只公开项目内公开、未归档、且当前用户有权限管理的子页面；私有的子页面保持私有
        if str(request.data.get("include_children")).lower() in ("1", "true", "yes"):
            for child in Page.objects.filter(
                pk__in=descendant_ids(page.id, project_id), access=Page.PUBLIC_ACCESS, archived_at__isnull=True
            ):
                if self._can_manage(request, slug, project_id, child.id):
                    TeamPageShare.objects.get_or_create(page=child, project_id=project_id)
        return Response(self._payload(request, slug, project_id, page_id, share), status=status.HTTP_200_OK)

    def delete(self, request, slug, project_id, page_id):
        if not self._can_manage(request, slug, project_id, page_id):
            return Response({"error": "只有文档作者、项目管理员、项目负责人或工作区管理员能关闭公开链接"}, status=status.HTTP_403_FORBIDDEN)
        # 真删：关掉后旧链接立即失效，重新打开会生成新链接
        TeamPageShare.all_objects.filter(page_id=page_id, project_id=project_id).delete()
        if str(request.query_params.get("include_children")).lower() in ("1", "true", "yes"):
            for cid in descendant_ids(page_id, project_id):
                if self._can_manage(request, slug, project_id, cid):
                    TeamPageShare.all_objects.filter(page_id=cid, project_id=project_id).delete()
        return Response(self._payload(request, slug, project_id, page_id, None))
