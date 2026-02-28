"""
vibe_tool.app.synthesis.pipeline
---------------------------------
Main synthesis orchestrator.

Prepares workspace → spawns Vibe CLI → collects artifacts → calls webhook.
Pushes SSE events at each stage for real-time progress streaming.
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path

import yaml

from app.config import get_settings
from app.jobs.job_store import job_store
from app.models import JobStatus, SynthesizeRequest
from app.synthesis.callback import notify_failure, notify_success
from app.synthesis.prompt_builder import build_prompt, write_context
from app.synthesis.vibe_runner import VibeError, run_vibe

logger = logging.getLogger(__name__)


def _extract_env_vars(impl_path: Path) -> list[dict[str, str]]:
    """Extract REQUIRED_ENV_VARS list from impl.py.

    Falls back to regex scanning if the global isn't defined.
    Returns [{"name": "VAR", "description": "..."}, ...].
    """
    code = impl_path.read_text()

    # Try to load REQUIRED_ENV_VARS by executing the assignment
    namespace: dict = {}
    try:
        exec(compile(code, str(impl_path), "exec"), namespace)
        env_vars = namespace.get("REQUIRED_ENV_VARS")
        if isinstance(env_vars, list):
            return env_vars
    except Exception:
        pass

    # Fallback: regex scan for os.environ usage
    pattern = r'os\.environ(?:\.get)?\s*[\(\[]\s*["\']([A-Z_][A-Z0-9_]*)["\']'
    found = sorted(set(re.findall(pattern, code)))
    return [{"name": name, "description": ""} for name in found]


def _emit(job_id: str, stage: str, **extra) -> None:
    """Push a pipeline event to the SSE queue AND log it to stdout/docker logs."""
    msg = extra.get("message", stage)
    logger.info("[%s] %s | %s", job_id[:8], stage, msg)
    job_store.push_event(job_id, {"type": "pipeline", "stage": stage, **extra})


async def run_synthesis_pipeline(job_id: str, request: SynthesizeRequest) -> None:
    """Background task: synthesize a Babel tool via Vibe CLI and register it.

    Pushes SSE events at each stage so clients can follow progress via
    GET /synthesize/{job_id}/events.
    """
    settings = get_settings()
    callback_url = request.callback_url or settings.aria_webhook_url
    tool_id = f"com.aria.tools.{request.tool_name}"

    try:
        job_store.update(job_id, status=JobStatus.RUNNING)
        _emit(job_id, "started", message=f"Synthesizing tool: {request.tool_name}")

        # Step 1: Prepare workspace
        workspace = Path(settings.workspace_dir) / job_id
        workspace.mkdir(parents=True, exist_ok=True)

        write_context(workspace, request)
        _emit(job_id, "workspace_ready", message=f"Workspace prepared at {workspace}")
        logger.info("Workspace prepared at %s", workspace)

        # Step 2: Spawn Vibe CLI (streaming — events forwarded via on_event)
        prompt = build_prompt(workspace, request)
        _emit(job_id, "vibe_started", message="Vibe CLI spawned, generating tool...")

        def forward_vibe_event(event: dict) -> None:
            # Log to stdout/docker logs
            role = event.get("role", "")
            content = event.get("content", event.get("raw", ""))
            if role:
                preview = str(content)[:200] if content else ""
                logger.info("[%s] vibe:%s | %s", job_id[:8], role, preview)
            job_store.push_event(job_id, event)

        await run_vibe(prompt, workspace, on_event=forward_vibe_event)
        _emit(job_id, "vibe_finished", message="Vibe CLI completed")

        # Step 3: Collect artifacts
        spec_path = workspace / "spec.yaml"
        impl_path = workspace / "impl.py"

        if not spec_path.exists():
            raise FileNotFoundError(f"Vibe CLI did not create spec.yaml in {workspace}")
        if not impl_path.exists():
            raise FileNotFoundError(f"Vibe CLI did not create impl.py in {workspace}")

        # Step 4: Extract tool_id from generated spec
        spec_data = yaml.safe_load(spec_path.read_text())
        if "id" in spec_data:
            tool_id = spec_data["id"]

        # Step 4b: Extract required env vars from impl.py
        env_vars = _extract_env_vars(impl_path)

        _emit(job_id, "artifacts_collected", message=f"Found spec.yaml + impl.py (tool_id={tool_id})", env_vars=env_vars)
        logger.info("Artifacts collected: %s, %s (tool_id=%s, env_vars=%s)", spec_path, impl_path, tool_id, env_vars)

        # Step 5: Webhook callback — success
        await notify_success(callback_url, tool_id, spec_path, impl_path, env_vars=env_vars)
        job_store.update(job_id, status=JobStatus.SUCCEEDED, tool_id=tool_id)
        _emit(job_id, "callback_sent", tool_id=tool_id, message="Tool registered via webhook")
        _emit(job_id, "done", status="succeeded", tool_id=tool_id)
        logger.info("Synthesis completed for job %s → %s", job_id, tool_id)

    except (VibeError, FileNotFoundError, Exception) as exc:
        error_msg = str(exc) if not isinstance(exc, Exception) or isinstance(exc, (VibeError, FileNotFoundError)) else f"Unexpected error: {exc}"
        logger.error("Synthesis failed for job %s: %s", job_id, error_msg)
        job_store.update(job_id, status=JobStatus.FAILED, error=error_msg)
        _emit(job_id, "error", message=error_msg)
        _emit(job_id, "done", status="failed", error=error_msg)
        try:
            await notify_failure(callback_url, tool_id, error_msg)
        except Exception:
            logger.exception("Failed to notify ARIA of synthesis failure")

    finally:
        # Close the SSE stream
        job_store.close_event_queue(job_id)
