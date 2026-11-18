from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("db", "0131_project_user_pinned")]

    operations = [
        migrations.AddField(model_name="issuedescriptionversion", name="is_locked", field=models.BooleanField(default=False)),
        migrations.AddField(model_name="issuedescriptionversion", name="label", field=models.CharField(blank=True, default="", max_length=255)),
        migrations.AddField(model_name="issuedescriptionversion", name="source", field=models.CharField(blank=True, default="editor", max_length=32)),
    ]
