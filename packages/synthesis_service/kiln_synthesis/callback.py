"""
kiln_synthesis.callback
---------------------------------
Posts synthesis results back to the Kiln webhook.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

import httpx

logger = logging.getLogger(__name__)


async def notify_success(
    callback_url: str,
    tool_id: str,
    spec_path: Path,
    impl_path: Path,
    env_vars: list[dict[str, str]] | None = None,
) -> None:
    """POST multipart form with spec.yaml and impl.py to the Kiln webhook.

    Args:
        callback_url: The webhook URL (e.g. http://localhost:8766/synthesis/callback).
        tool_id: The Kiln tool ID (e.g. com.kiln.tools.weather).
        spec_path: Path to the generated spec.yaml.
        impl_path: Path to the generated impl.py.
        env_vars: List of env var names the tool requires (extracted from impl.py).
    """
    logger.info("Sending synthesized tool %s to %s (env_vars=%s)", tool_id, callback_url, env_vars)

    form_data = {"tool_id": tool_id}
    if env_vars:
        form_data["env_vars"] = json.dumps(env_vars)

    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(
            callback_url,
            data=form_data,
            files={
                "spec": ("spec.yaml", spec_path.read_bytes(), "application/x-yaml"),
                "impl": ("impl.py", impl_path.read_bytes(), "text/x-python"),
            },
        )
        response.raise_for_status()
        logger.info("Tool %s registered successfully: %s", tool_id, response.json())


async def notify_failure(
    callback_url: str,
    tool_id: str,
    error: str,
) -> None:
    """POST a JSON error to the Kiln webhook on synthesis failure.

    Args:
        callback_url: The webhook URL.
        tool_id: The attempted tool ID.
        error: Description of what went wrong.
    """
    logger.warning("Notifying failure for %s: %s", tool_id, error)

    async with httpx.AsyncClient(timeout=15) as client:
        try:
            response = await client.post(
                callback_url,
                json={"tool_id": tool_id, "status": "failed", "error": error},
            )
            response.raise_for_status()
        except httpx.HTTPStatusError:
            logger.warning("Callback endpoint rejected failure notification (expected for multipart-only endpoints)")
