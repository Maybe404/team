# [team 二开] 编辑权限、可见性、版本管理的回归测试
import json
from uuid import uuid4
from datetime import timedelta
from types import SimpleNamespace

import pytest
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied

from plane.db.models import (
    Issue,
    Page,
    PageVersion,
    Project,
    ProjectMember,
    ProjectPage,
    TeamEditor,
    User,
    Workspace,
    WorkspaceMember,
)


def make_user(name):
    return User.objects.create(email=f"{name}@t.test", username=f"{name}-{uuid4().hex[:8]}", first_name=name, last_name="X")


@pytest.fixture
def world(db):
    owner, other, admin = make_user("owner"), make_user("other"), make_user("admin")
    ws = Workspace.objects.create(name="W", owner=admin, slug="ws-policy")
    for u, role in ((owner, 15), (other, 15), (admin, 20)):
        WorkspaceMember.objects.create(workspace=ws, member=u, role=role)
    project = Project.objects.create(name="P", identifier="PP", workspace=ws, created_by=owner)
    for u in (owner, other):
        ProjectMember.objects.create(project=project, member=u, role=15, workspace=ws)
    page = Page.objects.create(name="doc", workspace=ws, owned_by=owner, description_html="<p>v1</p>")
    ProjectPage.objects.create(page=page, project=project, workspace=ws)
    issue = Issue.objects.create(name="t", project=project, workspace=ws)
    Issue.objects.filter(pk=issue.pk).update(created_by=owner)  # 模型保存时会按当前请求用户覆盖 created_by
    issue.refresh_from_db()
    return SimpleNamespace(ws=ws, owner=owner, other=other, admin=admin, project=project, page=page, issue=issue)


def fake_view(name, action=None):
    return type(name, (), {"action": action})()


def req(user, method="POST", data=None):
    return SimpleNamespace(user=user, method=method, data=data or {})


@pytest.mark.parametrize("action", ["lock", "unlock", "archive", "unarchive", "access"])
def test_page_actions_blocked_for_non_owner(world, action):
    from plane.utils.team_edit_policy import enforce_edit_policy

    view = fake_view("PageViewSet", action)
    with pytest.raises(PermissionDenied):
        enforce_edit_policy(view, req(world.other), {"page_id": world.page.id})
    enforce_edit_policy(view, req(world.owner), {"page_id": world.page.id})
    enforce_edit_policy(view, req(world.admin), {"page_id": world.page.id})
    TeamEditor.objects.create(workspace=world.ws, entity_type="page", entity_id=world.page.id, user=world.other)
    enforce_edit_policy(view, req(world.other), {"page_id": world.page.id})


def test_issue_archive_and_bulk_blocked_for_non_owner(world):
    from plane.utils.team_edit_policy import enforce_edit_policy

    with pytest.raises(PermissionDenied):
        enforce_edit_policy(fake_view("IssueArchiveViewSet", "archive"), req(world.other), {"pk": world.issue.id})
    bulk = fake_view("BulkArchiveIssuesEndpoint")
    with pytest.raises(PermissionDenied):
        enforce_edit_policy(bulk, req(world.other, data={"issue_ids": [str(world.issue.id)]}), {})
    enforce_edit_policy(bulk, req(world.owner, data={"issue_ids": [str(world.issue.id)]}), {})
    dates = fake_view("IssueBulkUpdateDateEndpoint")
    with pytest.raises(PermissionDenied):
        enforce_edit_policy(dates, req(world.other, data={"updates": [{"id": str(world.issue.id)}]}), {})


def test_hidden_pages_not_visible(world):
    from plane.utils.team_access import can_view_entity

    assert can_view_entity(world.other, "page", world.page)
    world.page.access = Page.PRIVATE_ACCESS
    world.page.save()
    assert not can_view_entity(world.other, "page", world.page)
    assert can_view_entity(world.owner, "page", world.page)
    child = Page.objects.create(name="child", workspace=world.ws, owned_by=world.other, parent=world.page)
    ProjectPage.objects.create(page=child, project=world.project, workspace=world.ws)
    # 祖先是别人的私有页：子页面对 other 也看不到，哪怕它自己是作者
    assert not can_view_entity(world.other, "page", child)


