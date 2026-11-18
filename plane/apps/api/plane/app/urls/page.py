# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.urls import path

from plane.app.views.page.team_share import TeamPageShareEndpoint
from plane.app.views.team_access import TeamAccessEndpoint, TeamAccessPendingEndpoint
from plane.app.views.team_search import TeamSearchEndpoint, TeamTemplateEndpoint
from plane.app.views.page.team_page_issue import TeamIssuePagesEndpoint, TeamLinkCandidatesEndpoint, TeamPageIssuesEndpoint


from plane.app.views import (
    PageViewSet,
    PageFavoriteViewSet,
    PagesDescriptionViewSet,
    PageVersionEndpoint,
    PageDuplicateEndpoint,
    PageLiveAccessEndpoint,
)

urlpatterns = [
    path("workspaces/<str:slug>/team-templates/", TeamTemplateEndpoint.as_view(), name="team-templates-app"),
    path("workspaces/<str:slug>/team-templates/<uuid:template_id>/", TeamTemplateEndpoint.as_view(), name="team-template-app"),
    path("workspaces/<str:slug>/team-search/", TeamSearchEndpoint.as_view(), name="team-search-app"),
    path("workspaces/<str:slug>/team-access/pending/", TeamAccessPendingEndpoint.as_view(), name="team-access-pending"),
    path("workspaces/<str:slug>/team-access/<str:entity_type>/<uuid:entity_id>/", TeamAccessEndpoint.as_view(), name="team-access"),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/pages-summary/",
        PageViewSet.as_view({"get": "summary"}),
        name="project-pages-summary",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/pages/",
        PageViewSet.as_view({"get": "list", "post": "create"}),
        name="project-pages",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/pages/<uuid:page_id>/",
        PageViewSet.as_view({"get": "retrieve", "patch": "partial_update", "delete": "destroy"}),
        name="project-pages",
    ),
    # favorite pages
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/favorite-pages/<uuid:page_id>/",
        PageFavoriteViewSet.as_view({"post": "create", "delete": "destroy"}),
        name="user-favorite-pages",
    ),
    # archived pages
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/pages/<uuid:page_id>/archive/",
        PageViewSet.as_view({"post": "archive", "delete": "unarchive"}),
        name="project-page-archive-unarchive",
    ),
    # lock and unlock
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/pages/<uuid:page_id>/lock/",
        PageViewSet.as_view({"post": "lock", "delete": "unlock"}),
        name="project-pages-lock-unlock",
    ),
    # private and public page
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/pages/<uuid:page_id>/access/",
        PageViewSet.as_view({"post": "access"}),
        name="project-pages-access",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/pages/<uuid:page_id>/description/",
        PagesDescriptionViewSet.as_view({"get": "retrieve", "patch": "partial_update"}),
        name="page-description",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/pages/<uuid:page_id>/versions/",
        PageVersionEndpoint.as_view(),
        name="page-versions",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/pages/<uuid:page_id>/versions/<uuid:pk>/",
        PageVersionEndpoint.as_view(),
        name="page-versions",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/pages/<uuid:page_id>/duplicate/",
        PageDuplicateEndpoint.as_view(),
        name="page-duplicate",
    ),
    # live server per-connection access check
    path(
        "workspaces/<str:slug>/pages/<uuid:page_id>/live-access/",
        PageLiveAccessEndpoint.as_view(),
        name="page-live-access",
    ),
    # [team 二开] 文档公开只读链接
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/pages/<uuid:page_id>/team-share/",
        TeamPageShareEndpoint.as_view(),
        name="team-page-share",
    ),
    # [team 二开] 文档 ↔ 工作项关联
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/team-pages/",
        TeamIssuePagesEndpoint.as_view(),
        name="team-issue-pages",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/pages/<uuid:page_id>/team-issues/",
        TeamPageIssuesEndpoint.as_view(),
        name="team-page-issues",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/team-link-candidates/",
        TeamLinkCandidatesEndpoint.as_view(),
        name="team-link-candidates",
    ),
]
