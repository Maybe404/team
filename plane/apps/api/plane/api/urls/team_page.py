# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.
#
# [team 二开] Pages 公开接口路由

from django.urls import path

from plane.api.views.team_page import (
    TeamIssuePagesAPIEndpoint,
    TeamPageDetailAPIEndpoint,
    TeamPageIssuesAPIEndpoint,
    TeamPageListCreateAPIEndpoint,
)

urlpatterns = [
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
]
