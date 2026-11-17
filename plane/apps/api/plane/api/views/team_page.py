# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.
#
# [team 二开] 用 API Token 读写 Page 的公开接口。
# 社区版的 /api/v1 没有 Pages，Agent 只能通过这里读写文档。
#
# 写入正文时交给 live 服务的 /team/pages/apply-html：它把新 HTML 和现有协同文档做 diff，
# 生成普通的 Yjs 增量更新。正在打开的编辑器会实时看到变化，浏览器本地缓存也能正常合并，
# 不会像"整篇替换"那样出现内容重复。live 返回新的 binary/html/json，这里统一落库。

import base64
import binascii
import io
import json
import os
import re
import uuid

import requests
from django.conf import settings
from django.db.models import Q
from rest_framework import status
from rest_framework.response import Response

from plane.app.permissions import ProjectEntityPermission
from plane.app.serializers import PageSerializer
from plane.bgtasks.page_transaction_task import page_transaction
from plane.db.models import FileAsset, Page, Workspace
from plane.settings.storage import S3Storage
from plane.utils.url import normalize_url_path

from .base import BaseAPIView

LIVE_TIMEOUT_SECONDS = 15

LIST_FIELDS = (
    "id",
    "name",
    "access",
    "parent_id",
    "owned_by_id",
    "is_locked",
    "archived_at",
    "created_at",
    "updated_at",
)


def serialize_page(page, project_id, include_body=False):
    data = {f: getattr(page, f) for f in LIST_FIELDS}
    data["project_id"] = str(project_id)
    for key in ("id", "parent_id", "owned_by_id"):
        if data[key] is not None:
            data[key] = str(data[key])
    if include_body:
        data["description_html"] = page.description_html
        data["description_stripped"] = page.description_stripped
    return data


class LiveUnavailable(Exception):
    pass


def apply_html_via_live(page, new_html):
    """让 live 把新 HTML 以增量编辑合进协同文档，返回 live 的结果。"""
    if not settings.LIVE_URL:
        raise LiveUnavailable("未配置 LIVE_BASE_URL")
    binary = bytes(page.description_binary) if page.description_binary else b""
    payload = {
        "page_id": str(page.id),
        "page_name": page.name,
        "description_html": new_html,
        "current_binary": base64.b64encode(binary).decode() if binary else None,
        "current_html": page.description_html,
    }
    try:
        resp = requests.post(
            normalize_url_path(f"{settings.LIVE_URL}/team/pages/apply-html/"),
            data=json.dumps(payload),
            headers={
                "Content-Type": "application/x-team-json",
                "live-server-secret-key": os.environ.get("LIVE_SERVER_SECRET_KEY", ""),
            },
            timeout=LIVE_TIMEOUT_SECONDS,
        )
    except requests.RequestException as e:
        raise LiveUnavailable(str(e))
    if resp.status_code != 200:
        raise LiveUnavailable(f"live 返回 {resp.status_code}")
    return resp.json()


class TeamPageBase(BaseAPIView):
    permission_classes = [ProjectEntityPermission]

    def visible_pages(self, slug, project_id):
        return (
            Page.objects.filter(
                workspace__slug=slug,
                projects__id=project_id,
                project_pages__deleted_at__isnull=True,
                projects__project_projectmember__member=self.request.user,
                projects__project_projectmember__is_active=True,
            )
            .filter(Q(access=Page.PUBLIC_ACCESS) | Q(owned_by=self.request.user))
            .distinct()
        )