def test_non_project_member_cannot_view(world):
    from plane.utils.team_access import can_view_entity

    outsider = make_user("out")
    WorkspaceMember.objects.create(workspace=world.ws, member=outsider, role=15)
    assert not can_view_entity(outsider, "issue", world.issue)
    assert not can_view_entity(outsider, "page", world.page)


def test_autosave_does_not_overwrite_manual_snapshot(world):
    from plane.bgtasks.page_version_task import track_page_version
    from plane.utils.team_page_version import snapshot_current

    snap, _ = snapshot_current(world.page, world.owner, label="基线", source="manual")
    world.page.description_html = "<p>v2</p>"
    world.page.save()
    track_page_version(world.page.id, json.dumps({"description_html": "<p>v1</p>"}), world.owner.id)
    snap.refresh_from_db()
    assert snap.description_html == "<p>v1</p>"
    assert PageVersion.objects.filter(page=world.page).count() == 2


def test_autosave_still_merges_editor_versions(world):
    from plane.bgtasks.page_version_task import track_page_version

    world.page.description_html = "<p>a</p>"
    world.page.save()
    track_page_version(world.page.id, json.dumps({"description_html": ""}), world.owner.id)
    world.page.description_html = "<p>b</p>"
    world.page.save()
    track_page_version(world.page.id, json.dumps({"description_html": "<p>a</p>"}), world.owner.id)
    assert PageVersion.objects.filter(page=world.page).count() == 1


def test_record_change_keep_before_flag(world):
    from plane.utils.team_page_version import record_change

    old = ("<p>old</p>", None, {})
    world.page.description_html = "<p>new</p>"
    world.page.save()
    record_change(world.page, world.other, old, source="restore", keep_before=False)
    assert not PageVersion.objects.filter(page=world.page, source="before-restore").exists()
    record_change(world.page, world.other, old, source="mcp")
    assert PageVersion.objects.filter(page=world.page, source="before-mcp").exists()


def test_trim_keeps_locked(world):
    from plane.utils.team_page_version import MAX_UNLOCKED_VERSIONS, trim_versions

    locked = PageVersion.objects.create(
        page=world.page, workspace=world.ws, owned_by=world.owner, last_saved_at=timezone.now() - timedelta(days=30), is_locked=True, description_html="x"
    )
    for i in range(MAX_UNLOCKED_VERSIONS + 5):
        PageVersion.objects.create(
            page=world.page, workspace=world.ws, owned_by=world.owner, last_saved_at=timezone.now() - timedelta(minutes=i), description_html=str(i)
        )
    trim_versions(world.page.id)
    assert PageVersion.objects.filter(page=world.page, is_locked=False).count() == MAX_UNLOCKED_VERSIONS
    assert PageVersion.objects.filter(pk=locked.pk).exists()


def test_unnamed_manual_snapshot_not_overwritten_by_autosave(world):
    from plane.bgtasks.page_version_task import track_page_version
    from plane.utils.team_page_version import snapshot_current

    # 先有一个自动版本，内容和当前一致；手动保存（不命名）复用它，之后继续编辑不能覆盖
    world.page.description_html = "<p>a</p>"
    world.page.save()
    track_page_version(world.page.id, json.dumps({"description_html": ""}), world.owner.id)
    snap, created = snapshot_current(world.page, world.owner, source="manual")
    assert not created
    world.page.description_html = "<p>b</p>"
    world.page.save()
    track_page_version(world.page.id, json.dumps({"description_html": "<p>a</p>"}), world.owner.id)
    snap.refresh_from_db()
    assert snap.description_html == "<p>a</p>"


def test_daily_cleanup_respects_cap_and_locked(world):
    from plane.bgtasks.cleanup_task import get_page_versions_queryset
    from plane.utils.team_page_version import MAX_UNLOCKED_VERSIONS

    for i in range(MAX_UNLOCKED_VERSIONS + 5):
        PageVersion.objects.create(
            page=world.page, workspace=world.ws, owned_by=world.owner, last_saved_at=timezone.now() - timedelta(minutes=i), description_html=str(i)
        )
    locked = PageVersion.objects.create(
        page=world.page, workspace=world.ws, owned_by=world.owner, last_saved_at=timezone.now() - timedelta(days=90), is_locked=True, description_html="L"
    )
    doomed = set(get_page_versions_queryset())
    assert len(doomed) == 5
    assert locked.id not in doomed


