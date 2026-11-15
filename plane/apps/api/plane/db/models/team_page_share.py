# [team 二开] 文档公开只读链接。
# 不复用 DeployBoard：space 的多个公开接口只按 anchor 查 DeployBoard、不区分类型，
# 拿到文档的 anchor 就能顺着读到整个项目的标签、状态、任务。这里单独建表，只对应一篇文档。
from uuid import uuid4

from django.db import models

from .project import ProjectBaseModel


def get_share_anchor():
    return uuid4().hex


class TeamPageShare(ProjectBaseModel):
    page = models.ForeignKey("db.Page", on_delete=models.CASCADE, related_name="team_shares")
    anchor = models.CharField(max_length=64, default=get_share_anchor, unique=True, db_index=True)

    class Meta:
        db_table = "team_page_shares"
        constraints = [
            models.UniqueConstraint(
                fields=["page"],
                condition=models.Q(deleted_at__isnull=True),
                name="team_page_share_unique_page_when_deleted_at_null",
            )
        ]