class TeamPageListCreateAPIEndpoint(TeamPageBase):
    def get(self, request, slug, project_id):
        pages = self.visible_pages(slug, project_id).filter(archived_at__isnull=True)
        search = request.query_params.get("search")
        if search:
            pages = pages.filter(Q(name__icontains=search) | Q(description_stripped__icontains=search))
        parent = request.query_params.get("parent")
        if parent:
            pages = pages.filter(parent_id=parent)
        return self.paginate(
            request=request,
            queryset=pages.order_by("-updated_at"),
            on_results=lambda rows: [serialize_page(p, project_id) for p in rows],
            default_per_page=50,
        )

    def post(self, request, slug, project_id):
        name = (request.data.get("name") or "").strip()
        if not name:
            return Response({"error": "name 不能为空"}, status=status.HTTP_400_BAD_REQUEST)
        html = request.data.get("description_html") or "<p></p>"
        parent = request.data.get("parent")
        if parent and not self.visible_pages(slug, project_id).filter(pk=parent).exists():
            return Response({"error": "parent 不存在"}, status=status.HTTP_400_BAD_REQUEST)

        serializer = PageSerializer(
            data={"name": name, "access": request.data.get("access", Page.PUBLIC_ACCESS), "parent": parent},
            context={
                "project_id": project_id,
                "owned_by_id": request.user.id,
                "description_json": {},
                "description_binary": None,
                "description_html": html,
            },
        )
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        serializer.save()
        page_transaction.delay(new_description_html=html, old_description_html=None, page_id=serializer.data["id"])
        page = Page.objects.get(pk=serializer.data["id"])
        return Response(serialize_page(page, project_id, include_body=True), status=status.HTTP_201_CREATED)


