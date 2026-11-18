# [team 二开] 编辑权限的申请、审批和共同维护人。文档（page）和工作项（issue）通用。
# 谁能管：文档作者、工作项创建人和指派人、工作区管理员。
# 谁能申请：能看到这个对象、又没有编辑权限的成员。批准后申请人成为共同维护人，等于拥有者本人的编辑权限（不含删除、改访问级别）。
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response

from plane.db.models import Issue, IssueAssignee, Page, ProjectMember, ProjectPage, TeamEditor, TeamEditRequest, User, Workspace, WorkspaceMember
from plane.utils.team_edit_policy import can_edit_issue, can_edit_page, is_workspace_admin


def get_entity(entity_type, entity_id, slug):
    if entity_type == "page":
        return Page.objects.filter(pk=entity_id, workspace__slug=slug).first()
    if entity_type == "issue":
        return Issue.objects.filter(pk=entity_id, workspace__slug=slug).first()
    return None


def entity_project_ids(entity_type, obj):
    if entity_type == "issue":
        return [obj.project_id]
    return list(ProjectPage.objects.filter(page_id=obj.id, deleted_at__isnull=True).values_list("project_id", flat=True))


def can_view_entity(user, entity_type, obj, project_id=None):
    """能不能看到这个对象：必须是它所在项目的在职成员；文档还要自己看得到（不是别人的私有页，祖先里也没有别人的私有页）。"""
    from plane.utils.team_page_tree import hidden_page_ids

    pids = [project_id] if project_id else entity_project_ids(entity_type, obj)
    for pid in pids:
        if not ProjectMember.objects.filter(project_id=pid, member=user, is_active=True).exists():
            continue
        if entity_type == "page":
            if obj.access == Page.PRIVATE_ACCESS and obj.owned_by_id != user.id:
                continue
            if obj.id in hidden_page_ids(user, pid):
                continue
        return True
    return False


def can_edit(user, entity_type, obj):
    return can_edit_page(user, obj) if entity_type == "page" else can_edit_issue(user, obj)


def owner_ids(entity_type, obj):
    if entity_type == "page":
        return {obj.owned_by_id}
    ids = {obj.created_by_id}
    ids.update(IssueAssignee.objects.filter(issue_id=obj.id).values_list("assignee_id", flat=True))
    return ids


def can_manage(user, entity_type, obj):
    return user.id in owner_ids(entity_type, obj) or is_workspace_admin(user, obj.workspace_id)


def _person(user_id):
    u = User.objects.filter(pk=user_id).only("id", "display_name", "first_name", "last_name").first()
    if not u:
        return {"id": str(user_id), "name": "未知用户"}
    full = f"{u.first_name or ''} {u.last_name or ''}".strip()
    return {"id": str(u.id), "name": full or u.display_name}


def _title(entity_type, obj):
    return obj.name


def access_status(user, entity_type, obj):
    manage = can_manage(user, entity_type, obj)
    editors = [
        _person(uid) for uid in TeamEditor.objects.filter(entity_type=entity_type, entity_id=obj.id).values_list("user_id", flat=True)
    ]
    data = {
        "entity_type": entity_type,
        "entity_id": str(obj.id),
        "title": _title(entity_type, obj),
        "can_edit": can_edit(user, entity_type, obj),
        "can_manage": manage,
        "owners": [_person(i) for i in owner_ids(entity_type, obj) if i],
        "editors": editors,
    }
    mine = TeamEditRequest.objects.filter(entity_type=entity_type, entity_id=obj.id, requester=user).order_by("-created_at").first()
    data["my_request"] = (
        {"id": str(mine.id), "status": mine.status, "message": mine.message} if mine and not data["can_edit"] else None
    )
    if manage:
        data["requests"] = [
            {"id": str(r.id), "requester": _person(r.requester_id), "message": r.message, "created_at": r.created_at.isoformat()}
            for r in TeamEditRequest.objects.filter(entity_type=entity_type, entity_id=obj.id, status="pending").order_by("created_at")
        ]
    return data


