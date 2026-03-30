"""
kiln_chat_backend/main.py
─────────────────────────
KilnChatBackend — FastAPI app for Kiln chat/execution endpoints.

Exposes the Kiln planner and graph-flow executor as HTTP endpoints:
  POST /kiln/start                → plan graph, detect missing env vars
  POST /kiln/execute/{run_id}     → start execution after supplying env vars
  GET  /kiln/stream/{run_id}      → SSE stream of Kiln execution events
"""

from __future__ import annotations

import asyncio
import importlib.util
import json
import logging
import os
import threading
import uuid
from pathlib import Path
from queue import Empty, Queue
from typing import Any

import requests
import yaml
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from kiln_shared.auth import KilnUser, require_auth

from .graph_flow import KilnGraphFlow
from .planner import KilnPlanner

logger = logging.getLogger(__name__)

load_dotenv()

# ── Constants ─────────────────────────────────────────────────────────────────

REGISTRY_DIR          = Path(__file__).parent.parent.parent.parent / "registry" / "tools"
REGISTRY_URL          = "http://localhost:8766"
SYNTHESIS_URL         = "http://localhost:8002"
KILN_CALLBACK_URL     = "http://host.docker.internal:8766/synthesis/callback"

app = FastAPI(
    title="KilnChatBackend",
    description=(
        "Kiln chat backend service. "
        "Provides planning, execution and streaming endpoints for the Kiln multi-agent workflow."
    ),
    version="1.0.0",
)

# Allow requests from local UI dev servers
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get(
        "CORS_ORIGINS",
        "http://localhost:3000,http://localhost:5173,http://localhost:5174",
    ).split(","),
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)

@app.on_event("startup")
def _startup() -> None:
    from kiln_shared.logging_config import setup_logging
    setup_logging()


@app.get("/health", summary="Service health")
def health():
    return {
        "status": "ok",
        "service": "kiln-chat-backend",
        "active_runs": len(_run_queues),
    }


# ── Kiln run state (thread-safe via lock) ─────────────────────────────────────
_run_lock = threading.Lock()
# run_id → Queue of event dicts; None sentinel = stream finished
_run_queues: dict[str, Queue] = {}
# run_id → planned task graph (stored between /kiln/start and /kiln/execute)
_run_plans:  dict[str, dict]  = {}
# run_id → tool IDs being synthesised (so execution thread can wait for them)
_run_awaited_tools: dict[str, list[str]] = {}


# ── Helpers ──────────────────────────────────────────────────────────────────

def _tool_to_dict(tool) -> dict:
    """Convert a tool object to a JSON-serialisable summary dict."""
    s = tool.spec
    return {
        "id":          s.id,
        "name":        s.name,
        "version":     s.version,
        "description": s.description,
        "author":      s.author,
        "category":    s.category,
        "tags":        s.tags,
        "params": [
            {
                "name":        p.name,
                "type":        p.type,
                "description": p.description,
                "required":    p.required,
                "default":     p.default,
                "enum":        p.enum,
            }
            for p in s.params
        ],
    }


def _tool_def(tool) -> dict:
    """
    Build the LLM-ready tool definition (OpenAI / Mistral compatible JSON schema).
    Agents can pass this directly to their LLM tool_choice parameter.
    """
    s = tool.spec
    properties: dict[str, Any] = {}
    required: list[str] = []

    _TYPE_TO_JSON = {
        "str": "string", "int": "integer", "float": "number",
        "bool": "boolean", "list": "array", "dict": "object",
    }

    for p in s.params:
        prop: dict[str, Any] = {
            "type":        _TYPE_TO_JSON.get(p.type, "string"),
            "description": p.description or "",
        }
        if p.enum:
            prop["enum"] = p.enum
        if p.default is not None:
            prop["default"] = p.default
        properties[p.name] = prop
        if p.required:
            required.append(p.name)

    return {
        "type": "function",
        "function": {
            "name":        s.name,
            "description": s.description,
            "parameters": {
                "type":       "object",
                "properties": properties,
                "required":   required,
            },
        },
    }


