# [team 二开] 跨项目、跨文档的统一搜索：文档按标题和正文、工作项按标题和描述，只返回当前用户看得到的内容。
# 网页的全局搜索和 MCP 的 search 工具共用这里的可见性规则。
import re

from django.db.models import Q

from plane.db.models import Issue, Page, ProjectMember, ProjectPage
from plane.utils.team_page_tree import hidden_page_ids

KEY_RE = re.compile(r"^(.+)-(\d+)$")  # 和 MCP 的任务编号规则一致：数字、中文标识也算


def _terms(query):
    return [t for t in re.split(r"\s+", (query or "").strip()) if t][:6]


def _snippet(text, terms, width=60):
    text = (text or "").replace("\n", " ")
    low = text.lower()
    pos = min((low.find(t.lower()) for t in terms if low.find(t.lower()) >= 0), default=-1)
    if pos < 0:
        return text[: width * 2].strip()
    start = max(0, pos - width)
    end = min(len(text), pos + width + max(len(t) for t in terms))
    return ("…" if start else "") + text[start:end].strip() + ("…" if end < len(text) else "")


def visible_projects(user, slug, project_ids=None):
    qs = ProjectMember.objects.filter(
        member=user, is_active=True, workspace__slug=slug, project__archived_at__isnull=True, project__deleted_at__isnull=True
    ).select_related("project")
    if project_ids is not None:
        qs = qs.filter(project_id__in=project_ids)
    return {m.project_id: m for m in qs}


def all_hidden_page_ids(user, projects):
    out = set()
    for pid in projects:
        out |= hidden_page_ids(user, pid)
    return out


def search_pages(user, slug, query, projects, limit=20):
    terms = _terms(query)
    if not terms or not projects:
        return []
    q = Q()
    for t in terms:
        q &= Q(page__name__icontains=t) | Q(page__description_stripped__icontains=t)
    # 可见性放进查询里再截断，否则大量别人的私有文档会把可见的挤出结果
    vis = Q()
    for pid, m in projects.items():
        pq = Q(project_id=pid) & (Q(page__access=Page.PUBLIC_ACCESS) | Q(page__owned_by=user))
        if m.role == 5 and not m.project.guest_view_all_features:
            pq &= Q(page__owned_by=user)
        vis |= pq
    rows = (
        ProjectPage.objects.filter(project_id__in=list(projects), deleted_at__isnull=True, page__archived_at__isnull=True, page__workspace__slug=slug)
        .filter(vis)
        .exclude(page_id__in=list(all_hidden_page_ids(user, projects)))
        .filter(q)
        .select_related("page")
        .order_by("-page__updated_at")[:400]
    )
    hidden = {}
    out, seen = [], set()
    for pp in rows:
        page, member = pp.page, projects[pp.project_id]
        if page.id in seen:
            continue
        if page.access == Page.PRIVATE_ACCESS and page.owned_by_id != user.id:
            continue
        if member.role == 5 and not member.project.guest_view_all_features and page.owned_by_id != user.id:
            continue
        if pp.project_id not in hidden:
            hidden[pp.project_id] = hidden_page_ids(user, pp.project_id)
        if page.id in hidden[pp.project_id]:
            continue
        seen.add(page.id)
        name_hit = any(t.lower() in (page.name or "").lower() for t in terms)
        out.append(
            (
                0 if name_hit else 1,
                {
                    "type": "page",
                    "id": str(page.id),
                    "project_id": str(pp.project_id),
                    "project": member.project.name,
                    "identifier": member.project.identifier,
                    "title": page.name,
                    "snippet": _snippet(page.description_stripped, terms),
                    "updated_at": page.updated_at.isoformat(),
                },
            )
        )
    out.sort(key=lambda x: x[0])
    return [o[1] for o in out[:limit]]


def search_issues(user, slug, query, projects, limit=20):
    terms = _terms(query)
    if not terms or not projects:
        return []
    key = KEY_RE.match((query or "").strip())
    if key:
        q = Q(project__identifier__iexact=key.group(1), sequence_id=int(key.group(2)))
    else:
        q = Q()
        for t in terms:
            q &= Q(name__icontains=t) | Q(description_stripped__icontains=t)
    vis = Q()
    for pid, m in projects.items():
        pq = Q(project_id=pid)
        if m.role == 5 and not m.project.guest_view_all_features:
            pq &= Q(created_by=user)
        vis |= pq
    rows = (
        Issue.issue_objects.filter(project_id__in=list(projects), workspace__slug=slug)
        .filter(vis)
        .filter(q)
        .select_related("project", "state")
        .order_by("-updated_at")[:200]
    )
    out = []
    for it in rows:
        member = projects[it.project_id]
        if member.role == 5 and not member.project.guest_view_all_features and it.created_by_id != user.id:
            continue
        name_hit = any(t.lower() in (it.name or "").lower() for t in terms) or bool(key)
        out.append(
            (
                0 if name_hit else 1,
                {
                    "type": "issue",
                    "id": str(it.id),
                    "project_id": str(it.project_id),
                    "project": it.project.name,
                    "identifier": it.project.identifier,
                    "key": f"{it.project.identifier}-{it.sequence_id}",
                    "title": it.name,
                    "state": it.state.name if it.state_id else None,
                    "snippet": _snippet(it.description_stripped, terms),
                    "updated_at": it.updated_at.isoformat(),
                },
            )
        )
    out.sort(key=lambda x: x[0])
    return [o[1] for o in out[:limit]]


def team_search(user, slug, query, types=("page", "issue"), project_ids=None, limit=20):
    projects = visible_projects(user, slug, project_ids)
    limit = max(1, min(int(limit or 20), 50))
    result = {}
    if "page" in types:
        result["pages"] = search_pages(user, slug, query, projects, limit)
    if "issue" in types:
        result["issues"] = search_issues(user, slug, query, projects, limit)
    return result
