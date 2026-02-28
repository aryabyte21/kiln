"""
slack_message.py
----------------
Send a message to a Slack channel via an Incoming Webhook.
Requires env var: SLACK_WEBHOOK_URL
"""

import os

REQUIRED_ENV_VARS = [
    {"name": "SLACK_WEBHOOK_URL", "description": "Slack Incoming Webhook URL from api.slack.com/apps"},
]


def slack_message(text: str, username: str = "ARIA", icon_emoji: str = ":robot_face:") -> dict:
    """
    Send a Slack message via an Incoming Webhook.

    Args:
        text:       Message text (supports Slack mrkdwn formatting).
        username:   Bot display name.
        icon_emoji: Bot icon emoji.

    Returns:
        dict with keys: text, success, status_code
    """
    try:
        import requests

        webhook_url = os.environ.get("SLACK_WEBHOOK_URL", "").strip()
        if not webhook_url:
            return {"text": text, "success": False, "status_code": 0,
                    "error": "SLACK_WEBHOOK_URL environment variable not set"}

        payload = {
            "text":       text,
            "username":   username,
            "icon_emoji": icon_emoji,
        }

        resp = requests.post(webhook_url, json=payload, timeout=10)
        success = resp.status_code == 200

        return {
            "text":        text,
            "success":     success,
            "status_code": resp.status_code,
        }

    except Exception as exc:
        return {"text": text, "success": False, "status_code": 0, "error": str(exc)}