def _collect_missing_envs(graph: dict, provided: dict[str, str]) -> list[dict]:
    """
    For each tool referenced in the task graph, check whether its
    REQUIRED_ENV_VARS are present in os.environ or in the provided dict.
    Returns a deduplicated list of missing var descriptors.
    """
    seen:   set[str]   = set()
    missing: list[dict] = []

    for node in graph.get("nodes", []):
        for tool_id in node.get("tools", []):
            # Find the tool's implementation file on disk
            tool_dir = REGISTRY_DIR / tool_id
            if not tool_dir.exists():
                continue
            # Pick the latest version directory
            impl_file = None
            for ver_dir in sorted(tool_dir.iterdir()):
                spec_path = ver_dir / "spec.yaml"
                if not spec_path.exists():
                    continue
                raw = yaml.safe_load(spec_path.read_text())
                entrypoint = raw.get("implementation", {}).get("entrypoint", "")
                candidate = ver_dir / entrypoint
                if candidate.exists():
                    impl_file = candidate
                    break

            if impl_file is None:
                continue

            # Dynamically load the module to read REQUIRED_ENV_VARS
            try:
                spec = importlib.util.spec_from_file_location("_tmp", impl_file)
                if spec is None or spec.loader is None:
                    continue
                mod  = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(mod)
                required = getattr(mod, "REQUIRED_ENV_VARS", [])
            except Exception:
                continue

            for ev in required:
                name = ev.get("name", "")
                if not name or name in seen:
                    continue
                seen.add(name)
                if not os.environ.get(name) and not provided.get(name):
                    missing.append({
                        "tool_id":     tool_id,
                        "var_name":    name,
                        "description": ev.get("description", ""),
                    })

    return missing


def _research_api(tool_description: str, api_key: str) -> str:
    """
    Ask Mistral to recommend the best free/open API for a given tool description.
    Returns a short constraints string that is injected into the synthesis request.
    Falls back to an empty string if the call fails.
    """
    try:
        from mistralai.client import Mistral
        client = Mistral(api_key=api_key)
        resp = client.chat.complete(
            model="mistral-small-latest",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are an API research assistant. "
                        "Given a tool description, recommend the single best free/open HTTP API "
                        "that requires NO API key. Reply in 3-5 lines only:\n"
                        "1. API name and base URL\n"
                        "2. Exact endpoint and query parameters to use\n"
                        "3. Response format (JSON/XML) and the key fields to extract\n"
                        "4. Any required HTTP headers (e.g. User-Agent)\n"
                        "If no completely free option exists, name the cheapest option and its "
                        "required env var name. Be concrete and brief — no prose."
                    ),
                },
                {
                    "role": "user",
                    "content": f"Tool to implement: {tool_description}",
                },
            ],
        )
        return resp.choices[0].message.content.strip()
    except Exception as exc:
        logger.error(f"Could not research API: {exc}")
        return ""


def _synthesize_missing_tools(missing_tools: list, api_key: str = "") -> list[dict]:
    """
    Fire-and-forget POST requests to the synthesis service for each missing tool spec.

    Each entry in missing_tools is expected to be a dict produced by KilnPlanner:
        {"id": "com.kiln.tools.foo", "description": "...", "inputs": [...], "output": {...}}

    String entries (legacy planner output) are skipped — only structured specs
    contain enough information for the synthesis service to build a tool.

    Returns list of {"job_id": ..., "tool_id": ..., "status": ...} for each
    synthesis request that was accepted, or [] if the synthesis service is not running.
    """
    if not missing_tools:
        return []

    jobs: list[dict] = []

    def _fire(spec: dict) -> None:
        tool_id     = spec.get("id", "")
        tool_name   = tool_id.split(".")[-1] if tool_id else "unknown_tool"
        description = spec.get("description", "")
        job_id      = str(uuid.uuid4())

        # Ask Mistral to research the best free API for this tool before sending to synthesis
        api_hint = _research_api(description, api_key) if api_key else ""
        if api_hint:
            logger.info(f"{tool_id}: {api_hint[:120]}...")

        payload   = {
            "job_id":       job_id,
            "tool_name":    tool_name,
            "description":  description,
            "inputs":       spec.get("inputs", []),
            "output":       spec.get("output", {}),
            "constraints":  api_hint,
            "callback_url": KILN_CALLBACK_URL,
        }
        try:
            resp = requests.post(
                f"{SYNTHESIS_URL}/synthesize",
                json=payload,
                timeout=10,
            )
            resp.raise_for_status()
            jobs.append({"job_id": job_id, "tool_id": tool_id, "status": "queued"})
            logger.info(f"Synthesis queued for {tool_id}  job={job_id}")
        except Exception as exc:
            logger.error(f"Could not queue synthesis for {tool_id}: {exc}")

    threads = []
    for entry in missing_tools:
        if not isinstance(entry, dict):
            continue           # skip bare string IDs — not enough info
        t = threading.Thread(target=_fire, args=(entry,), daemon=True)
        t.start()
        threads.append(t)

    # Wait briefly so jobs list is populated before we return
    for t in threads:
        t.join(timeout=12)

    return jobs


