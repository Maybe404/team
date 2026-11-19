# [team 二开] 公开文档：凭链接里的 share 读一篇文档和它的图片，不需要登录，也读不到这篇文档以外的任何内容。
import re

import nh3
from django.http import HttpResponseRedirect
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from plane.db.models import FileAsset, Page, TeamPageShare, User
from plane.settings.storage import S3Storage
from plane.utils.team_page_tree import descendant_ids


def _live_share(share):
    s = TeamPageShare.objects.filter(anchor=share).select_related("page", "project", "workspace").first()
    if not s or s.page.archived_at or s.page.deleted_at or s.page.access != Page.PUBLIC_ACCESS:
        return None
    return s


_IMG = re.compile(r"<image-component\b([^>]*)>(?:\s*</image-component>)?", re.I)
_MENTION = re.compile(r"<mention-component\b([^>]*)>(?:\s*</mention-component>)?", re.I)
_EMBED = re.compile(r"<html-embed-component\b((?:[^>\"]|\"[^\"]*\")*)>(?:\s*</html-embed-component>)?", re.I)
_PAGELINK = re.compile(r"<page-link-component\b((?:[^>\"]|\"[^\"]*\")*)>(?:\s*</page-link-component>)?", re.I)
_ATTR = re.compile(r'([\w-]+)="([^"]*)"')

_TAGS = {
    "p", "br", "hr", "h1", "h2", "h3", "h4", "h5", "h6", "strong", "b", "em", "i", "u", "s", "del", "code", "pre",
    "blockquote", "ul", "ol", "li", "a", "img", "table", "thead", "tbody", "tr", "th", "td", "span", "div",
    "label", "input", "mark", "sub", "sup",
}
_ATTRS = {
    "a": {"href", "title"},
    "img": {"src", "alt", "width", "height"},
    "td": {"colspan", "rowspan"},
    "th": {"colspan", "rowspan"},
    "input": {"type", "checked", "disabled"},
    "li": {"data-checked", "data-type"},
    "ul": {"data-type"},
    "div": {"data-block-type", "data-type"},
    "pre": {"class"},
    "code": {"class"},
}


def render_public_html(html, share):
    """把编辑器的自定义节点换成普通 HTML，再白名单清洗：图片走公开文档自己的图片接口，提及显示成 @名字。"""

    def img(m):
        a = dict(_ATTR.findall(m.group(1)))
        src = a.get("src", "")
        if not src:
            return ""
        if not src.startswith("http"):
            src = f"/api/public/team-pages/{share}/assets/{src}/"
        width = a.get("width", "")
        w = f' width="{width}"' if width and width.replace(".", "").replace("px", "").isdigit() else ""
        return f'<img src="{src}" alt=""{w}>'

    ids = {dict(_ATTR.findall(m.group(1))).get("entity_identifier") for m in _MENTION.finditer(html or "")}
    valid = [i for i in ids if i and re.fullmatch(r"[0-9a-fA-F-]{32,36}", i)]
    names = {str(u.id): u.display_name for u in User.objects.filter(id__in=valid)}

    def mention(m):
        a = dict(_ATTR.findall(m.group(1)))
        return f"<span>@{names.get(a.get('entity_identifier', ''), '成员')}</span>"

    # [team 二开] HTML 嵌入块：先换成占位文本，清洗后再换成沙箱 iframe（内容不经过标签清洗，靠沙箱隔离）
    embeds = []

    def embed(m):
        a = dict(_ATTR.findall(m.group(1)))
        embeds.append(a)
        return f"@@HTMLEMBED{len(embeds) - 1}@@"

    # [team 二开] 页面链接卡片：公开页里只显示标题（站内页面不一定公开，不给跳转）
    def pagelink(m):
        a = dict(_ATTR.findall(m.group(1)))
        title = a.get("data-title", "") or "页面"
        return f"<p>📄 {title}</p>"

    out = _PAGELINK.sub(pagelink, html or "")
    out = _EMBED.sub(embed, out)
    out = _IMG.sub(img, out)
    out = _MENTION.sub(mention, out)
    out = nh3.clean(out, tags=_TAGS, attributes=_ATTRS, url_schemes={"http", "https", "mailto"}, link_rel="noopener noreferrer nofollow")
    # 引用同篇文档里同名完整块的局部块：公开页没有聚焦脚本，直接显示被引用的完整原型
    named = {}
    for a in embeds:
        if a.get("data-html"):
            for k in (a.get("data-uid"), a.get("data-name")):
                if k:
                    named.setdefault(k, a["data-html"])
    for i, a in enumerate(embeds):
        # 属性值在 description_html 里已是转义过的，直接作为 srcdoc 属性值使用
        src = a.get("data-html", "") or named.get(a.get("data-ref", ""), "")
        height = a.get("data-height", "420")
        height = int(height) if height.isdigit() else 420
        width = a.get("data-width", "100")
        width = int(width) if width.isdigit() else 100
        frame = (
            f'<iframe sandbox="allow-scripts allow-popups allow-forms" referrerpolicy="no-referrer" '
            f'style="width:{min(width, 100)}%;height:{min(height, 2000)}px;border:1px solid #ddd;border-radius:8px;background:#fff" '
            f'srcdoc="{src}"></iframe>'
        )
        out = out.replace(f"@@HTMLEMBED{i}@@", frame)
    return out