def pending_for_user(user, slug):
    """我能处理的待审批申请，给收件箱用。"""
    admin = WorkspaceMember.objects.filter(workspace__slug=slug, member=user, role=20, is_active=True).exists()
    out = []
    for r in TeamEditRequest.objects.filter(workspace__slug=slug, status="pending").order_by("created_at"):
        obj = get_entity(r.entity_type, r.entity_id, slug)
        if obj is None:
            continue
        if (admin or user.id in owner_ids(r.entity_type, obj)) and can_view_entity(user, r.entity_type, obj):
            pids = entity_project_ids(r.entity_type, obj)
            out.append(
                {
                    "id": str(r.id),
                    "entity_type": r.entity_type,
                    "entity_id": str(r.entity_id),
                    "project_id": str(pids[0]) if pids else "",
                    "key": f"{obj.project.identifier}-{obj.sequence_id}" if r.entity_type == "issue" else None,
                    "title": _title(r.entity_type, obj),
                    "requester": _person(r.requester_id),
                    "message": r.message,
                }
            )
    return out


def _bad(msg, code=status.HTTP_400_BAD_REQUEST):
    return Response({"error": msg}, status=code)


def handle_access(request, slug, entity_type, entity_id):
    if entity_type not in ("page", "issue"):
        return _bad("类型只能是 page 或 issue")
    obj = get_entity(entity_type, entity_id, slug)
    if obj is None:
        return _bad("找不到这个对象", status.HTTP_404_NOT_FOUND)
    user = request.user
    if not WorkspaceMember.objects.filter(workspace__slug=slug, member=user, is_active=True).exists():
        return _bad("找不到这个对象", status.HTTP_404_NOT_FOUND)
    # 项目成员才看得到；别人的私有文档（含祖先里有私有页的子页面）一律当作不存在
    if not can_view_entity(user, entity_type, obj):
        return _bad("找不到这个对象", status.HTTP_404_NOT_FOUND)
    if request.method == "GET":
        return Response(access_status(user, entity_type, obj))

    action = request.data.get("action")
    ws = Workspace.objects.get(slug=slug)
    if action == "request":
        if can_edit(user, entity_type, obj):
            return _bad("你已经有编辑权限了")
        exists = TeamEditRequest.objects.filter(entity_type=entity_type, entity_id=obj.id, requester=user, status="pending").exists()
        if not exists:
            TeamEditRequest.objects.create(
                workspace=ws, entity_type=entity_type, entity_id=obj.id, requester=user, message=(request.data.get("message") or "")[:500]
            )
    elif action in ("add_editor", "remove_editor", "decide"):
        if not can_manage(user, entity_type, obj):
            return _bad("只有拥有者或管理员能管理编辑权限", status.HTTP_403_FORBIDDEN)
        if action == "decide":
            req = TeamEditRequest.objects.filter(pk=request.data.get("request_id"), entity_type=entity_type, entity_id=obj.id, status="pending").first()
            if req is None:
                return _bad("没有这个待处理的申请")
            approve = bool(request.data.get("approve"))
            req.status = "approved" if approve else "rejected"
            req.decided_by = user
            req.decided_at = timezone.now()
            req.save()
            if approve:
                TeamEditor.objects.get_or_create(entity_type=entity_type, entity_id=obj.id, user_id=req.requester_id, defaults={"workspace": ws})
        else:
            uid = request.data.get("user_id")
            target = User.objects.filter(pk=uid).first()
            if target is None or not WorkspaceMember.objects.filter(workspace=ws, member=target, is_active=True).exists():
                return _bad("这个成员不在工作区里")
            if action == "add_editor":
                TeamEditor.objects.get_or_create(entity_type=entity_type, entity_id=obj.id, user=target, defaults={"workspace": ws})
                TeamEditRequest.objects.filter(entity_type=entity_type, entity_id=obj.id, requester=target, status="pending").update(
                    status="approved", decided_by=user, decided_at=timezone.now()
                )
            else:
                TeamEditor.objects.filter(entity_type=entity_type, entity_id=obj.id, user=target).delete()
    else:
        return _bad("action 只能是 request、decide、add_editor、remove_editor")
    return Response(access_status(user, entity_type, obj))