# ── Kiln Endpoints ────────────────────────────────────────────────────────────

@app.post("/kiln/start", summary="Plan a Kiln run; returns plan + any missing env vars")
async def kiln_start(body: dict, _user: KilnUser = Depends(require_auth)):
    """
    Phase 1 of a two-phase start: plan the task graph and check for missing
    environment variables (API keys) required by the planned tools.

    Body:
        {"request": "...", "env_vars": {"SERPER_API_KEY": "..."}}  # env_vars optional

    Returns one of:
        {"status": "needs_config", "run_id": "...", "plan": {...}, "missing_envs": [...]}
        {"status": "started",      "run_id": "..."}

    If "needs_config", collect the missing keys and call POST /kiln/execute/{run_id}.
    If "started", connect to GET /kiln/stream/{run_id} immediately.
    """
    api_key = os.environ.get("MISTRAL_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(status_code=500, detail="MISTRAL_API_KEY not set on server")

    user_request = body.get("request", "").strip()
    if not user_request:
        raise HTTPException(status_code=422, detail="'request' field is required")

    provided_env: dict[str, str] = body.get("env_vars", {}) or {}

    # Build tool list by fetching from the registry API
    try:
        tools_resp = requests.get(f"{REGISTRY_URL}/tools", timeout=5)
        tools_resp.raise_for_status()
        tools_list = tools_resp.json()
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Could not fetch tools from Kiln registry at {REGISTRY_URL}: {exc}",
        ) from exc

    planner = KilnPlanner(registry_url=REGISTRY_URL, api_key=api_key)
    graph   = planner.plan(user_request, tools=tools_list)

    run_id = str(uuid.uuid4())
    _run_plans[run_id]  = graph
    _run_queues[run_id] = Queue()

    missing = _collect_missing_envs(graph, provided_env)

    # Trigger synthesis for any missing tools
    synthesis_jobs = _synthesize_missing_tools(graph.get("missing_tools", []), api_key=api_key)
    awaited_tool_ids = [j["tool_id"] for j in synthesis_jobs]
    _run_awaited_tools[run_id] = awaited_tool_ids

    if missing:
        resp: dict = {
            "status":       "needs_config",
            "run_id":       run_id,
            "plan":         graph,
            "missing_envs": missing,
        }
        if synthesis_jobs:
            resp["synthesis_jobs"] = synthesis_jobs
        return resp

    # All env vars present — kick off execution (will wait for synthesis if needed)
    _launch_execution(run_id, graph, provided_env, api_key)
    resp = {"status": "started", "run_id": run_id}
    if synthesis_jobs:
        resp["synthesis_jobs"] = synthesis_jobs
    return resp


@app.post("/kiln/execute/{run_id}", summary="Start execution after supplying missing env vars")
async def kiln_execute(run_id: str, body: dict, _user: KilnUser = Depends(require_auth)):
    """
    Phase 2 of a two-phase start: supply the missing environment variables
    and begin executing the already-planned task graph.

    Body:
        {"env_vars": {"SERPER_API_KEY": "...", "NEWS_API_KEY": "..."}}

    Returns:
        {"status": "started", "run_id": "..."}

    Connect to GET /kiln/stream/{run_id} for execution events.
    """
    graph = _run_plans.get(run_id)
    if graph is None:
        raise HTTPException(status_code=404, detail=f"Run '{run_id}' not found — call /kiln/start first")

    api_key      = os.environ.get("MISTRAL_API_KEY", "").strip()
    provided_env = body.get("env_vars", {}) or {}

    _launch_execution(run_id, graph, provided_env, api_key)
    return {"status": "started", "run_id": run_id}


