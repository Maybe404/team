# [team 二开] 编辑权限的申请、审批和共同维护人。文档（page）和工作项（issue）通用。
# 谁能管：文档作者、工作项创建人和指派人、工作区管理员。
# 谁能申请：能看到这个对象、又没有编辑权限的成员。批准后申请人成为共同维护人，等于拥有者本人的编辑权限（不含删除、改访问级别）。
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response

from plane.db.models import Notification, Issue, IssueAssignee, Page, Project, ProjectMember, ProjectPage, TeamEditor, TeamEditRequest, User, Workspace, WorkspaceMember
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
        member = ProjectMember.objects.filter(project_id=pid, member=user, is_active=True).first()
        if member is None:
            continue
        # 受限访客：项目没开「访客可看全部」时，只看得到自己创建的工作项、自己写的文档
        if member.role == 5 and not Project.objects.filter(pk=pid, guest_view_all_features=True).exists():
            creator = obj.created_by_id if entity_type == "issue" else obj.owned_by_id
            if creator != user.id:
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


def notify(kind, ws, entity_type, obj, actor, receiver_ids, message="", url=None):
    """网页通知中心里的编辑权限通知。kind：edit_request / edit_approved / edit_rejected / edit_added。
    data.team 给前端渲染（文字由前端按语言生成），data.issue_activity 只是为了兼容通知列表的通用字段。"""
    pids = entity_project_ids(entity_type, obj)
    pid = pids[0] if pids else None
    # 通知里带着标题和链接：只发给现在就看得到这个对象的人
    receiver_ids = [u.id for u in User.objects.filter(id__in=list(receiver_ids)) if can_view_entity(u, entity_type, obj)]
    if not receiver_ids:
        return
    if url:
        pass
    elif entity_type == "issue":
        url = f"{ws.slug}/browse/{obj.project.identifier}-{obj.sequence_id}"
    else:
        url = f"{ws.slug}/projects/{pid}/pages/{obj.id}" if pid else ""
    rows = [
        Notification(
            workspace=ws,
            project_id=pid,
            sender=f"in_app:team:{kind}",
            triggered_by=actor,
            receiver_id=rid,
            entity_identifier=obj.id,
            entity_name=entity_type,
            title=_title(entity_type, obj),
            message_stripped=message or None,
            data={
                "team": {"kind": kind, "entity_type": entity_type, "title": _title(entity_type, obj), "url": url, "message": message},
                "issue_activity": {"id": None, "actor": str(actor.id), "field": "team", "verb": "created", "new_value": kind, "old_value": ""},
            },
        )
        for rid in set(receiver_ids)
        if rid and rid != actor.id
    ]
    if rows:
        Notification.objects.bulk_create(rows)


def notify_intake_new(project, issue, actor):
    """有人提交了收集条目：通知项目管理员（网页通知）。网页入口和 API/MCP 入口共用。通知失败不影响提交。"""
    try:
        admins = list(ProjectMember.objects.filter(project_id=project.id, role=20, is_active=True).values_list("member_id", flat=True))
        notify("intake_new", project.workspace, "issue", issue, actor, admins, url=f"{project.workspace.slug}/projects/{project.id}/intake")
    except Exception as e:
        from plane.utils.exception_logger import log_exception

        log_exception(e)


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
            note = (request.data.get("message") or "")[:500]
            TeamEditRequest.objects.create(workspace=ws, entity_type=entity_type, entity_id=obj.id, requester=user, message=note)
            receivers = [i for i in owner_ids(entity_type, obj) if i]
            if not receivers:  # 拥有者已停用时转给管理员
                receivers = list(WorkspaceMember.objects.filter(workspace=ws, role=20, is_active=True).values_list("member_id", flat=True))
            notify("edit_request", ws, entity_type, obj, user, receivers, note)
    elif action in ("add_editor", "remove_editor", "decide"):
        if not can_manage(user, entity_type, obj):
            return _bad("只有拥有者或管理员能管理编辑权限", status.HTTP_403_FORBIDDEN)
        if action == "decide":
            req = TeamEditRequest.objects.filter(pk=request.data.get("request_id"), entity_type=entity_type, entity_id=obj.id, status="pending").first()
            if req is None:
                return _bad("没有这个待处理的申请")
            approve = bool(request.data.get("approve"))
            if approve and not can_view_entity(req.requester, entity_type, obj):
                return _bad("申请人现在已经没有这个项目的访问权限，不能批准")
            req.status = "approved" if approve else "rejected"
            req.decided_by = user
            req.decided_at = timezone.now()
            req.save()
            if approve:
                TeamEditor.objects.get_or_create(entity_type=entity_type, entity_id=obj.id, user_id=req.requester_id, defaults={"workspace": ws})
            notify("edit_approved" if approve else "edit_rejected", ws, entity_type, obj, user, [req.requester_id])
        else:
            uid = request.data.get("user_id")
            target = User.objects.filter(pk=uid).first()
            if target is None or not WorkspaceMember.objects.filter(workspace=ws, member=target, is_active=True).exists():
                return _bad("这个成员不在工作区里")
            if action == "add_editor" and not can_view_entity(target, entity_type, obj):
                return _bad("这个成员不在该对象所在的项目里（或看不到它），不能加为共同维护人")
            if action == "add_editor":
                _, created = TeamEditor.objects.get_or_create(entity_type=entity_type, entity_id=obj.id, user=target, defaults={"workspace": ws})
                if created:
                    notify("edit_added", ws, entity_type, obj, user, [target.id])
                TeamEditRequest.objects.filter(entity_type=entity_type, entity_id=obj.id, requester=target, status="pending").update(
                    status="approved", decided_by=user, decided_at=timezone.now()
                )
            else:
                TeamEditor.objects.filter(entity_type=entity_type, entity_id=obj.id, user=target).delete()
    else:
        return _bad("action 只能是 request、decide、add_editor、remove_editor")
    return Response(access_status(user, entity_type, obj))
