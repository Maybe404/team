# [team 二开] 页面版本管理：谁改的、怎么改的都要留痕，Agent 整篇改写也不例外。
# - 编辑器自动存的版本由 page_version_task 负责（同一个人 10 分钟内合并成一版）。
# - 接口（MCP/Agent）改写正文：改写前存一份、改写后存一份，不合并。
# - 人或 Agent 可以手动存快照、给版本起名、锁定。锁定的版本不会被自动清理，也不会被后续编辑覆盖。
# - 未锁定的版本每篇最多保留 20 个，锁定的不占这个名额。
from datetime import timedelta

from django.utils import timezone

from plane.db.models import PageVersion

MAX_UNLOCKED_VERSIONS = 20


def trim_versions(page_id):
    keep = PageVersion.objects.filter(page_id=page_id, is_locked=False).order_by("-last_saved_at").values_list("id", flat=True)[:MAX_UNLOCKED_VERSIONS]
    PageVersion.objects.filter(page_id=page_id, is_locked=False).exclude(id__in=list(keep)).delete()


def _create(page, user_id, source, label="", lock=False, when=None, html=None, binary=None, json=None):
    return PageVersion.objects.create(
        workspace_id=page.workspace_id,
        page_id=page.id,
        owned_by_id=user_id,
        last_saved_at=when or timezone.now(),
        description_html=page.description_html if html is None else html,
        description_binary=page.description_binary if binary is None else binary,
        description_json=(page.description_json if json is None else json) or {},
        label=label[:255],
        is_locked=lock,
        source=source,
    )


def latest_version(page_id):
    return PageVersion.objects.filter(page_id=page_id).order_by("-last_saved_at").first()


def record_change(page, user, old_state, source="api"):
    """接口改写正文后调用：old_state = (html, binary, json) 是改写前的内容。page 必须是已保存的最新状态。"""
    old_html, old_binary, old_json = old_state
    last = latest_version(page.id)
    if old_html and (last is None or last.description_html != old_html):
        _create(page, page.owned_by_id, "before-" + source, when=timezone.now() - timedelta(seconds=1), html=old_html, binary=old_binary, json=old_json)
    version = _create(page, user.id, source)
    trim_versions(page.id)
    return version


def snapshot_current(page, user, label="", lock=False, source="manual"):
    """把当前内容存成一个版本；和最新一版内容相同就直接给它加名字/锁，不重复存。"""
    last = latest_version(page.id)
    if last is not None and last.description_html == page.description_html:
        changed = []
        if label and last.label != label[:255]:
            last.label = label[:255]
            changed.append("label")
        if lock and not last.is_locked:
            last.is_locked = True
            changed.append("is_locked")
        if changed:
            last.save(update_fields=changed + ["updated_at"])
        return last, False
    version = _create(page, user.id, source, label=label, lock=lock)
    trim_versions(page.id)
    return version, True


def version_dict(v, with_body=False):
    data = {
        "id": str(v.id),
        "last_saved_at": v.last_saved_at.isoformat(),
        "owned_by": str(v.owned_by_id),
        "is_locked": v.is_locked,
        "label": v.label,
        "source": v.source,
    }
    if with_body:
        data["description_html"] = v.description_html
    return data