def test_restricted_guest_cannot_view_others_items(world):
    from plane.utils.team_access import can_view_entity

    guest = make_user("guest")
    WorkspaceMember.objects.create(workspace=world.ws, member=guest, role=5)
    ProjectMember.objects.create(project=world.project, member=guest, role=5, workspace=world.ws)
    assert not can_view_entity(guest, "issue", world.issue)
    assert not can_view_entity(guest, "page", world.page)
    Project.objects.filter(pk=world.project.pk).update(guest_view_all_features=True)
    assert can_view_entity(guest, "issue", world.issue)
    assert can_view_entity(guest, "page", world.page)


def test_unified_search_content_and_visibility(world):
    from plane.utils.team_search import team_search

    Page.objects.filter(pk=world.page.pk).update(description_stripped="关于发布流程的说明，重点是灰度发布")
    r = team_search(world.other, world.ws.slug, "灰度")
    assert [p["id"] for p in r["pages"]] == [str(world.page.id)]
    assert "灰度" in r["pages"][0]["snippet"]
    # 别人的私有页面、以及它的子页面搜不到
    Page.objects.filter(pk=world.page.pk).update(access=Page.PRIVATE_ACCESS)
    child = Page.objects.create(name="child", workspace=world.ws, owned_by=world.other, parent=world.page, description_stripped="灰度细节")
    ProjectPage.objects.create(page=child, project=world.project, workspace=world.ws)
    assert team_search(world.other, world.ws.slug, "灰度")["pages"] == []
    assert len(team_search(world.owner, world.ws.slug, "灰度")["pages"]) >= 1
    # 不在项目里的人什么都搜不到；工作项编号能直接命中
    outsider = make_user("out2")
    WorkspaceMember.objects.create(workspace=world.ws, member=outsider, role=15)
    assert team_search(outsider, world.ws.slug, "灰度") == {"pages": [], "issues": []}
    hit = team_search(world.owner, world.ws.slug, f"PP-{world.issue.sequence_id}", types=("issue",))
    assert [i["id"] for i in hit["issues"]] == [str(world.issue.id)]


def test_edit_request_notifications(world):
    from plane.db.models import Notification
    from plane.utils.team_access import handle_access

    slug = world.ws.slug
    r = handle_access(req(world.other, "POST", {"action": "request", "message": "想改个错别字"}), slug, "page", world.page.id)
    assert r.status_code == 200
    n = Notification.objects.get(receiver=world.owner, entity_name="page")
    assert n.data["team"]["kind"] == "edit_request" and n.data["team"]["message"] == "想改个错别字"
    assert n.data["team"]["url"].endswith(f"/pages/{world.page.id}") and n.triggered_by_id == world.other.id
    req_id = r.data["my_request"]["id"]
    handle_access(req(world.owner, "POST", {"action": "decide", "request_id": req_id, "approve": True}), slug, "page", world.page.id)
    assert Notification.objects.filter(receiver=world.other, data__team__kind="edit_approved").exists()
    # 重复申请不重复通知；工作项用编号链接
    third = make_user("third")
    WorkspaceMember.objects.create(workspace=world.ws, member=third, role=15)
    ProjectMember.objects.create(project=world.project, member=third, role=15, workspace=world.ws)
    handle_access(req(third, "POST", {"action": "request"}), slug, "issue", world.issue.id)
    handle_access(req(third, "POST", {"action": "request"}), slug, "issue", world.issue.id)
    notes = Notification.objects.filter(receiver=world.owner, entity_name="issue")
    assert notes.count() == 1 and notes[0].data["team"]["url"].endswith(f"/browse/PP-{world.issue.sequence_id}")


