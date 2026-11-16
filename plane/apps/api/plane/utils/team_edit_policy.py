# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# [team 二开] 编辑权限：自己的自己改，别人的只能评论。
#
# - 工作项：创建人、当前指派人、工作区管理员能改；其他成员只能评论。
# - 文档（Page）：作者和工作区管理员能改；其他成员只能阅读和评论。
# - 工作区管理员什么都能改。Agent 用 API Token，按 Token 所属账号同样受限。
#
# 在视图基类 initial() 里检查（见 team_delete_guard.enforce_delete_policy），网页和 API 都会经过。
from rest_framework.exceptions import PermissionDenied

from plane.db.models import Issue, IssueAssignee, Page, WorkspaceMember

ADMIN_ROLE = 20

ISSUE_MESSAGE = "这是别人的工作项，你只能评论。需要修改请让创建人或指派人来改，或请管理员处理。"
PAGE_MESSAGE = "这是别人的文档，你只能阅读和评论。需要修改请让作者来改，或请管理员处理。"

# 视图类名 -> (URL 里的对象 ID 参数名, 需要检查的 HTTP 方法)
ISSUE_EDIT_VIEWS = {
    "IssueViewSet": ("pk", {"PATCH", "PUT"}),
    "IssueDetailAPIEndpoint": ("pk", {"PATCH", "PUT"}),
}
PAGE_EDIT_VIEWS = {
    "PageViewSet": ("page_id", {"PATCH", "PUT"}),
    "PagesDescriptionViewSet": ("page_id", {"PATCH", "PUT"}),
    "TeamPageDetailAPIEndpoint": ("pk", {"PATCH", "PUT"}),
}


def is_workspace_admin(user, workspace_id) -> bool:
    return WorkspaceMember.objects.filter(workspace_id=workspace_id, member=user, role=ADMIN_ROLE, is_active=True).exists()


def can_edit_issue(user, issue) -> bool:
    if issue.created_by_id == user.id:
        return True
    if IssueAssignee.objects.filter(issue_id=issue.id, assignee=user).exists():
        return True
    return is_workspace_admin(user, issue.workspace_id)


def can_edit_page(user, page) -> bool:
    return page.owned_by_id == user.id or is_workspace_admin(user, page.workspace_id)


def enforce_edit_policy(view, request, kwargs):
    name = view.__class__.__name__
    user = request.user
    if not getattr(user, "is_authenticated", False):
        return
    if name in ISSUE_EDIT_VIEWS:
        param, methods = ISSUE_EDIT_VIEWS[name]
        if request.method in methods and kwargs.get(param):
            issue = Issue.objects.filter(pk=kwargs[param]).only("id", "created_by_id", "workspace_id").first()
            if issue and not can_edit_issue(user, issue):
                raise PermissionDenied(ISSUE_MESSAGE)
    elif name in PAGE_EDIT_VIEWS:
        param, methods = PAGE_EDIT_VIEWS[name]
        if request.method in methods and kwargs.get(param):
            page = Page.objects.filter(pk=kwargs[param]).only("id", "owned_by_id", "workspace_id").first()
            if page and not can_edit_page(user, page):
                raise PermissionDenied(PAGE_MESSAGE)
