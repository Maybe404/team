# [team 二开] 编辑申请、批准、被加为共同维护人、收集待处理：除了网页通知，也发一封邮件。
# 没配置邮件服务（EMAIL_HOST 为空）时直接跳过，不影响网页通知。
import logging
import os

from celery import shared_task
from django.core.mail import EmailMultiAlternatives, get_connection
from django.utils.html import escape

from plane.db.models import Notification
from plane.license.utils.instance_value import get_email_configuration
from plane.utils.exception_logger import log_exception

SUBJECTS = {
    "edit_request": "{actor} 申请编辑「{title}」",
    "edit_approved": "{actor} 同意了你编辑「{title}」的申请",
    "edit_rejected": "{actor} 拒绝了你编辑「{title}」的申请",
    "edit_added": "{actor} 把你加为「{title}」的共同维护人",
    "intake_new": "{actor} 提交了收集条目「{title}」，等你处理",
}


@shared_task
def team_notification_email(notification_ids):
    try:
        host, user, password, port, use_tls, use_ssl, from_email = get_email_configuration()
        if not host:
            return
        connection = get_connection(
            host=host, port=int(port), username=user, password=password, use_tls=use_tls == "1", use_ssl=use_ssl == "1"
        )
        base = (os.environ.get("WEB_URL") or os.environ.get("APP_BASE_URL") or "").rstrip("/")
        for n in Notification.objects.filter(id__in=notification_ids).select_related("receiver", "triggered_by"):
            team = (n.data or {}).get("team") or {}
            kind = team.get("kind")
            if kind not in SUBJECTS or not n.receiver.email or not n.receiver.is_active:
                continue
            actor = (n.triggered_by.display_name or n.triggered_by.email) if n.triggered_by else "有人"
            subject = SUBJECTS[kind].format(actor=actor, title=team.get("title", ""))
            link = f"{base}/{team.get('url', '')}"
            note = team.get("message") or ""
            text = f"{subject}\n\n{('留言：' + note + chr(10) + chr(10)) if note else ''}打开：{link}\n"
            html = (
                f"<p>{escape(subject)}</p>"
                + (f"<p>留言：{escape(note)}</p>" if note else "")
                + f'<p><a href="{escape(link)}">在 Loom 里打开</a></p>'
            )
            msg = EmailMultiAlternatives(subject=subject, body=text, from_email=from_email, to=[n.receiver.email], connection=connection)
            msg.attach_alternative(html, "text/html")
            msg.send()
        logging.getLogger("plane.worker").info("team notification emails sent")
    except Exception as e:
        log_exception(e)
