# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# [team 二开] 编辑权限：自己的自己改，别人的只能评论。
#
# - 工作项：创建人、当前指派人、工作区管理员能改；其他成员只能评论。
# - 文档（Page）：作者和工作区管理员能改；其他成员只能阅读和评论。
# - 模块、周期：创建人（模块还包括负责人）、工作区管理员能改名称、状态、日期等；其他成员只能看。
#   把任务放进、移出模块或周期属于日常整理，所有项目成员都可以，不受这条限制。
# - 工作区管理员什么都能改。Agent 用 API Token，按 Token 所属账号同样受限。
#
# 在视图基类 initial() 里检查（见 team_delete_guard.enforce_delete_policy），网页和 API 都会经过。
from rest_framework.exceptions import PermissionDenied

from plane.db.models import Cycle, Issue, IssueAssignee, Module, Page, TeamEditor, WorkspaceMember

ADMIN_ROLE = 20

ISSUE_MESSAGE = "这是别人的工作项，你只能评论。需要修改请让创建人或指派人来改，或请管理员处理。也可以申请编辑权限（MCP：doc_access，类型选 issue）。"
MODULE_MESSAGE = "这是别人建的模块，你只能查看。需要修改请让创建人或负责人来改，或请管理员处理。把任务放进模块不受限制。"
CYCLE_MESSAGE = "这是别人建的周期，你只能查看。需要修改请让创建人来改，或请管理员处理。把任务放进周期不受限制。"
PAGE_MESSAGE = "这是别人的文档，你只能阅读和评论。需要修改请让作者来改，或请管理员处理。也可以在页面上申请编辑权限（MCP：doc_access）。"

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


MODULE_EDIT_VIEWS = {
    "ModuleViewSet": ("pk", {"PATCH", "PUT"}),
    "ModuleDetailAPIEndpoint": ("pk", {"PATCH", "PUT"}),
}
CYCLE_EDIT_VIEWS = {
    "CycleViewSet": ("pk", {"PATCH", "PUT"}),
    "CycleDetailAPIEndpoint": ("pk", {"PATCH", "PUT"}),
}


# 按动作（ViewSet 的 action）检查：锁定、归档、改访问级别这些不是 PATCH，但同样是改别人的东西
PAGE_EDIT_ACTIONS = {"PageViewSet": ("page_id", {"lock", "unlock", "archive", "unarchive", "access"})}
ISSUE_EDIT_ACTIONS = {"IssueArchiveViewSet": ("pk", {"archive", "unarchive"})}
# 批量操作：请求体里带多个工作项 ID，任何一个不能改就整体拒绝
ISSUE_BULK_VIEWS = {
    "BulkArchiveIssuesEndpoint": lambda data: data.get("issue_ids") or [],
    "IssueBulkUpdateDateEndpoint": lambda data: [u.get("id") for u in (data.get("updates") or []) if isinstance(u, dict)],
}


def is_workspace_admin(user, workspace_id) -> bool:
    return WorkspaceMember.objects.filter(workspace_id=workspace_id, member=user, role=ADMIN_ROLE, is_active=True).exists()


def is_team_editor(user, entity_type, entity_id) -> bool:
    """拥有者指定的共同维护人（或批准过的申请人）。"""
    return TeamEditor.objects.filter(entity_type=entity_type, entity_id=entity_id, user=user).exists()


def can_edit_issue(user, issue) -> bool:
    if issue.created_by_id == user.id or is_team_editor(user, "issue", issue.id):
        return True
    if IssueAssignee.objects.filter(issue_id=issue.id, assignee=user).exists():
        return True
    return is_workspace_admin(user, issue.workspace_id)


def can_edit_page(user, page) -> bool:
    return page.owned_by_id == user.id or is_team_editor(user, "page", page.id) or is_workspace_admin(user, page.workspace_id)


def can_edit_module(user, module) -> bool:
    return module.created_by_id == user.id or module.lead_id == user.id or is_workspace_admin(user, module.workspace_id)


def can_edit_cycle(user, cycle) -> bool:
    return cycle.owned_by_id == user.id or cycle.created_by_id == user.id or is_workspace_admin(user, cycle.workspace_id)


def _enforce_extra(view, request, kwargs, name, user):
    action = getattr(view, "action", None)
    if name in PAGE_EDIT_ACTIONS:
        param, actions = PAGE_EDIT_ACTIONS[name]
        if action in actions and kwargs.get(param):
            page = Page.objects.filter(pk=kwargs[param]).only("id", "owned_by_id", "workspace_id").first()
            if page and not can_edit_page(user, page):
                raise PermissionDenied(PAGE_MESSAGE)
    if name in ISSUE_EDIT_ACTIONS:
        param, actions = ISSUE_EDIT_ACTIONS[name]
        if action in actions and kwargs.get(param):
            issue = Issue.objects.filter(pk=kwargs[param]).only("id", "created_by_id", "workspace_id").first()
            if issue and not can_edit_issue(user, issue):
                raise PermissionDenied(ISSUE_MESSAGE)
    if name in ISSUE_BULK_VIEWS and request.method in ("POST", "PATCH", "PUT"):
        try:
            ids = [i for i in ISSUE_BULK_VIEWS[name](request.data) if i]
        except Exception:
            ids = []
        if ids:
            for issue in Issue.objects.filter(pk__in=ids).only("id", "created_by_id", "workspace_id"):
                if not can_edit_issue(user, issue):
                    raise PermissionDenied(ISSUE_MESSAGE)


def enforce_edit_policy(view, request, kwargs):
    name = view.__class__.__name__
    user = request.user
    if not getattr(user, "is_authenticated", False):
        return
    _enforce_extra(view, request, kwargs, name, user)
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
    elif name in MODULE_EDIT_VIEWS:
        param, methods = MODULE_EDIT_VIEWS[name]
        if request.method in methods and kwargs.get(param):
            module = Module.objects.filter(pk=kwargs[param]).only("id", "created_by_id", "lead_id", "workspace_id").first()
            if module and not can_edit_module(user, module):
                raise PermissionDenied(MODULE_MESSAGE)
    elif name in CYCLE_EDIT_VIEWS:
        param, methods = CYCLE_EDIT_VIEWS[name]
        if request.method in methods and kwargs.get(param):
            cycle = Cycle.objects.filter(pk=kwargs[param]).only("id", "owned_by_id", "created_by_id", "workspace_id").first()
            if cycle and not can_edit_cycle(user, cycle):
                raise PermissionDenied(CYCLE_MESSAGE)
