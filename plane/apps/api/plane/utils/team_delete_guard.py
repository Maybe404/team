# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# [team 二开] 删除权限收紧：只有工作区管理员能删除共享内容，其他人只能归档。
# 另外，用 API Token 访问的请求一律视为 Agent：不能删除任何东西（管理员的 Token 也不行），
# 不能管理成员和邀请，不能改项目设置（包括关联仓库）。这些操作只能由人在网页上做。
#
# 在视图基类的 initial() 里检查（认证之后），网页会话和 API Token 都会经过这里。
# 用黑名单列出“会销毁共享内容”的视图；个人操作（取消表情、取消收藏、取消订阅、
# 删自己的便签/草稿/API Token、编辑器里删图片）和“取消归档”（这些接口用 DELETE 表示取消归档）不受影响。
from rest_framework.exceptions import PermissionDenied

from plane.db.models import DeployBoard, WorkspaceMember

ADMIN_ROLE = 20

# 视图类名 -> 需要拦截的 HTTP 方法
BLOCKED_DELETE_VIEWS = {
    # 网页用的 app 接口
    "IssueViewSet": {"DELETE"},
    "BulkDeleteIssuesEndpoint": {"DELETE"},
    "IssueCommentViewSet": {"DELETE"},
    "IssueLinkViewSet": {"DELETE"},
    "IssueAttachmentEndpoint": {"DELETE"},
    "IssueAttachmentV2Endpoint": {"DELETE"},
    "PageViewSet": {"DELETE"},
    "CycleViewSet": {"DELETE"},
    "ModuleViewSet": {"DELETE"},
    "WorkspaceViewViewSet": {"DELETE"},
    "IssueViewViewSet": {"DELETE"},
    "StateViewSet": {"DELETE"},
    "LabelViewSet": {"DELETE"},
    "EstimatePointEndpoint": {"DELETE"},
    "BulkEstimatePointEndpoint": {"DELETE"},
    "IntakeViewSet": {"DELETE"},
    "IntakeIssueViewSet": {"DELETE"},
    "ProjectViewSet": {"DELETE"},
    "ProjectIdentifierEndpoint": {"DELETE"},
    "WorkSpaceViewSet": {"DELETE"},
    # 公开 API /api/v1
    "IssueDetailAPIEndpoint": {"DELETE"},
    "IssueCommentDetailAPIEndpoint": {"DELETE"},
    "IssueLinkDetailAPIEndpoint": {"DELETE"},
    "IssueAttachmentDetailAPIEndpoint": {"DELETE"},
    "CycleDetailAPIEndpoint": {"DELETE"},
    "ModuleDetailAPIEndpoint": {"DELETE"},
    "StateDetailAPIEndpoint": {"DELETE"},
    "LabelDetailAPIEndpoint": {"DELETE"},
    "ProjectEstimateAPIEndpoint": {"DELETE"},
    "EstimatePointDetailAPIEndpoint": {"DELETE"},
    "IntakeIssueDetailAPIEndpoint": {"DELETE"},
    "ProjectDetailAPIEndpoint": {"DELETE"},
    # 公开发布页（space）
    "IssueCommentPublicViewSet": {"DELETE"},
    "IntakeIssuePublicViewSet": {"DELETE"},
}

# Agent（API Token）不能做的写操作：视图类名
AGENT_BLOCKED_WRITE_VIEWS = {
    "WorkspaceInvitationsViewset",
    "ProjectMemberListCreateAPIEndpoint",
    "ProjectMemberDetailAPIEndpoint",
    "ProjectDetailAPIEndpoint",
    "ProjectArchiveUnarchiveAPIEndpoint",
    "CycleArchiveUnarchiveAPIEndpoint",
    "ModuleArchiveUnarchiveAPIEndpoint",
}
AGENT_MESSAGE = "API Token（Agent）不能删除内容、管理成员或修改项目设置，这些操作请由人在网页上完成。"

MESSAGE = "只有工作区管理员可以删除。不需要的内容请归档（任务、文档、周期、模块都支持归档）。"


def _workspace_id(view, kwargs):
    slug = kwargs.get("slug")
    if slug:
        return WorkspaceMember.objects.filter(workspace__slug=slug).values_list("workspace_id", flat=True).first()
    anchor = kwargs.get("anchor")
    if anchor:
        return DeployBoard.objects.filter(anchor=anchor).values_list("workspace_id", flat=True).first()
    return None


def _is_api_token(request) -> bool:
    return type(getattr(request, "successful_authenticator", None)).__name__ == "APIKeyAuthentication"


def enforce_delete_policy(view, request, kwargs):
    if _is_api_token(request):
        if request.method == "DELETE":
            raise PermissionDenied(AGENT_MESSAGE)
        if request.method not in ("GET", "HEAD", "OPTIONS") and view.__class__.__name__ in AGENT_BLOCKED_WRITE_VIEWS:
            raise PermissionDenied(AGENT_MESSAGE)
    methods = BLOCKED_DELETE_VIEWS.get(view.__class__.__name__)
    if not methods or request.method not in methods:
        return
    user = request.user
    if not getattr(user, "is_authenticated", False):
        raise PermissionDenied(MESSAGE)
    workspace_id = _workspace_id(view, kwargs)
    is_admin = WorkspaceMember.objects.filter(
        workspace_id=workspace_id, member=user, role=ADMIN_ROLE, is_active=True
    ).exists()
    if not is_admin:
        raise PermissionDenied(MESSAGE)