def _launch_execution(run_id: str, graph: dict, extra_env: dict[str, str], api_key: str) -> None:
    """Spawn the background thread that runs KilnGraphFlow and feeds the SSE queue."""
    import time

    q = _run_queues.get(run_id)
    if q is None:
        raise ValueError(f"Run '{run_id}' has no event queue — was /kiln/start called first?")
    awaited_tools = _run_awaited_tools.pop(run_id, [])

    def _run() -> None:
        try:
            q.put({"type": "plan_ready", **graph})

            # ── Wait for synthesis service to finish building any new tools ──
            active_graph = graph  # may be replaced after synthesis completes
            if awaited_tools:
                remaining = set(awaited_tools)
                deadline  = time.time() + 120   # 2-minute timeout

                q.put({"type": "synthesis_wait", "tool_ids": list(remaining)})

                while remaining and time.time() < deadline:
                    # Check registry API to see if the tools have been registered
                    try:
                        resp = requests.get(f"{REGISTRY_URL}/tools", timeout=5)
                        resp.raise_for_status()
                        available_ids = {t["id"] for t in resp.json()}
                        for tid in list(remaining):
                            if tid in available_ids:
                                remaining.discard(tid)
                                q.put({"type": "tool_ready", "tool_id": tid})
                    except Exception:
                        pass
                    if remaining:
                        time.sleep(2)

                if remaining:
                    q.put({"type": "synthesis_timeout", "missing": list(remaining)})

                # Re-plan with all tools now available (including synthesised ones)
                # so that graph nodes are updated to reference the new tool IDs.
                try:
                    tools_resp = requests.get(f"{REGISTRY_URL}/tools", timeout=5)
                    tools_resp.raise_for_status()
                    tools_list = tools_resp.json()
                except Exception:
                    tools_list = []

                planner = KilnPlanner(registry_url=REGISTRY_URL, api_key=api_key)
                active_graph = planner.plan(graph["task"], tools=tools_list)
                q.put({"type": "plan_updated", **active_graph})

            llm_config = {
                "config_list": [{
                    "model":    "mistral-large-latest",
                    "api_key":  api_key,
                    "api_type": "openai",
                    "base_url": "https://api.mistral.ai/v1",
                }],
                "cache_seed": None,
            }
            flow = KilnGraphFlow(
                registry_url=REGISTRY_URL,
                llm_config=llm_config,
                on_event=q.put,
            )
            final_answer = flow.run(active_graph, extra_env=extra_env, verbose=False)
            q.put({"type": "flow_complete", "final_answer": final_answer})

        except Exception as exc:
            q.put({"type": "error", "message": str(exc)})
        finally:
            q.put(None)  # sentinel — stream is done
            _run_plans.pop(run_id, None)

    threading.Thread(target=_run, daemon=True).start()


@app.get("/kiln/stream/{run_id}", summary="SSE stream of Kiln execution events")
async def kiln_stream(run_id: str):
    """
    Server-Sent Events stream for a Kiln run started via POST /kiln/start.

    Event types:
        plan_ready    — task graph is ready (nodes, edges, order, exit_node)
        node_start    — a node has started executing
        tool_call     — a tool is being called (node_id, tool, args)
        tool_result   — tool returned a result (node_id, tool, result)
        node_complete — a node finished (node_id, result)
        flow_complete — all nodes done (final_answer)
        error         — something went wrong (message)

    Connect with:
        const src = new EventSource('/kiln/stream/<run_id>')
        src.onmessage = (e) => handleEvent(JSON.parse(e.data))
    """
    q = _run_queues.get(run_id)
    if q is None:
        raise HTTPException(status_code=404, detail=f"Run '{run_id}' not found")

    async def _generate():
        loop = asyncio.get_event_loop()
        try:
            while True:
                # Run blocking q.get in thread pool so the event loop stays free
                event = await loop.run_in_executor(None, lambda: q.get(timeout=180))
                if event is None:
                    break
                yield f"data: {json.dumps(event)}\n\n"
        except Empty:
            yield f"data: {json.dumps({'type': 'error', 'message': 'Timed out'})}\n\n"
        finally:
            _run_queues.pop(run_id, None)

    return StreamingResponse(
        _generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control":    "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
