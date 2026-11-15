# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# [team 二开] 删除权限收紧：只有工作区管理员能删除共享内容，其他人只能归档。
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

MESSAGE = "只有工作区管理员可以删除。不需要的内容请归档（任务、文档、周期、模块都支持归档）。"


def _workspace_id(view, kwargs):
    slug = kwargs.get("slug")
    if slug:
        return WorkspaceMember.objects.filter(workspace__slug=slug).values_list("workspace_id", flat=True).first()
    anchor = kwargs.get("anchor")
    if anchor:
        return DeployBoard.objects.filter(anchor=anchor).values_list("workspace_id", flat=True).first()
    return None


def enforce_delete_policy(view, request, kwargs):
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
