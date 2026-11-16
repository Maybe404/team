# [team 二开] 文档和工作项的关联：一键关联、两边都能看到（Plane 社区版没有这个功能）。
from django.db import models

from .project import ProjectBaseModel


class TeamPageIssue(ProjectBaseModel):
    page = models.ForeignKey("db.Page", on_delete=models.CASCADE, related_name="team_issue_links")
    issue = models.ForeignKey("db.Issue", on_delete=models.CASCADE, related_name="team_page_links")

    class Meta:
        db_table = "team_page_issues"
        constraints = [
            models.UniqueConstraint(
                fields=["page", "issue"],
                condition=models.Q(deleted_at__isnull=True),
                name="team_page_issue_unique_when_deleted_at_null",
            )
        ]
