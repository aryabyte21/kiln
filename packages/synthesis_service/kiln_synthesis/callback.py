"""
kiln_synthesis.callback
---------------------------------
Posts synthesis results back to the Kiln registry webhook.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

import httpx

from kiln_shared.httpx_client import async_client
from kiln_synthesis.config import get_settings

logger = logging.getLogger(__name__)


def _auth_headers() -> dict[str, str]:
    """Build headers with internal service-to-service auth secret."""
    secret = get_settings().internal_secret
    if secret:
        return {"X-Internal-Secret": secret}
    return {}


async def notify_success(
    callback_url: str,
    tool_id: str,
    spec_path: Path,
    impl_path: Path,
    env_vars: list[dict[str, str]] | None = None,
) -> None:
    """POST multipart form with spec.yaml and impl.py to the Kiln registry."""
    logger.info("Sending synthesized tool %s to %s", tool_id, callback_url)

    form_data = {"tool_id": tool_id}
    if env_vars:
        form_data["env_vars"] = json.dumps(env_vars)

    async with async_client(timeout=30) as client:
        response = await client.post(
            callback_url,
            data=form_data,
            files={
                "spec": ("spec.yaml", spec_path.read_bytes(), "application/x-yaml"),
                "impl": ("impl.py", impl_path.read_bytes(), "text/x-python"),
            },
            headers=_auth_headers(),
        )
        response.raise_for_status()
        logger.info("Tool %s registered successfully: %s", tool_id, response.json())


async def notify_failure(
    callback_url: str,
    tool_id: str,
    error: str,
) -> None:
    """POST a JSON error to the Kiln registry on synthesis failure."""
    logger.warning("Notifying failure for %s: %s", tool_id, error)

    async with async_client(timeout=15) as client:
        try:
            response = await client.post(
                callback_url,
                json={"tool_id": tool_id, "status": "failed", "error": error},
                headers=_auth_headers(),
            )
            response.raise_for_status()
        except httpx.HTTPStatusError:
            logger.warning("Callback endpoint rejected failure notification")
