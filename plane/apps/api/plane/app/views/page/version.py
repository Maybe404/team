# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.db.models import PageVersion
from ..base import BaseAPIView
from plane.app.serializers import PageVersionSerializer, PageVersionDetailSerializer
from plane.app.permissions import ProjectPagePermission


class PageVersionEndpoint(BaseAPIView):
    permission_classes = [ProjectPagePermission]

    def _hidden(self, request, slug, project_id, page_id):
        """[team 二开] 别人的私有页面、或祖先里有别人私有页的子页面，版本历史也看不到"""
        from plane.db.models import Page
        from plane.utils.team_access import can_view_entity

        page = Page.objects.filter(pk=page_id, workspace__slug=slug).first()
        return page is None or not can_view_entity(request.user, "page", page, project_id)

    def get(self, request, slug, project_id, page_id, pk=None):
        if self._hidden(request, slug, project_id, page_id):
            return Response({"error": "Page not found"}, status=status.HTTP_404_NOT_FOUND)
        # Check if pk is provided
        if pk:
            # Return a single page version. Scope to an *active* ProjectPage link
            # for the URL project so a page belonging to (or removed from)
            # another project cannot be read via this endpoint (GHSA-g49r /
            # GHSA-ghcr). The active-link partial-unique constraint keeps the
            # join to a single row; distinct() is a defensive guard so the
            # page__project_pages join can never make get() raise
            # MultipleObjectsReturned (a 500).
            page_version = (
                PageVersion.objects.filter(
                    workspace__slug=slug,
                    page__project_pages__project_id=project_id,
                    page__project_pages__deleted_at__isnull=True,
                    page_id=page_id,
                    pk=pk,
                )
                .distinct()
                .get()
            )
            # Serialize the page version
            serializer = PageVersionDetailSerializer(page_version)
            return Response(serializer.data, status=status.HTTP_200_OK)
        # Return all page versions scoped to an active ProjectPage link for the
        # URL project (defense in depth).
        page_versions = PageVersion.objects.filter(
            workspace__slug=slug,
            page__project_pages__project_id=project_id,
            page__project_pages__deleted_at__isnull=True,
            page_id=page_id,
        )
        # Serialize the page versions
        serializer = PageVersionSerializer(page_versions, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)


    def post(self, request, slug, project_id, page_id, pk=None):
        """[team 二开] 把当前内容存成一个版本（可带 label、lock），恢复旧版本前网页会先调用它。"""
        from plane.db.models import Page
        from plane.utils.team_edit_policy import can_edit_page
        from plane.utils.team_page_version import snapshot_current, version_dict

        page = Page.objects.filter(pk=page_id, workspace__slug=slug).first()
        if page is None or self._hidden(request, slug, project_id, page_id):
            return Response({"error": "页面不存在"}, status=status.HTTP_404_NOT_FOUND)
        if not can_edit_page(request.user, page):
            return Response({"error": "没有编辑权限"}, status=status.HTTP_403_FORBIDDEN)
        v, created = snapshot_current(page, request.user, label=request.data.get("label") or "", lock=bool(request.data.get("lock")), source="manual")
        return Response({**version_dict(v), "created": created})

    def patch(self, request, slug, project_id, page_id, pk=None):
        """[team 二开] 给版本改名、锁定或解锁。"""
        from plane.db.models import Page
        from plane.utils.team_edit_policy import can_edit_page
        from plane.utils.team_page_version import version_dict

        page = Page.objects.filter(pk=page_id, workspace__slug=slug).first()
        v = PageVersion.objects.filter(page_id=page_id, pk=pk).first() if pk else None
        if page is None or v is None or self._hidden(request, slug, project_id, page_id):
            return Response({"error": "版本不存在"}, status=status.HTTP_404_NOT_FOUND)
        if not can_edit_page(request.user, page):
            return Response({"error": "没有编辑权限"}, status=status.HTTP_403_FORBIDDEN)
        fields = ["updated_at"]
        if "is_locked" in request.data:
            v.is_locked = bool(request.data["is_locked"])
            fields.append("is_locked")
        if "label" in request.data:
            v.label = str(request.data["label"] or "")[:255]
            fields.append("label")
        v.save(update_fields=fields)
        return Response(version_dict(v))
