# [team 二开] 文档和工作项关联的业务逻辑，网页接口（session）和 API（Token）共用。
from django.db.models import Q

from plane.db.models import Issue, Page, ProjectMember, TeamPageIssue
from plane.utils.team_page_tree import hidden_page_ids
from plane.utils.team_edit_policy import can_edit_issue, can_edit_page, is_workspace_admin

LINK_FORBIDDEN = "只有工作项的创建人、指派人、文档作者或管理员能建立关联。"


def can_view_project(user, project_id, workspace_id) -> bool:
    return ProjectMember.objects.filter(project_id=project_id, member=user, is_active=True).exists() or is_workspace_admin(
        user, workspace_id
    )


def visible_pages(user, slug, project_id):
    return Page.objects.filter(
        Q(owned_by=user) | Q(access=Page.PUBLIC_ACCESS),
        workspace__slug=slug,
        project_pages__project_id=project_id,
        project_pages__deleted_at__isnull=True,
    ).exclude(id__in=hidden_page_ids(user, project_id))


def pages_of_issue(user, slug, project_id, issue_id):
    qs = (
        TeamPageIssue.objects.filter(issue_id=issue_id, project_id=project_id, page__in=visible_pages(user, slug, project_id))
        .select_related("page", "page__owned_by")
        .order_by("-created_at")
    )
    return [
        {
            "id": str(l.page_id),
            "name": l.page.name,
            "owned_by": l.page.owned_by.display_name if l.page.owned_by_id else "",
            "access": l.page.access,
            "archived": bool(l.page.archived_at),
            "updated_at": l.page.updated_at.isoformat(),
        }
        for l in qs
    ]


def issues_of_page(page_id, project_id):
    qs = (
        TeamPageIssue.objects.filter(page_id=page_id, project_id=project_id)
        .select_related("issue", "issue__state", "issue__project")
        .order_by("-created_at")
    )
    return [
        {
            "id": str(l.issue_id),
            "sequence_id": l.issue.sequence_id,
            "key": f"{l.issue.project.identifier}-{l.issue.sequence_id}",
            "name": l.issue.name,
            "state": l.issue.state.name if l.issue.state_id else "",
            "project_id": str(l.project_id),
        }
        for l in qs
    ]


def link(user, project_id, issue: Issue, page: Page):
    """返回 (ok, error)。工作项和文档必须在同一个项目；创建人、指派人、文档作者或管理员才能关联。"""
    if str(issue.project_id) != str(project_id):
        return False, "工作项不在这个项目里"
    if not (can_edit_issue(user, issue) or can_edit_page(user, page)):
        return False, LINK_FORBIDDEN
    TeamPageIssue.objects.get_or_create(page=page, issue=issue, project_id=project_id, workspace_id=issue.workspace_id)
    return True, None


def unlink(user, project_id, issue: Issue, page: Page):
    if not (can_edit_issue(user, issue) or can_edit_page(user, page)):
        return False, LINK_FORBIDDEN
    TeamPageIssue.all_objects.filter(page=page, issue=issue, project_id=project_id).delete()
    return True, None