class TeamPageDetailAPIEndpoint(TeamPageBase):
    def get_page(self, slug, project_id, pk):
        return self.visible_pages(slug, project_id).filter(pk=pk).first()

    def get(self, request, slug, project_id, pk):
        page = self.get_page(slug, project_id, pk)
        if page is None:
            return Response({"error": "Page 不存在"}, status=status.HTTP_404_NOT_FOUND)
        return Response(serialize_page(page, project_id, include_body=True))

    def patch(self, request, slug, project_id, pk):
        page = self.get_page(slug, project_id, pk)
        if page is None:
            return Response({"error": "Page 不存在"}, status=status.HTTP_404_NOT_FOUND)
        if page.is_locked:
            return Response({"error": "Page 已锁定"}, status=status.HTTP_400_BAD_REQUEST)
        if page.archived_at:
            return Response({"error": "Page 已归档"}, status=status.HTTP_400_BAD_REQUEST)

        if "name" in request.data:
            name = (request.data.get("name") or "").strip()
            if not name:
                return Response({"error": "name 不能为空"}, status=status.HTTP_400_BAD_REQUEST)
            page.name = name

        live_result = None
        old_html = page.description_html
        new_html = request.data.get("description_html")
        if new_html is not None:
            try:
                live_result = apply_html_via_live(page, new_html)
            except LiveUnavailable as e:
                return Response({"error": f"协同服务不可用，未写入：{e}"}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
            page.description_binary = base64.b64decode(live_result["description_binary"])
            page.description_html = live_result["description_html"]
            page.description_json = live_result["description_json"]
        page.save()

        if new_html is not None:
            page_transaction.delay(new_description_html=new_html, old_description_html=old_html, page_id=str(page.id))
        data = serialize_page(page, project_id, include_body=True)
        data["live_editing"] = bool(live_result and live_result.get("live"))
        return Response(data)


# 文档 ↔ 工作项关联（Agent 用）：只能查和建立，取消关联只能由人在网页上做（API Token 不能 DELETE）
class TeamIssuePagesAPIEndpoint(BaseAPIView):
    permission_classes = [ProjectEntityPermission]

    def get(self, request, slug, project_id, issue_id):
        from plane.utils.team_page_issue import pages_of_issue

        return Response(pages_of_issue(request.user, slug, project_id, issue_id))

    def post(self, request, slug, project_id, issue_id):
        from plane.db.models import Issue
        from plane.utils.team_page_issue import link, pages_of_issue, visible_pages

        issue = Issue.objects.filter(pk=issue_id, workspace__slug=slug, project_id=project_id).first()
        page = visible_pages(request.user, slug, project_id).filter(pk=request.data.get("page_id")).first()
        if not issue or not page:
            return Response({"error": "工作项或文档不存在"}, status=status.HTTP_404_NOT_FOUND)
        ok, err = link(request.user, project_id, issue, page)
        if not ok:
            return Response({"error": err}, status=status.HTTP_403_FORBIDDEN)
        return Response(pages_of_issue(request.user, slug, project_id, issue_id), status=status.HTTP_201_CREATED)


class TeamPageIssuesAPIEndpoint(BaseAPIView):
    permission_classes = [ProjectEntityPermission]

    def get(self, request, slug, project_id, pk):
        from plane.utils.team_page_issue import issues_of_page, visible_pages

        if not visible_pages(request.user, slug, project_id).filter(pk=pk).exists():
            return Response({"error": "Page 不存在"}, status=status.HTTP_404_NOT_FOUND)
        return Response(issues_of_page(pk, project_id))


# 给 Agent 用的图片上传：PNG、JPEG、GIF、WebP、SVG，上传后得到附件 ID，在 Markdown 里写 ![](asset:<ID>) 就是文档里的图片。
IMAGE_MAGIC = {
    "image/png": (b"\x89PNG\r\n\x1a\n",),
    "image/jpeg": (b"\xff\xd8\xff",),
    "image/gif": (b"GIF87a", b"GIF89a"),
    "image/webp": (b"RIFF",),
}
UNSAFE_SVG = re.compile(r"<\s*script|<\s*foreignObject|<\s*iframe|\son[a-z]+\s*=|javascript:|data:text/html", re.I)


class TeamPageImageAPIEndpoint(BaseAPIView):
    permission_classes = [ProjectEntityPermission]

    def post(self, request, slug, project_id):
        content_type = request.data.get("content_type") or ""
        name = re.sub(r"[^\w.\-\u4e00-\u9fff]", "_", (request.data.get("name") or "image").strip())[:80] or "image"
        try:
            raw = base64.b64decode(request.data.get("data_base64") or "", validate=True)
        except (binascii.Error, ValueError):
            return Response({"error": "data_base64 不是合法的 base64"}, status=status.HTTP_400_BAD_REQUEST)
        if content_type not in (*IMAGE_MAGIC, "image/svg+xml"):
            return Response({"error": "只支持 PNG、JPEG、GIF、WebP、SVG"}, status=status.HTTP_400_BAD_REQUEST)
        if not raw or len(raw) > settings.FILE_SIZE_LIMIT:
            return Response(
                {"error": f"图片不能为空，且不能超过 {settings.FILE_SIZE_LIMIT // 1024 // 1024}MB"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if content_type == "image/svg+xml":
            head = raw[:4096].decode("utf-8", errors="ignore")
            if "<svg" not in head.lower() or UNSAFE_SVG.search(raw.decode("utf-8", errors="ignore")):
                return Response(
                    {"error": "SVG 不合法，或含有脚本、事件属性、foreignObject 等不安全内容"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        elif not any(raw.startswith(m) for m in IMAGE_MAGIC[content_type]):
            return Response({"error": "文件内容和声明的图片类型对不上"}, status=status.HTTP_400_BAD_REQUEST)

        workspace = Workspace.objects.get(slug=slug)
        key = f"{workspace.id}/{uuid.uuid4().hex}-{name}"
        storage = S3Storage()  # 服务端直传，用内网地址；传 request 会指向对外域名，容器里连不上
        if not storage.upload_file(io.BytesIO(raw), key, content_type):
            return Response({"error": "图片存储失败"}, status=status.HTTP_502_BAD_GATEWAY)
        asset = FileAsset.objects.create(
            attributes={"name": name, "type": content_type, "size": len(raw)},
            asset=key,
            size=len(raw),
            workspace=workspace,
            project_id=project_id,
            created_by=request.user,
            entity_type=FileAsset.EntityTypeContext.PAGE_DESCRIPTION,
            is_uploaded=True,
        )
        return Response({"asset_id": str(asset.id)}, status=status.HTTP_201_CREATED)
