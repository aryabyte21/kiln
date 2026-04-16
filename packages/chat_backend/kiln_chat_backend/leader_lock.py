"""Single-replica guard for chat_backend.

Chat sessions, SSE queues, and the in-memory DAG state all live on a
single process. Running two replicas at once silently splits traffic and
breaks streams. This module makes that misconfiguration loud:

    * On startup, the replica tries to ``SET NX`` a Redis key with a TTL.
    * A background task heartbeats the TTL.
    * If another replica already holds the key, startup fails fast with a
      clear log line and ``sys.exit(1)`` so Kubernetes surfaces the error
      via CrashLoopBackOff instead of silently corrupting state.

Gated by ``KILN_ENV``: skipped when ``KILN_ENV=dev`` so local dev and tests
don't require Redis. Hard-required when ``KILN_ENV`` is anything else.
"""
from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import socket
import sys
from contextlib import asynccontextmanager

logger = logging.getLogger(__name__)

LEADER_KEY = "kiln:chat_backend:leader"
LEADER_TTL_SEC = 30
HEARTBEAT_INTERVAL_SEC = 10


def _identity() -> str:
    """Human-readable identifier for the leader's log message.

    Prefers the pod name (injected by the k8s downward API) and falls back
    to the hostname so docker-compose users still get a meaningful value.
    """
    return os.environ.get("POD_NAME") or socket.gethostname()


def _should_enforce() -> bool:
    env = os.environ.get("KILN_ENV", "dev").lower()
    if env == "dev":
        return False
    return os.environ.get("KILN_CHAT_LEADER_LOCK", "true").lower() not in {"false", "0", "no"}


async def _acquire_or_exit(client) -> None:
    me = _identity()
    acquired = client.set(LEADER_KEY, me, nx=True, ex=LEADER_TTL_SEC)
    if acquired:
        logger.info("Acquired chat_backend leader lock as %s", me)
        return

    holder = client.get(LEADER_KEY) or "<unknown>"
    logger.error(
        "Another replica (%s) already holds the chat_backend leader lock. "
        "chat_backend is single-replica by design (in-memory SSE queues). "
        "Scale deployment replicas back to 1 or implement Redis-backed "
        "event queues before increasing replicas.",
        holder,
    )
    sys.exit(1)


async def _heartbeat(client, stop: asyncio.Event) -> None:
    me = _identity()
    while not stop.is_set():
        try:
            client.set(LEADER_KEY, me, xx=True, ex=LEADER_TTL_SEC)
        except Exception:
            logger.exception("leader-lock heartbeat failed; continuing")
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(stop.wait(), timeout=HEARTBEAT_INTERVAL_SEC)


@asynccontextmanager
async def leader_lock_context():
    """Async context that holds the leader lock for its lifetime.

    No-op unless ``KILN_ENV`` is set to something other than ``dev``.
    """
    if not _should_enforce():
        yield
        return

    redis_url = os.environ.get("REDIS_URL", "")
    if not redis_url:
        logger.error(
            "KILN_ENV=%s requires REDIS_URL for the chat_backend leader lock. "
            "Set REDIS_URL or set KILN_CHAT_LEADER_LOCK=false if you accept the "
            "single-replica footgun.",
            os.environ.get("KILN_ENV"),
        )
        sys.exit(1)

    try:
        import redis  # type: ignore[import-not-found]
    except ImportError:
        logger.error("redis package not installed; cannot acquire leader lock")
        sys.exit(1)

    client = redis.from_url(redis_url, decode_responses=True)
    await _acquire_or_exit(client)

    stop = asyncio.Event()
    hb_task = asyncio.create_task(_heartbeat(client, stop))

    try:
        yield
    finally:
        stop.set()
        try:
            await asyncio.wait_for(hb_task, timeout=2)
        except (TimeoutError, asyncio.CancelledError):
            hb_task.cancel()
        try:
            if client.get(LEADER_KEY) == _identity():
                client.delete(LEADER_KEY)
        except Exception:
            logger.exception("failed to release leader lock on shutdown")
