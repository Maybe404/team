# [team 二开] 团队模板的增删改查：网页（会话）和 MCP（API Token）共用。
from django.db.models import Q
from rest_framework import status
from rest_framework.response import Response

from plane.db.models import ProjectMember, TeamTemplate, WorkspaceMember

KINDS = ("page", "issue")
MAX_BODY = 20000


def _bad(msg, code=status.HTTP_400_BAD_REQUEST):
    return Response({"error": msg}, status=code)


def template_dict(t, with_body=True):
    data = {
        "id": str(t.id),
        "kind": t.kind,
        "name": t.name,
        "description": t.description,
        "project_id": str(t.project_id) if t.project_id else None,
        "created_by": str(t.created_by_id) if t.created_by_id else None,
        "updated_at": t.updated_at.isoformat(),
    }
    if with_body:
        data["body"] = t.body
    return data


def visible_templates(user, slug):
    pids = list(ProjectMember.objects.filter(member=user, is_active=True, workspace__slug=slug).values_list("project_id", flat=True))
    return TeamTemplate.objects.filter(workspace__slug=slug).filter(Q(project__isnull=True) | Q(project_id__in=pids))


def handle_templates(request, slug, template_id=None):
    user = request.user
    wm = WorkspaceMember.objects.filter(workspace__slug=slug, member=user, is_active=True).first()
    if wm is None:
        return _bad("找不到这个工作区", status.HTTP_404_NOT_FOUND)
    qs = visible_templates(user, slug)
    if request.method == "GET":
        if template_id:
            t = qs.filter(pk=template_id).first()
            return Response(template_dict(t)) if t else _bad("没有这个模板", status.HTTP_404_NOT_FOUND)
        kind = request.query_params.get("kind")
        if kind in KINDS:
            qs = qs.filter(kind=kind)
        project = request.query_params.get("project")
        if project:
            qs = qs.filter(Q(project_id=project) | Q(project__isnull=True))
        return Response({"templates": [template_dict(t, with_body=False) for t in qs.order_by("kind", "name")]})

    def can_change(t):
        return t.created_by_id == user.id or wm.role == 20

    if request.method == "DELETE":
        t = qs.filter(pk=template_id).first() if template_id else None
        if t is None:
            return _bad("没有这个模板", status.HTTP_404_NOT_FOUND)
        if not can_change(t):
            return _bad("只有创建人和管理员能删除模板", status.HTTP_403_FORBIDDEN)
        t.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    data = request.data
    if request.method == "POST":
        kind = data.get("kind")
        name = str(data.get("name") or "").strip()
        if kind not in KINDS or not name:
            return _bad("需要 kind（page 或 issue）和 name")
        project_id = data.get("project_id") or None
        if project_id:
            if not ProjectMember.objects.filter(project_id=project_id, member=user, is_active=True, workspace__slug=slug).exists():
                return _bad("你不在这个项目里", status.HTTP_403_FORBIDDEN)
        elif wm.role < 15:
            return _bad("访客不能新建工作区通用模板", status.HTTP_403_FORBIDDEN)
        if TeamTemplate.objects.filter(workspace__slug=slug, kind=kind, project_id=project_id, name__iexact=name).exists():
            return _bad("同名模板已存在，用 template_id 更新它")
        t = TeamTemplate(workspace=wm.workspace, kind=kind, project_id=project_id, name=name[:120], created_by=user)
    else:  # PATCH
        t = qs.filter(pk=template_id).first() if template_id else None
        if t is None:
            return _bad("没有这个模板", status.HTTP_404_NOT_FOUND)
        if not can_change(t):
            return _bad("只有创建人和管理员能修改模板", status.HTTP_403_FORBIDDEN)
        if "name" in data and str(data["name"]).strip():
            t.name = str(data["name"]).strip()[:120]
    if "description" in data:
        t.description = str(data["description"] or "")[:300]
    if "body" in data:
        body = str(data["body"] or "")
        if len(body) > MAX_BODY:
            return _bad(f"模板正文最多 {MAX_BODY} 字")
        t.body = body
    # 明确保留创建人，不依赖请求上下文里的当前用户
    t.save(created_by_id=t.created_by_id or user.id)
    return Response(template_dict(t), status=status.HTTP_201_CREATED if request.method == "POST" else status.HTTP_200_OK)
