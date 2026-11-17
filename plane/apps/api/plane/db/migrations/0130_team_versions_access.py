# [team 二开] 页面版本可锁定、可命名；编辑权限（共同维护人、编辑申请）
import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("db", "0129_team_display_name"),
    ]

    operations = [
        migrations.AddField(model_name="pageversion", name="is_locked", field=models.BooleanField(default=False)),
        migrations.AddField(model_name="pageversion", name="label", field=models.CharField(blank=True, default="", max_length=255)),
        migrations.AddField(model_name="pageversion", name="source", field=models.CharField(blank=True, default="editor", max_length=20)),
        migrations.CreateModel(
            name="TeamEditor",
            fields=[
                ('created_at', models.DateTimeField(auto_now_add=True, verbose_name='Created At')),
                ('updated_at', models.DateTimeField(auto_now=True, verbose_name='Last Modified At')),
                ('deleted_at', models.DateTimeField(blank=True, null=True, verbose_name='Deleted At')),
                ('id', models.UUIDField(db_index=True, default=uuid.uuid4, editable=False, primary_key=True, serialize=False, unique=True)),
                ('created_by', models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='%(class)s_created_by', to=settings.AUTH_USER_MODEL, verbose_name='Created By')),
                ('updated_by', models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='%(class)s_updated_by', to=settings.AUTH_USER_MODEL, verbose_name='Last Modified By')),
                ('entity_type', models.CharField(choices=[('page', 'page'), ('issue', 'issue')], max_length=10)),
                ('entity_id', models.UUIDField()),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='team_editor_grants', to=settings.AUTH_USER_MODEL)),
                ('workspace', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='team_editors', to='db.workspace')),
            ],
            options={
                'db_table': 'team_editors',
                'indexes': [models.Index(fields=['entity_type', 'entity_id'], name='team_editor_entity_idx')],
                'constraints': [models.UniqueConstraint(condition=models.Q(('deleted_at__isnull', True)), fields=('entity_type', 'entity_id', 'user'), name='team_editor_unique_when_deleted_at_null')],
            },
        ),
        migrations.CreateModel(
            name="TeamEditRequest",
            fields=[
                ('created_at', models.DateTimeField(auto_now_add=True, verbose_name='Created At')),
                ('updated_at', models.DateTimeField(auto_now=True, verbose_name='Last Modified At')),
                ('deleted_at', models.DateTimeField(blank=True, null=True, verbose_name='Deleted At')),
                ('id', models.UUIDField(db_index=True, default=uuid.uuid4, editable=False, primary_key=True, serialize=False, unique=True)),
                ('created_by', models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='%(class)s_created_by', to=settings.AUTH_USER_MODEL, verbose_name='Created By')),
                ('updated_by', models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='%(class)s_updated_by', to=settings.AUTH_USER_MODEL, verbose_name='Last Modified By')),
                ('entity_type', models.CharField(choices=[('page', 'page'), ('issue', 'issue')], max_length=10)),
                ('entity_id', models.UUIDField()),
                ('message', models.CharField(blank=True, default='', max_length=500)),
                ('status', models.CharField(default='pending', max_length=10)),
                ('decided_at', models.DateTimeField(blank=True, null=True)),
                ('decided_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='team_edit_decisions', to=settings.AUTH_USER_MODEL)),
                ('requester', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='team_edit_requests', to=settings.AUTH_USER_MODEL)),
                ('workspace', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='team_edit_requests', to='db.workspace')),
            ],
            options={
                'db_table': 'team_edit_requests',
                'indexes': [models.Index(fields=['entity_type', 'entity_id', 'status'], name='team_editreq_entity_idx')],
            },
        ),
    ]
