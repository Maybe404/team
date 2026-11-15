"""本地开发种子：建测试管理员、普通成员 bob、工作区和 API Token，输出写进 dev/.secrets。
用法：dev/seed.sh（不要在生产环境运行）"""
import os, secrets
from plane.db.models import Profile, User, Workspace, WorkspaceMember, APIToken
from plane.license.models import Instance, InstanceAdmin

email = os.environ.get("SEED_EMAIL", "admin@team.test")
password = os.environ.get("SEED_PASSWORD") or secrets.token_urlsafe(12) + "A1!"
slug = os.environ.get("SEED_WORKSPACE", "team")

user = User.objects.filter(email=email).first()
created = user is None
if created:
    user = User(email=email, username=email.split("@")[0], first_name="Dev", last_name="Admin",
                display_name="dev-admin", is_active=True, is_email_verified=True)
    user.set_password(password)
    user.save()

inst = Instance.objects.first()
inst.is_setup_done = True
inst.is_signup_screen_visited = True
inst.save()
InstanceAdmin.objects.get_or_create(user=user, instance=inst, defaults={"role": 20})

ws, _ = Workspace.objects.get_or_create(slug=slug, defaults={"name": "Team", "owner": user})
WorkspaceMember.objects.get_or_create(workspace=ws, member=user, defaults={"role": 20})
profile, _ = Profile.objects.get_or_create(user=user)
profile.is_onboarded = True
profile.last_workspace_id = ws.id
profile.onboarding_step = {k: True for k in (profile.onboarding_step or {})}
profile.save()

tok = APIToken.objects.filter(user=user, label="dev-mcp").first() or APIToken.objects.create(user=user, label="dev-mcp", workspace=ws)
# 第二个账号：普通成员，用来测指派、权限和多人协作（不进任何项目，由 add_project_member 加）
bob = User.objects.filter(email="bob@team.test").first()
if bob is None:
    bob = User(email="bob@team.test", username="bob", first_name="Bob", last_name="Member",
               display_name="bob", is_active=True, is_email_verified=True)
    bob.set_unusable_password()
    bob.save()
WorkspaceMember.objects.get_or_create(workspace=ws, member=bob, defaults={"role": 15})
bp, _ = Profile.objects.get_or_create(user=bob)
bp.is_onboarded = True
bp.last_workspace_id = ws.id
bp.save()
btok = APIToken.objects.filter(user=bob, label="dev-mcp").first() or APIToken.objects.create(user=bob, label="dev-mcp", workspace=ws)

print(f"SEED_EMAIL={email}")
if created:
    print(f"SEED_PASSWORD={password}")
print(f"PLANE_WORKSPACE={slug}")
print(f"PLANE_API_TOKEN={tok.token}")
print(f"PLANE_MEMBER_TOKEN={btok.token}")
