# [team 二开] 文档 ↔ 工作项关联（网页，session 登录）。工作项页和文档页各有一个入口，数据是同一张表。
from rest_framework import status
from rest_framework.response import Response

from plane.app.views.base import BaseAPIView
from plane.db.models import Issue, Page
from plane.utils.team_page_tree import descendant_ids
from plane.utils.team_page_issue import can_view_project, issues_of_page, link, pages_of_issue, unlink, visible_pages


class _Base(BaseAPIView):
    def _issue(self, slug, project_id, issue_id):
        return Issue.objects.filter(pk=issue_id, workspace__slug=slug, project_id=project_id).first()

    def _page(self, request, slug, project_id, page_id):
        return visible_pages(request.user, slug, project_id).filter(pk=page_id).first()

    def _deny(self, request, slug, project_id):
        from plane.db.models import Workspace

        ws = Workspace.objects.filter(slug=slug).first()
        if not ws or not can_view_project(request.user, project_id, ws.id):
            return Response({"error": "没有权限"}, status=status.HTTP_403_FORBIDDEN)
        return None


class TeamIssuePagesEndpoint(_Base):
    """工作项这一侧：列出关联的文档、关联、取消关联。"""

    def get(self, request, slug, project_id, issue_id):
        if (r := self._deny(request, slug, project_id)) is not None:
            return r
        return Response(pages_of_issue(request.user, slug, project_id, issue_id))

    def post(self, request, slug, project_id, issue_id):
        if (r := self._deny(request, slug, project_id)) is not None:
            return r
        issue = self._issue(slug, project_id, issue_id)
        page = self._page(request, slug, project_id, request.data.get("page_id"))
        if not issue or not page:
            return Response({"error": "工作项或文档不存在"}, status=status.HTTP_404_NOT_FOUND)
        ok, err = link(request.user, project_id, issue, page)
        if not ok:
            return Response({"error": err}, status=status.HTTP_403_FORBIDDEN)
        return Response(pages_of_issue(request.user, slug, project_id, issue_id), status=status.HTTP_201_CREATED)

    def delete(self, request, slug, project_id, issue_id):
        if (r := self._deny(request, slug, project_id)) is not None:
            return r
        issue = self._issue(slug, project_id, issue_id)
        page = self._page(request, slug, project_id, request.query_params.get("page_id"))
        if not issue or not page:
            return Response({"error": "工作项或文档不存在"}, status=status.HTTP_404_NOT_FOUND)
        ok, err = unlink(request.user, project_id, issue, page)
        if not ok:
            return Response({"error": err}, status=status.HTTP_403_FORBIDDEN)
        return Response(pages_of_issue(request.user, slug, project_id, issue_id))


def _children(request, slug, project_id, page_id, flag):
    """「同时处理子页面」：返回当前用户看得到的所有后代页面。"""
    if str(flag).lower() not in ("1", "true", "yes"):
        return []
    ids = descendant_ids(page_id, project_id)
    return list(visible_pages(request.user, slug, project_id).filter(pk__in=ids))


class TeamPageIssuesEndpoint(_Base):
    """文档这一侧：列出关联的工作项、关联、取消关联。"""

    def get(self, request, slug, project_id, page_id):
        if (r := self._deny(request, slug, project_id)) is not None:
            return r
        if not self._page(request, slug, project_id, page_id):
            return Response({"error": "文档不存在"}, status=status.HTTP_404_NOT_FOUND)
        return Response(issues_of_page(page_id, project_id))

    def post(self, request, slug, project_id, page_id):
        if (r := self._deny(request, slug, project_id)) is not None:
            return r
        page = self._page(request, slug, project_id, page_id)
        issue = self._issue(slug, project_id, request.data.get("issue_id"))
        if not issue or not page:
            return Response({"error": "工作项或文档不存在"}, status=status.HTTP_404_NOT_FOUND)
        ok, err = link(request.user, project_id, issue, page)
        if not ok:
            return Response({"error": err}, status=status.HTTP_403_FORBIDDEN)
        for child in _children(request, slug, project_id, page_id, request.data.get("include_children")):
            link(request.user, project_id, issue, child)
        return Response(issues_of_page(page_id, project_id), status=status.HTTP_201_CREATED)

    def delete(self, request, slug, project_id, page_id):
        if (r := self._deny(request, slug, project_id)) is not None:
            return r
        page = self._page(request, slug, project_id, page_id)
        issue = self._issue(slug, project_id, request.query_params.get("issue_id"))
        if not issue or not page:
            return Response({"error": "工作项或文档不存在"}, status=status.HTTP_404_NOT_FOUND)
        ok, err = unlink(request.user, project_id, issue, page)
        if not ok:
            return Response({"error": err}, status=status.HTTP_403_FORBIDDEN)
        for child in _children(request, slug, project_id, page_id, request.query_params.get("include_children")):
            unlink(request.user, project_id, issue, child)
        return Response(issues_of_page(page_id, project_id))


class TeamLinkCandidatesEndpoint(_Base):
    """关联弹窗的候选列表：不输入时按最近更新排序（推荐），输入后按标题模糊搜索，工作项还能按编号搜。"""

    def get(self, request, slug, project_id):
        import re

        from django.db.models import Q

        if (r := self._deny(request, slug, project_id)) is not None:
            return r
        kind = request.query_params.get("kind")
        q = (request.query_params.get("q") or "").strip()
        if kind == "pages":
            qs = visible_pages(request.user, slug, project_id).filter(archived_at__isnull=True).select_related("owned_by")
            if q:
                qs = qs.filter(name__icontains=q)
            return Response(
                [
                    {
                        "id": str(p.id),
                        "name": p.name,
                        "meta": p.owned_by.display_name if p.owned_by_id else "",
                        "updated_at": p.updated_at.isoformat(),
                    }
                    for p in qs.order_by("-updated_at")[:50]
                ]
            )
        if kind == "issues":
            qs = Issue.issue_objects.filter(workspace__slug=slug, project_id=project_id).select_related("state", "project")
            if q:
                cond = Q(name__icontains=q)
                m = re.search(r"(\d+)$", q)
                if m:
                    cond |= Q(sequence_id=int(m.group(1)))
                qs = qs.filter(cond)
            return Response(
                [
                    {
                        "id": str(i.id),
                        "name": i.name,
                        "key": f"{i.project.identifier}-{i.sequence_id}",
                        "meta": i.state.name if i.state_id else "",
                        "updated_at": i.updated_at.isoformat(),
                    }
                    for i in qs.order_by("-updated_at")[:50]
                ]
            )
        return Response({"error": "kind 只能是 pages 或 issues"}, status=status.HTTP_400_BAD_REQUEST)
