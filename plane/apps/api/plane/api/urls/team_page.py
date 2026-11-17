# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.
#
# [team 二开] Pages 公开接口路由

from django.urls import path

from plane.api.views.team_view import TeamViewDetailAPIEndpoint, TeamViewListCreateAPIEndpoint
from plane.api.views.team_page import (
    TeamIssuePagesAPIEndpoint,
    TeamPageDetailAPIEndpoint,
    TeamPageImageAPIEndpoint,
    TeamPageIssuesAPIEndpoint,
    TeamPageListCreateAPIEndpoint,
    TeamPageVersionsAPIEndpoint,
)
from plane.api.views.team_access import TeamAccessAPIEndpoint, TeamAccessPendingAPIEndpoint

urlpatterns = [
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/pages/<uuid:pk>/versions/",
        TeamPageVersionsAPIEndpoint.as_view(http_method_names=["get", "post"]),
        name="team-page-versions",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/pages/<uuid:pk>/versions/<uuid:version_id>/",
        TeamPageVersionsAPIEndpoint.as_view(http_method_names=["get", "patch", "post"]),
        name="team-page-version-detail",
    ),
    path(
        "workspaces/<str:slug>/team-access/pending/",
        TeamAccessPendingAPIEndpoint.as_view(http_method_names=["get"]),
        name="team-access-pending",
    ),
    path(
        "workspaces/<str:slug>/team-access/<str:entity_type>/<uuid:entity_id>/",
        TeamAccessAPIEndpoint.as_view(http_method_names=["get", "post"]),
        name="team-access",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/pages/",
        TeamPageListCreateAPIEndpoint.as_view(http_method_names=["get", "post"]),
        name="team-pages",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/pages/<uuid:pk>/",
        TeamPageDetailAPIEndpoint.as_view(http_method_names=["get", "patch"]),
        name="team-pages",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/work-items/<uuid:issue_id>/pages/",
        TeamIssuePagesAPIEndpoint.as_view(http_method_names=["get", "post"]),
        name="team-issue-pages",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/pages/<uuid:pk>/work-items/",
        TeamPageIssuesAPIEndpoint.as_view(http_method_names=["get"]),
        name="team-page-issues",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/page-images/",
        TeamPageImageAPIEndpoint.as_view(http_method_names=["post"]),
        name="team-page-images",
    ),
    # 项目视图
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/views/",
        TeamViewListCreateAPIEndpoint.as_view(http_method_names=["get", "post"]),
        name="team-views",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/views/<uuid:pk>/",
        TeamViewDetailAPIEndpoint.as_view(http_method_names=["patch"]),
        name="team-view-detail",
    ),
]