def test_issue_versions_record_lock_and_autosave(world):
    from plane.bgtasks.issue_description_version_task import should_update_existing_version
    from plane.db.models import IssueDescriptionVersion as IDV
    from plane.utils import team_issue_version as iv

    issue = world.issue
    issue.description_html = "<p>first</p>"
    issue.save()
    old = ("<p>first</p>", None, {}, "first")
    issue.description_html = "<p>second</p>"
    issue.save()
    iv.record_change(issue, world.owner, old, source="mcp")
    versions = list(IDV.objects.filter(issue_id=issue.id).order_by("last_saved_at"))
    assert [v.source for v in versions] == ["before-mcp", "mcp"]
    assert versions[0].description_html == "<p>first</p>"
    # 接口改写留下的版本，编辑器自动保存不能合并覆盖
    assert not should_update_existing_version(versions[1], str(world.owner.id))
    # 手动快照 + 锁定后超过上限也不被清理
    v, _ = iv.snapshot_current(issue, world.owner, label="定稿", lock=True)
    assert v.is_locked and v.label == "定稿" and v.source == "manual"
    for i in range(iv.MAX_UNLOCKED_VERSIONS + 5):
        issue.description_html = f"<p>n{i}</p>"
        issue.save()
        iv.record_change(issue, world.owner, ("", None, {}, ""), source="mcp")
    assert IDV.objects.filter(issue_id=issue.id, is_locked=True).count() == 1
    assert IDV.objects.filter(issue_id=issue.id, is_locked=False).count() == iv.MAX_UNLOCKED_VERSIONS


def test_access_notifications_and_grants_require_project_visibility(world):
    from plane.db.models import Notification, TeamEditRequest
    from plane.utils.team_access import handle_access, notify
    from plane.utils.team_search import team_search

    slug = world.ws.slug
    outsider = make_user("out3")
    WorkspaceMember.objects.create(workspace=world.ws, member=outsider, role=15)
    # 工作区成员但不在项目里：不能被加为共同维护人，也收不到带标题的通知
    r = handle_access(req(world.owner, "POST", {"action": "add_editor", "user_id": str(outsider.id)}), slug, "issue", world.issue.id)
    assert r.status_code == 400
    notify("edit_added", world.ws, "issue", world.issue, world.owner, [outsider.id])
    assert not Notification.objects.filter(receiver=outsider).exists()
    # 申请人之后被移出项目：批准会被拒绝
    TeamEditRequest.objects.create(entity_type="issue", entity_id=world.issue.id, requester=outsider, workspace=world.ws, status="pending")
    rid = TeamEditRequest.objects.get(requester=outsider).id
    r = handle_access(req(world.owner, "POST", {"action": "decide", "request_id": str(rid), "approve": True}), slug, "issue", world.issue.id)
    assert r.status_code == 400
    assert TeamEditRequest.objects.get(pk=rid).status == "pending"
    # 搜索：项目列表为空表示没有可搜项目
    assert team_search(world.owner, slug, "t", ("issue",), [])["issues"] == []


def test_restore_save_keeps_locked_label_and_search_edge_cases(world):
    from plane.utils import team_page_version as pv
    from plane.utils.team_search import team_search

    # 回退前自动保存：已有相同内容的锁定快照，不改名字和来源
    v, _ = pv.snapshot_current(world.page, world.owner, label="发布定稿", lock=True)
    again, created = pv.snapshot_current(world.page, world.owner, label="恢复前自动保存", source="before-restore")
    assert not created and again.id == v.id
    again.refresh_from_db()
    assert again.label == "发布定稿" and again.source == "manual" and again.is_locked
    # 数字项目标识：按完整编号能搜到
    Project.objects.filter(pk=world.project.pk).update(identifier="2025")
    hit = team_search(world.owner, world.ws.slug, f"2025-{world.issue.sequence_id}", types=("issue",))
    assert [i["id"] for i in hit["issues"]] == [str(world.issue.id)]
    # 更新的私有文档再多，也不能把可见文档挤出结果
    Page.objects.filter(pk=world.page.pk).update(name="季度复盘", description_stripped="季度复盘")
    for i in range(405):
        p = Page.objects.create(name=f"季度复盘{i}", workspace=world.ws, owned_by=world.owner, access=Page.PRIVATE_ACCESS, description_stripped="季度复盘")
        ProjectPage.objects.create(page=p, project=world.project, workspace=world.ws)
    r = team_search(world.other, world.ws.slug, "季度复盘", types=("page",))
    assert [p["id"] for p in r["pages"]] == [str(world.page.id)]
