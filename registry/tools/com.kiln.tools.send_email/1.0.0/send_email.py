"""
send_email.py
-------------
Send an email via SMTP using Python's built-in smtplib.
Requires env vars: SMTP_USER, SMTP_PASS
Optional env vars: SMTP_HOST (default smtp.gmail.com), SMTP_PORT (default 587)
"""

import os
import smtplib

REQUIRED_ENV_VARS = [
    {"name": "SMTP_USER", "description": "SMTP login email address (e.g. yourname@gmail.com)"},
    {"name": "SMTP_PASS", "description": "SMTP password or Gmail app-specific password"},
]
import uuid
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart


def send_email(to: str, subject: str, body: str, cc: str = "") -> dict:
    """
    Send an email via SMTP.

    Args:
        to:      Recipient email address.
        subject: Subject line.
        body:    Plain-text body.
        cc:      Optional CC address.

    Returns:
        dict with keys: to, subject, success, message_id
    """
    try:
        smtp_user = os.environ.get("SMTP_USER", "").strip()
        smtp_pass = os.environ.get("SMTP_PASS", "").strip()
        smtp_host = os.environ.get("SMTP_HOST", "smtp.gmail.com").strip()
        smtp_port = int(os.environ.get("SMTP_PORT", "587"))

        if not smtp_user or not smtp_pass:
            return {"to": to, "subject": subject, "success": False,
                    "error": "SMTP_USER and SMTP_PASS environment variables must be set"}

        msg = MIMEMultipart()
        msg["From"]    = smtp_user
        msg["To"]      = to
        msg["Subject"] = subject
        if cc:
            msg["Cc"] = cc

        msg.attach(MIMEText(body, "plain"))

        message_id = f"<{uuid.uuid4()}@aria.babel>"
        msg["Message-ID"] = message_id

        recipients = [to] + ([cc] if cc else [])

        with smtplib.SMTP(smtp_host, smtp_port) as server:
            server.ehlo()
            server.starttls()
            server.login(smtp_user, smtp_pass)
            server.sendmail(smtp_user, recipients, msg.as_string())

        return {"to": to, "subject": subject, "success": True, "message_id": message_id}

    except Exception as exc:
        return {"to": to, "subject": subject, "success": False, "error": str(exc)}
