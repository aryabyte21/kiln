"""
vibe_tool.app.synthesis.vibe_runner
------------------------------------
Spawns the Mistral Vibe CLI as an async subprocess with streaming output.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from pathlib import Path
from typing import Callable

from app.config import get_settings

logger = logging.getLogger(__name__)


class VibeError(Exception):
    """Raised when Vibe CLI fails or times out."""
    pass


async def _drain_stderr(stream: asyncio.StreamReader) -> str:
    """Read stderr continuously to prevent pipe buffer from filling up."""
    chunks: list[bytes] = []
    try:
        while True:
            chunk = await stream.read(4096)
            if not chunk:
                break
            chunks.append(chunk)
    except Exception:
        pass
    return b"".join(chunks).decode("utf-8", errors="replace")


async def run_vibe(
    prompt: str,
    workdir: Path,
    on_event: Callable[[dict], None] | None = None,
) -> None:
    """Spawn `vibe` CLI in streaming mode and forward events via callback.

    Args:
        prompt: The task prompt for Vibe CLI.
        workdir: Working directory where Vibe will create files.
        on_event: Optional callback invoked for each NDJSON line from Vibe stdout.

    Raises:
        VibeError: If Vibe CLI exits with non-zero code or times out.
    """
    settings = get_settings()

    cmd = [
        "vibe",
        "-p", prompt,
        "--output", "streaming",
        "--max-turns", str(settings.max_turns),
        "--max-price", str(settings.max_price),
        "--workdir", str(workdir),
    ]

    # Suppress TUI rendering in subprocess — no TTY, no color
    env = {**os.environ, "TERM": "dumb", "NO_COLOR": "1"}

    logger.info("Spawning Vibe CLI in %s", workdir)
    logger.info("Command: %s", " ".join(cmd))

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            stdin=asyncio.subprocess.DEVNULL,
            cwd=str(workdir),
            env=env,
        )

        # CRITICAL: Drain stderr concurrently to prevent pipe buffer deadlock.
        # Vibe CLI writes TUI escape codes to stderr which can fill the 64KB
        # OS pipe buffer, blocking the process from writing to stdout.
        stderr_task = asyncio.create_task(_drain_stderr(proc.stderr))

        # Read stdout line-by-line (NDJSON streaming)
        while True:
            line = await asyncio.wait_for(
                proc.stdout.readline(),
                timeout=300,  # 5 min max between lines (Vibe can be slow)
            )
            if not line:
                break

            line_str = line.decode("utf-8", errors="replace").strip()
            if not line_str:
                continue

            logger.debug("Vibe stdout: %s", line_str[:200])

            # Forward to event callback
            if on_event is not None:
                try:
                    event = json.loads(line_str)
                    on_event({"type": "vibe", **event})
                except json.JSONDecodeError:
                    on_event({"type": "vibe", "raw": line_str})

        # Wait for process to finish
        await asyncio.wait_for(proc.wait(), timeout=60)

        # Collect stderr
        stderr_str = await stderr_task

    except asyncio.TimeoutError:
        proc.kill()
        # Still try to collect stderr for diagnostics
        stderr_str = ""
        try:
            stderr_str = await asyncio.wait_for(stderr_task, timeout=5)
        except Exception:
            pass
        logger.error("Vibe CLI timed out. stderr tail: %s", stderr_str[-2000:] if stderr_str else "(empty)")
        raise VibeError("Vibe CLI timed out")

    if proc.returncode != 0:
        logger.error("Vibe CLI exited with code %d\nstderr: %s", proc.returncode, stderr_str[:2000])
        raise VibeError(
            f"Vibe CLI exited with code {proc.returncode}: {stderr_str[:500]}"
        )

    logger.info("Vibe CLI completed successfully in %s", workdir)