class TeamPublicPageEndpoint(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request, share):
        s = _live_share(share)
        if not s:
            return Response({"error": "链接不存在或已关闭"}, status=status.HTTP_404_NOT_FOUND)
        p = s.page
        # 同时公开了的子页面，列在文档下面，点开是它们各自的公开链接
        child_ids = descendant_ids(p.id, s.project_id)
        children = [
            {"name": c.page.name, "anchor": c.anchor}
            for c in TeamPageShare.objects.filter(page_id__in=child_ids, project_id=s.project_id).select_related("page")
            if c.page.access == Page.PUBLIC_ACCESS and not c.page.archived_at
        ]
        return Response(
            {
                "children": children,
                "name": p.name,
                "html": render_public_html(p.description_html, share),
                "logo_props": p.logo_props,
                "updated_at": p.updated_at,
                "project_name": s.project.name,
                "workspace_name": s.workspace.name,
            }
        )


class TeamPublicPageAssetEndpoint(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request, share, asset_id):
        s = _live_share(share)
        if not s:
            return Response({"error": "链接不存在或已关闭"}, status=status.HTTP_404_NOT_FOUND)
        asset = FileAsset.objects.filter(
            pk=asset_id,
            workspace_id=s.workspace_id,
            entity_type=FileAsset.EntityTypeContext.PAGE_DESCRIPTION,
            is_uploaded=True,
        ).filter(page_id=s.page_id).first() or FileAsset.objects.filter(
            pk=asset_id,
            workspace_id=s.workspace_id,
            entity_type=FileAsset.EntityTypeContext.PAGE_DESCRIPTION,
            entity_identifier=str(s.page_id),
            is_uploaded=True,
        ).first()
        if not asset and str(asset_id) in (s.page.description_html or ""):
            # Agent 通过 MCP 上传的图片还没挂在某篇文档上，正文里引用了它就能显示
            asset = FileAsset.objects.filter(
                pk=asset_id,
                workspace_id=s.workspace_id,
                project_id=s.project_id,
                entity_type=FileAsset.EntityTypeContext.PAGE_DESCRIPTION,
                page__isnull=True,
                is_uploaded=True,
            ).first()
        if not asset:
            return Response({"error": "图片不存在"}, status=status.HTTP_404_NOT_FOUND)
        url = S3Storage(request=request).generate_presigned_url(
            object_name=asset.asset.name,
            filename=asset.attributes.get("name"),
            disposition="inline",
            content_type=asset.attributes.get("type"),
        )
        return HttpResponseRedirect(url)
