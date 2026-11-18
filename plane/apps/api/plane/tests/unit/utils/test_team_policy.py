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
