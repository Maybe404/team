# [team 二开] 把还是邮箱前缀的显示名改成用户填写的姓名
from django.db import migrations


def fill(apps, schema_editor):
    User = apps.get_model("db", "User")
    for u in User.objects.filter(is_bot=False):
        full = f"{u.first_name or ''} {u.last_name or ''}".strip()
        if full and u.email and u.display_name in ("", u.email.split("@")[0]):
            User.objects.filter(pk=u.pk).update(display_name=full[:255])


class Migration(migrations.Migration):
    dependencies = [("db", "0128_team_page_issue")]
    operations = [migrations.RunPython(fill, migrations.RunPython.noop)]
