# [team 二开] 工作项描述版本：和文档版本同一套规则（锁定、命名、来源、接口改写前后各存一版）。
from datetime import timedelta

from django.utils import timezone

from plane.db.models import IssueDescriptionVersion

MAX_UNLOCKED_VERSIONS = 50


def trim_versions(issue_id):
    qs = IssueDescriptionVersion.objects.filter(issue_id=issue_id, is_locked=False)
    keep = list(qs.order_by("-last_saved_at").values_list("id", flat=True)[:MAX_UNLOCKED_VERSIONS])
    qs.exclude(id__in=keep).delete()


def latest_version(issue_id):
    return IssueDescriptionVersion.objects.filter(issue_id=issue_id).order_by("-last_saved_at").first()


def _create(issue, user_id, source, label="", lock=False, when=None, html=None, binary=None, json=None, stripped=None):
    return IssueDescriptionVersion.objects.create(
        workspace_id=issue.workspace_id,
        project_id=issue.project_id,
        issue_id=issue.id,
        owned_by_id=user_id,
        last_saved_at=when or timezone.now(),
        description_html=issue.description_html if html is None else html,
        description_binary=issue.description_binary if binary is None else binary,
        description_json=(issue.description_json if json is None else json) or {},
        description_stripped=issue.description_stripped if stripped is None else stripped,
        label=label[:255],
        is_locked=lock,
        source=source,
    )


def record_change(issue, user, old_state, source="api", keep_before=True):
    """接口改写描述后调用：old_state = (html, binary, json, stripped) 是改写前内容；issue 必须是已保存的最新状态。"""
    old_html, old_binary, old_json, old_stripped = old_state
    last = latest_version(issue.id)
    if keep_before and old_html and old_html != "<p></p>" and (last is None or last.description_html != old_html):
        _create(issue, (last.owned_by_id if last else (issue.created_by_id or user.id)), "before-" + source,
                when=timezone.now() - timedelta(seconds=1), html=old_html, binary=old_binary, json=old_json, stripped=old_stripped)
    version = _create(issue, user.id, source)
    trim_versions(issue.id)
    return version


def snapshot_current(issue, user, label="", lock=False, source="manual"):
    last = latest_version(issue.id)
    if last is not None and last.description_html == issue.description_html:
        # 恢复前的自动保存：已有相同内容的版本就原样复用，不改名字、来源和锁定
        if source == "before-restore":
            return last, False
        changed = []
        if last.source != source:
            last.source = source
            changed.append("source")
        if label and last.label != label[:255]:
            last.label = label[:255]
            changed.append("label")
        if lock and not last.is_locked:
            last.is_locked = True
            changed.append("is_locked")
        if changed:
            last.save(update_fields=changed + ["updated_at"])
        return last, False
    version = _create(issue, user.id, source, label=label, lock=lock)
    trim_versions(issue.id)
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
