# [team 二开] 编辑权限：没有编辑权限的成员可以申请，拥有者也可以指定某些成员共同维护。
# 目前覆盖文档（page）和工作项（issue）。
from django.conf import settings
from django.db import models

from .base import BaseModel

ENTITY_TYPES = (("page", "page"), ("issue", "issue"))


class TeamEditor(BaseModel):
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="team_editors")
    entity_type = models.CharField(max_length=10, choices=ENTITY_TYPES)
    entity_id = models.UUIDField()
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="team_editor_grants")

    class Meta:
        db_table = "team_editors"
        constraints = [
            models.UniqueConstraint(
                fields=["entity_type", "entity_id", "user"],
                condition=models.Q(deleted_at__isnull=True),
                name="team_editor_unique_when_deleted_at_null",
            )
        ]
        indexes = [models.Index(fields=["entity_type", "entity_id"], name="team_editor_entity_idx")]


class TeamEditRequest(BaseModel):
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="team_edit_requests")
    entity_type = models.CharField(max_length=10, choices=ENTITY_TYPES)
    entity_id = models.UUIDField()
    requester = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="team_edit_requests")
    message = models.CharField(max_length=500, blank=True, default="")
    # pending / approved / rejected
    status = models.CharField(max_length=10, default="pending")
    decided_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="team_edit_decisions"
    )
    decided_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "team_edit_requests"
        indexes = [models.Index(fields=["entity_type", "entity_id", "status"], name="team_editreq_entity_idx")]
