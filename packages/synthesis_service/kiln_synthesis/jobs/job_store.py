"""
kiln_synthesis.jobs.job_store
-----------------------------
In-memory job state tracker + per-job event queues for SSE streaming
+ per-job log files written to {log_dir}/{job_id}/logs.log.
"""

from __future__ import annotations

import asyncio
import contextlib
import io
import json
import threading
from datetime import UTC, datetime
from pathlib import Path

from kiln_synthesis.models import JobInfo, JobStatus


class JobStore:
    """Thread-safe in-memory store for tracking synthesis jobs."""

    def __init__(self) -> None:
        self._jobs: dict[str, JobInfo] = {}
        self._queues: dict[str, asyncio.Queue] = {}
        self._log_files: dict[str, io.TextIOWrapper] = {}
        self._lock = threading.Lock()
        self._log_dir: str = "/app/logs"

    def set_log_dir(self, log_dir: str) -> None:
        self._log_dir = log_dir

    def create(self, job_id: str, tool_name: str) -> None:
        now = datetime.now(UTC)
        with self._lock:
            self._jobs[job_id] = JobInfo(
                job_id=job_id,
                tool_name=tool_name,
                status=JobStatus.ACCEPTED,
                created_at=now,
                updated_at=now,
            )
            self._queues[job_id] = asyncio.Queue()

            # Open log file
            log_path = Path(self._log_dir) / job_id
            log_path.mkdir(parents=True, exist_ok=True)
            self._log_files[job_id] = open(log_path / "logs.log", "a", encoding="utf-8")  # noqa: SIM115

    def update(self, job_id: str, **kwargs) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return
            for k, v in kwargs.items():
                setattr(job, k, v)
            job.updated_at = datetime.now(UTC)

    def get(self, job_id: str) -> JobInfo | None:
        with self._lock:
            return self._jobs.get(job_id)

    def list_all(self) -> list[JobInfo]:
        with self._lock:
            return list(self._jobs.values())

    # -- Event queue for SSE streaming ----------------------------------------

    def get_event_queue(self, job_id: str) -> asyncio.Queue | None:
        with self._lock:
            return self._queues.get(job_id)

    def push_event(self, job_id: str, event: dict | None) -> None:
        """Push an event dict onto the job's SSE queue and write to log file."""
        with self._lock:
            q = self._queues.get(job_id)
            log_file = self._log_files.get(job_id)

        if q is not None:
            with contextlib.suppress(asyncio.QueueFull):
                q.put_nowait(event)

        # Write to log file
        if log_file is not None and event is not None:
            ts = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
            event_type = event.get("type", "unknown")
            if event_type == "pipeline":
                stage = event.get("stage", "")
                msg = event.get("message", stage)
                line = f"[{ts}] [pipeline] {stage} — {msg}"
            elif event_type == "vibe":
                role = event.get("role", "")
                content = str(event.get("content", event.get("raw", "")))[:500]
                line = f"[{ts}] [vibe:{role}] {content}"
            else:
                line = f"[{ts}] [{event_type}] {json.dumps(event)}"
            try:
                log_file.write(line + "\n")
                log_file.flush()
            except (ValueError, OSError):
                pass

    def close_event_queue(self, job_id: str) -> None:
        """Push a None sentinel to signal SSE stream is done, and close log file."""
        self.push_event(job_id, None)
        with self._lock:
            log_file = self._log_files.pop(job_id, None)
        if log_file is not None:
            with contextlib.suppress(ValueError, OSError):
                log_file.close()


# Singleton
job_store = JobStore()
