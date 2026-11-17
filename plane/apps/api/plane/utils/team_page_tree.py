# [team 二开] 文档层级（子页面）的共用逻辑：谁能看到哪些子页面、防止成环、找后代。
#
# 规则：
#  - 子页面的公开/私有各自独立，新建时默认跟父页面一致。
#  - 父页面（或更上层的祖先）是别人的私有页面时，整棵子树对其他人隐藏，标题也不泄露。
#  - 在别人的页面下面挂子页面不算修改父页面，不受「只能改自己的」限制。
from uuid import UUID

from plane.db.models import Page, ProjectPage

PRIVATE = 1  # Page.PRIVATE_ACCESS


def _rows(project_id):
    return list(
        Page.objects.filter(project_pages__project_id=project_id, project_pages__deleted_at__isnull=True).values_list(
            "id", "parent_id", "access", "owned_by_id"
        )
    )


def hidden_page_ids(user, project_id):
    """当前用户看不到的页面：自己看不到（别人的私有页），或祖先里有别人的私有页。"""
    rows = {r[0]: r for r in _rows(project_id)}

    def hidden(pid, seen=()):
        r = rows.get(pid)
        if r is None or pid in seen:
            return False
        if r[2] == PRIVATE and r[3] != user.id:
            return True
        return r[1] is not None and hidden(r[1], seen + (pid,))

    return {pid for pid in rows if hidden(pid)}


def descendant_ids(page_id, project_id):
    """页面的所有后代（不含自己）。"""
    page_id = UUID(str(page_id))
    children = {}
    for pid, parent, _a, _o in _rows(project_id):
        children.setdefault(parent, []).append(pid)
    out, stack = [], list(children.get(page_id, []))
    while stack:
        cur = stack.pop()
        if cur in out or cur == page_id:
            continue
        out.append(cur)
        stack.extend(children.get(cur, []))
    return out


def check_parent(page_id, parent_id, project_id):
    """返回错误文案；合法返回 None。父页面必须在同项目，且不能是自己或自己的后代。"""
    if not parent_id:
        return None
    if str(parent_id) == str(page_id):
        return "不能把页面放在它自己下面"
    if not ProjectPage.objects.filter(page_id=parent_id, project_id=project_id, deleted_at__isnull=True).exists():
        return "父页面不在这个项目里"
    if page_id and str(parent_id) in {str(d) for d in descendant_ids(page_id, project_id)}:
        return "不能把页面放进它自己的子页面里"
    return None
