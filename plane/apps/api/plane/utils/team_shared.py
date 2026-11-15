# [team 二开] 全员共享项目：经验库（LESSON）和每日回顾（REVIEW）。
#
# - 经验库新建时用经验审核的状态（草稿 / 待审核 / 修订中 / 已采纳 / 已驳回），不用任务工作流。
# - 工作区的管理员和成员会被自动加进这两个项目（列项目时补齐），管理员不用一个个手动加人。
#   访客（Guest）不加。成员被移出工作区后不会再被补回来。
import os

from plane.db.models import ProjectMember, StateGroup, WorkspaceMember
from plane.db.models.state import DEFAULT_STATES

LESSON_IDENT = os.environ.get("TEAM_LESSONS_PROJECT", "LESSON").upper()
REVIEW_IDENT = os.environ.get("TEAM_REVIEW_PROJECT", "REVIEW").upper()
SHARED_IDENTS = {LESSON_IDENT, REVIEW_IDENT}

LESSON_STATES = [
    {"name": "草稿", "color": "#A3A3A3", "sequence": 15000, "group": StateGroup.BACKLOG.value},
    {"name": "待审核", "color": "#F59E0B", "sequence": 25000, "group": StateGroup.UNSTARTED.value, "default": True},
    {"name": "修订中", "color": "#8B5CF6", "sequence": 35000, "group": StateGroup.STARTED.value},
    {"name": "已采纳", "color": "#16A34A", "sequence": 45000, "group": StateGroup.COMPLETED.value},
    {"name": "已驳回", "color": "#9CA3AF", "sequence": 55000, "group": StateGroup.CANCELLED.value},
    {"name": "Triage", "color": "#4E5355", "sequence": 65000, "group": StateGroup.TRIAGE.value},
]


def default_states_for(project):
    return LESSON_STATES if (project.identifier or "").upper() == LESSON_IDENT else DEFAULT_STATES


def ensure_shared_memberships(user, workspace_slug):
    """把当前用户补进工作区里的共享项目。只处理管理员和成员，访客不加。"""
    wm = WorkspaceMember.objects.filter(
        workspace__slug=workspace_slug, member=user, is_active=True, role__gte=15
    ).select_related("workspace").first()
    if not wm:
        return
    from plane.db.models import Project

    shared = Project.objects.filter(workspace=wm.workspace, identifier__in=SHARED_IDENTS, archived_at__isnull=True)
    for project in shared:
        pm = ProjectMember.objects.filter(project=project, member=user).first()
        if pm is None:
            ProjectMember.objects.create(project=project, member=user, role=15, workspace_id=project.workspace_id)
        elif not pm.is_active:
            pm.is_active = True
            pm.save(update_fields=["is_active"])


def add_workspace_members_to_shared(project):
    """共享项目刚建好时，把工作区现有的管理员和成员都加进去。"""
    if (project.identifier or "").upper() not in SHARED_IDENTS:
        return
    existing = set(ProjectMember.objects.filter(project=project).values_list("member_id", flat=True))
    for wm in WorkspaceMember.objects.filter(workspace_id=project.workspace_id, is_active=True, role__gte=15):
        if wm.member_id not in existing:
            ProjectMember.objects.create(project=project, member_id=wm.member_id, role=15, workspace_id=project.workspace_id)
