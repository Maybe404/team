from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("db", "0130_team_versions_access")]

    operations = [
        migrations.AddField(
            model_name="projectuserproperty",
            name="is_pinned",
            field=models.BooleanField(default=False),
        ),
    ]
