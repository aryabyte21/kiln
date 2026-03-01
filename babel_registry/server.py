"""
babel/server.py
───────────────
BabelServer — FastAPI REST layer over the Babel registry.

Exposes the registry as a local HTTP service so that:
  - Agents on any machine / framework can discover and call tools
  - Vibe Coder (Docker) can register new tools via multipart upload
  - Tools hot-load into running agents without restart

Endpoints
─────────
  GET  /health                      → server status + tool count
  GET  /tools                       → list all registered tools
  GET  /tools/{tool_id}             → single tool spec + JSON schema
  POST /tools/register              → multipart: spec_file + impl_file
  POST /tools/{tool_id}/execute     → {"args": {...}} → result dict
  POST /tools/{tool_id}/test        → run spec.yaml fixtures, return report
  DELETE /tools/{tool_id}           → unregister a tool

  POST /aria/start                  → plan graph, detect missing env vars
  POST /aria/execute/{run_id}       → start execution after supplying env vars
  GET  /aria/stream/{run_id}        → SSE stream of ARIA execution events

  POST /vibe/synthesize             → proxy to Vibe Coder (port 8002), inject callback_url
  POST /vibe/callback               → receive synthesis result, auto-register tool

Usage:
    conda run -n shekhar python run_server.py
    # or:
    conda run -n shekhar uvicorn babel.server:app --host 0.0.0.0 --port 8765 --reload
"""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import tempfile
import threading
import uuid
from pathlib import Path
from queue import Empty, Queue
from typing import Any

import jsonschema
import requests
import yaml
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from dotenv import load_dotenv

from .loader import BabelLoader
from .registry import get_global_registry

load_dotenv()

# ── Constants ─────────────────────────────────────────────────────────────────

REGISTRY_DIR      = Path(__file__).parent.parent / "registry" / "tools"
VIBE_SERVER_URL   = "http://localhost:8002"
BABEL_CALLBACK_URL = "http://localhost:8765/vibe/callback"

app = FastAPI(
    title="BabelServer",
    description=(
        "Local tool registry and execution service. "
        "Agents call /tools to discover tools and /tools/{id}/execute to run them. "
        "Vibe Coder registers new tools via POST /tools/register."
    ),
    version="1.0.0",
)

# Allow requests from the React dev server (localhost:5173) and any local origin
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── ARIA run state ────────────────────────────────────────────────────────────
# run_id → Queue of event dicts; None sentinel = stream finished
_run_queues: dict[str, Queue] = {}
# run_id → planned task graph (stored between /aria/start and /aria/execute)
_run_plans:  dict[str, dict]  = {}
# run_id → tool IDs being synthesised (so execution thread can wait for them)
_run_awaited_tools: dict[str, list[str]] = {}

# ── Startup: hydrate registry from disk ───────────────────────────────────────

@app.on_event("startup")
def _startup() -> None:
    """Load all tools from registry/tools/ into the in-process registry."""
    if REGISTRY_DIR.exists():
        loader = BabelLoader(auto_register=True)
        tools  = loader.load_all(str(REGISTRY_DIR))
        print(f"[BabelServer] Loaded {len(tools)} tools from {REGISTRY_DIR}")
    else:
        print(f"[BabelServer] Registry dir not found: {REGISTRY_DIR} — starting empty")


# ── Helpers ───────────────────────────────────────────────────────────────────

def _tool_to_dict(tool) -> dict:
    """Convert a BabelTool to a JSON-serialisable summary dict."""
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


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/health", summary="Server health + tool count")
def health():
    registry = get_global_registry()
    return {"status": "ok", "tool_count": len(registry)}


@app.get("/tools", summary="List all registered tools")
def list_tools():
    """
    Returns every registered tool with its spec and LLM-ready tool_def.
    Agents should call this at the top of every loop iteration to pick up
    tools registered by Vibe Coder since the last call.
    """
    registry = get_global_registry()
    return [
        {**_tool_to_dict(t), "tool_def": _tool_def(t)}
        for t in registry.list()
    ]


@app.get("/tools/{tool_id:path}", summary="Get a single tool by ID")
def get_tool(tool_id: str):
    """Returns the full spec + LLM tool_def for one tool."""
    registry = get_global_registry()
    tool = registry.get(tool_id)
    if tool is None:
        raise HTTPException(status_code=404, detail=f"Tool '{tool_id}' not found")
    return {**_tool_to_dict(tool), "tool_def": _tool_def(tool)}


@app.post("/tools/register", summary="Register a new tool (multipart upload)")
async def register_tool(
    spec_file: UploadFile = File(..., description="spec.yaml — validated against babel.schema.json"),
    impl_file: UploadFile = File(..., description="Python implementation file, e.g. weather.py"),
):
    """
    Register a new tool from a spec.yaml + implementation .py file.

    Workflow:
      1. Parse spec_file to extract tool.id and tool.version
      2. Save both files to registry/tools/{tool_id}/{version}/
      3. Run test fixtures (if any defined in spec.yaml)
      4. If all fixtures pass, load + register the tool
      5. Return the result — including fixture report

    Called by Vibe Coder (Docker) after synthesising a new tool.

    curl example:
        curl -X POST http://localhost:8765/tools/register \\
             -F "spec_file=@spec.yaml" \\
             -F "impl_file=@weather.py"
    """
    # ── Read uploaded bytes ────────────────────────────────────────────────────
    spec_bytes = await spec_file.read()
    impl_bytes = await impl_file.read()

    # ── Parse spec to get id + version for directory placement ────────────────
    try:
        raw = yaml.safe_load(spec_bytes)
    except yaml.YAMLError as exc:
        raise HTTPException(status_code=422, detail=f"Invalid YAML in spec_file: {exc}")

    tool_id = raw.get("tool", {}).get("id")
    version = str(raw.get("tool", {}).get("version", "1.0.0"))

    if not tool_id:
        raise HTTPException(status_code=422, detail="spec.yaml must contain tool.id")

    # ── Write to a temp dir, validate + test, then persist ───────────────────
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path  = Path(tmp)
        spec_path = tmp_path / "spec.yaml"
        impl_name = impl_file.filename or f"{raw.get('tool', {}).get('name', 'tool')}.py"
        impl_path = tmp_path / impl_name

        spec_path.write_bytes(spec_bytes)
        impl_path.write_bytes(impl_bytes)

        loader = BabelLoader(auto_register=False)

        # ── Run fixtures first (don't register if they fail) ─────────────────
        report = loader.test(str(tmp_path))

        if report["failed"] > 0:
            failed_details = [
                r for r in report["results"] if not r["passed"]
            ]
            raise HTTPException(
                status_code=422,
                detail={
                    "message":  "Tool failed test fixtures — not registered",
                    "fixtures": failed_details,
                },
            )

        # ── All fixtures passed → persist files to registry ──────────────────
        dest_dir = REGISTRY_DIR / tool_id / version
        dest_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy(spec_path, dest_dir / "spec.yaml")
        shutil.copy(impl_path, dest_dir / impl_name)

        # ── Load + register from the persistent location ─────────────────────
        loader_reg = BabelLoader(auto_register=True)
        tool = loader_reg.load(str(dest_dir))

    return JSONResponse(
        status_code=200,
        content={
            "success": True,
            "tool_id": tool.id,
            "version": tool.spec.version,
            "fixtures": {
                "passed": report["passed"],
                "failed": report["failed"],
            },
        },
    )


@app.post("/tools/{tool_id:path}/execute", summary="Execute a registered tool")
def execute_tool(tool_id: str, body: dict):
    """
    Execute a registered tool with the provided arguments.

    Body:
        {"args": {"location": "Singapore", "units": "celsius"}}

    Returns:
        {"success": true, "tool_id": "...", "result": {...}}

    Agents call this after the LLM picks a tool and provides arguments.
    This is the hot path — keep it fast.
    """
    registry = get_global_registry()
    tool = registry.get(tool_id)
    if tool is None:
        raise HTTPException(status_code=404, detail=f"Tool '{tool_id}' not found")

    args = body.get("args", {})

    try:
        result = tool.fn(**args)
    except TypeError as exc:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid arguments for '{tool_id}': {exc}",
        )
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Tool '{tool_id}' raised {type(exc).__name__}: {exc}",
        )

    return {"success": True, "tool_id": tool_id, "result": result}


@app.post("/tools/{tool_id:path}/test", summary="Run test fixtures for a tool")
def test_tool(tool_id: str):
    """
    Re-run the spec.yaml fixtures for an already-registered tool.
    Useful for regression testing after updating a tool.
    """
    # Find the tool's directory on disk
    tool_dir = None
    for candidate in REGISTRY_DIR.glob(f"{tool_id}/*/"):
        if (candidate / "spec.yaml").exists():
            tool_dir = candidate

    if tool_dir is None:
        raise HTTPException(
            status_code=404,
            detail=f"Tool directory for '{tool_id}' not found on disk",
        )

    loader = BabelLoader(auto_register=False)
    report = loader.test(str(tool_dir))
    return report


@app.delete("/tools/{tool_id:path}", summary="Unregister a tool")
def delete_tool(tool_id: str):
    """
    Remove a tool from the in-memory registry.
    Does NOT delete files from disk (to allow re-registration).
    """
    registry = get_global_registry()
    if not registry.has(tool_id):
        raise HTTPException(status_code=404, detail=f"Tool '{tool_id}' not found")
    registry.unregister(tool_id)
    return {"success": True, "tool_id": tool_id}


# ── ARIA Endpoints ─────────────────────────────────────────────────────────────

def _collect_missing_envs(graph: dict, provided: dict[str, str]) -> list[dict]:
    """
    For each tool referenced in the task graph, check whether its
    REQUIRED_ENV_VARS are present in os.environ or in the provided dict.
    Returns a deduplicated list of missing var descriptors.
    """
    import importlib.util

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
    Returns a short constraints string that is injected into the Vibe synthesis request.
    Falls back to an empty string if the call fails.
    """
    try:
        from mistralai import Mistral
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
        print(f"[API Research] Could not research API: {exc}")
        return ""


def _synthesize_missing_tools(missing_tools: list, api_key: str = "") -> list[dict]:
    """
    Fire-and-forget POST requests to Vibe Coder for each missing tool spec.

    Each entry in missing_tools is expected to be a dict produced by ARIAPlanner:
        {"id": "com.aria.tools.foo", "description": "...", "inputs": [...], "output": {...}}

    String entries (legacy planner output) are skipped — only structured specs
    contain enough information for Vibe Coder to synthesise a tool.

    Returns list of {"job_id": ..., "tool_id": ..., "status": ...} for each
    synthesis request that was accepted, or [] if Vibe Coder is not running.
    """
    if not missing_tools:
        return []

    jobs: list[dict] = []

    def _fire(spec: dict) -> None:
        tool_id     = spec.get("id", "")
        tool_name   = tool_id.split(".")[-1] if tool_id else "unknown_tool"
        description = spec.get("description", "")
        job_id      = str(uuid.uuid4())

        # Ask Mistral to research the best free API for this tool before sending to Vibe
        api_hint = _research_api(description, api_key) if api_key else ""
        if api_hint:
            print(f"[API Research] {tool_id}: {api_hint[:120]}...")

        payload   = {
            "job_id":       job_id,
            "tool_name":    tool_name,
            "description":  description,
            "inputs":       spec.get("inputs", []),
            "output":       spec.get("output", {}),
            "constraints":  api_hint,
            "callback_url": BABEL_CALLBACK_URL,
        }
        try:
            resp = requests.post(
                f"{VIBE_SERVER_URL}/synthesize",
                json=payload,
                timeout=10,
            )
            resp.raise_for_status()
            jobs.append({"job_id": job_id, "tool_id": tool_id, "status": "queued"})
            print(f"[Vibe] Synthesis queued for {tool_id}  job={job_id}")
        except Exception as exc:
            print(f"[Vibe] Could not queue synthesis for {tool_id}: {exc}")

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


@app.post("/aria/start", summary="Plan an ARIA run; returns plan + any missing env vars")
async def aria_start(body: dict):
    """
    Phase 1 of a two-phase start: plan the task graph and check for missing
    environment variables (API keys) required by the planned tools.

    Body:
        {"request": "...", "env_vars": {"SERPER_API_KEY": "..."}}  # env_vars optional

    Returns one of:
        {"status": "needs_config", "run_id": "...", "plan": {...}, "missing_envs": [...]}
        {"status": "started",      "run_id": "..."}

    If "needs_config", collect the missing keys and call POST /aria/execute/{run_id}.
    If "started", connect to GET /aria/stream/{run_id} immediately.
    """
    api_key = os.environ.get("MISTRAL_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(status_code=500, detail="MISTRAL_API_KEY not set on server")

    user_request = body.get("request", "").strip()
    if not user_request:
        raise HTTPException(status_code=422, detail="'request' field is required")

    provided_env: dict[str, str] = body.get("env_vars", {}) or {}

    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from aria import ARIAPlanner

    # Build tool list directly from the in-memory registry to avoid a
    # self-request deadlock (the planner would otherwise GET /tools from
    # this same server, timing out because the event loop is busy here).
    registry   = get_global_registry()
    tools_list = [{**_tool_to_dict(t), "tool_def": _tool_def(t)} for t in registry.list()]

    planner = ARIAPlanner(babel_server_url="http://localhost:8765", api_key=api_key)
    graph   = planner.plan(user_request, tools=tools_list)

    run_id = str(uuid.uuid4())
    _run_plans[run_id]  = graph
    _run_queues[run_id] = Queue()

    missing = _collect_missing_envs(graph, provided_env)

    # Trigger Vibe Coder synthesis for any missing tools
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


@app.post("/aria/execute/{run_id}", summary="Start execution after supplying missing env vars")
async def aria_execute(run_id: str, body: dict):
    """
    Phase 2 of a two-phase start: supply the missing environment variables
    and begin executing the already-planned task graph.

    Body:
        {"env_vars": {"SERPER_API_KEY": "...", "NEWS_API_KEY": "..."}}

    Returns:
        {"status": "started", "run_id": "..."}

    Connect to GET /aria/stream/{run_id} for execution events.
    """
    graph = _run_plans.get(run_id)
    if graph is None:
        raise HTTPException(status_code=404, detail=f"Run '{run_id}' not found — call /aria/start first")

    api_key      = os.environ.get("MISTRAL_API_KEY", "").strip()
    provided_env = body.get("env_vars", {}) or {}

    _launch_execution(run_id, graph, provided_env, api_key)
    return {"status": "started", "run_id": run_id}



def _launch_execution(run_id: str, graph: dict, extra_env: dict[str, str], api_key: str) -> None:
    """Spawn the background thread that runs ARIAGraphFlow and feeds the SSE queue."""
    import time

    q              = _run_queues[run_id]
    awaited_tools  = _run_awaited_tools.pop(run_id, [])

    def _run() -> None:
        try:
            import sys
            sys.path.insert(0, str(Path(__file__).parent.parent))
            from aria import ARIAGraphFlow, ARIAPlanner

            q.put({"type": "plan_ready", **graph})

            # ── Wait for Vibe Coder to finish synthesising any new tools ──────
            active_graph = graph  # may be replaced after synthesis completes
            if awaited_tools:
                registry  = get_global_registry()
                remaining = set(awaited_tools)
                deadline  = time.time() + 120   # 2-minute timeout

                q.put({"type": "synthesis_wait", "tool_ids": list(remaining)})

                while remaining and time.time() < deadline:
                    for tid in list(remaining):
                        if registry.has(tid):
                            remaining.discard(tid)
                            q.put({"type": "tool_ready", "tool_id": tid})
                    if remaining:
                        time.sleep(2)

                if remaining:
                    q.put({"type": "synthesis_timeout", "missing": list(remaining)})

                # Re-plan with all tools now available (including synthesised ones)
                # so that graph nodes are updated to reference the new tool IDs.
                tools_list = [
                    {**_tool_to_dict(t), "tool_def": _tool_def(t)}
                    for t in registry.list()
                ]
                planner = ARIAPlanner(babel_server_url="http://localhost:8765", api_key=api_key)
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
            flow = ARIAGraphFlow(
                babel_server_url="http://localhost:8765",
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


@app.get("/aria/stream/{run_id}", summary="SSE stream of ARIA execution events")
async def aria_stream(run_id: str):
    """
    Server-Sent Events stream for an ARIA run started via POST /aria/start.

    Event types:
        plan_ready    — task graph is ready (nodes, edges, order, exit_node)
        node_start    — a node has started executing
        tool_call     — a tool is being called (node_id, tool, args)
        tool_result   — tool returned a result (node_id, tool, result)
        node_complete — a node finished (node_id, result)
        flow_complete — all nodes done (final_answer)
        error         — something went wrong (message)

    Connect with:
        const src = new EventSource('/aria/stream/<run_id>')
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


# ── Vibe Coder Endpoints ───────────────────────────────────────────────────────

@app.post("/vibe/synthesize", summary="Request Vibe Coder to synthesise a new tool")
async def vibe_synthesize(body: dict):
    """
    Proxy a tool-synthesis request to the Vibe Coder Docker container at port 8002.
    Injects callback_url automatically — when synthesis is complete, Vibe Coder
    will POST the result to POST /vibe/callback, which auto-registers the tool.

    Body (all fields except callback_url):
        {
          "job_id":      "optional — generated if omitted",
          "tool_name":   "my_cool_tool",
          "description": "What this tool does",
          "inputs":      [{name, type, description, required, default, values}, ...],
          "output":      {type, fields: [{name, type, description, required, default, values}]},
          "constraints": "optional constraints string"
        }

    Returns:
        Vibe Coder's response (e.g. {"job_id": "...", "status": "queued"})
    """
    job_id  = body.get("job_id") or str(uuid.uuid4())
    payload = {**body, "job_id": job_id, "callback_url": BABEL_CALLBACK_URL}

    try:
        resp = requests.post(
            f"{VIBE_SERVER_URL}/synthesize",
            json=payload,
            timeout=30,
        )
        resp.raise_for_status()
        return resp.json()
    except requests.ConnectionError:
        raise HTTPException(
            status_code=503,
            detail=f"Vibe Coder not reachable at {VIBE_SERVER_URL}. Is the Docker container running?",
        )
    except requests.HTTPError as exc:
        raise HTTPException(status_code=exc.response.status_code, detail=str(exc))


@app.post("/vibe/callback", summary="Receive synthesis result from Vibe Coder and auto-register tool")
async def vibe_callback(
    tool_id:  str        = Form(...,  description="Babel tool ID, e.g. com.aria.tools.weather"),
    spec:     UploadFile = File(...,  description="Generated spec.yaml"),
    impl:     UploadFile = File(...,  description="Generated impl.py"),
    env_vars: str | None = Form(None, description="JSON-encoded list of required env var dicts"),
):
    """
    Called by Vibe Coder (Docker) when tool synthesis is complete.

    Accepts multipart/form-data with:
        tool_id  — Babel tool ID
        spec     — spec.yaml file
        impl     — impl.py file
        env_vars — optional JSON string of [{name, description}, ...]

    On success: validates fixtures, saves files to registry, loads + registers the tool.

    Returns:
        {"success": true,  "tool_id": "...", "version": "...", "fixtures": {...}}
    """
    spec_bytes = await spec.read()
    impl_bytes = await impl.read()

    # Parse spec to get id, version, and entrypoint filename
    try:
        raw = yaml.safe_load(spec_bytes)
    except yaml.YAMLError as exc:
        raise HTTPException(status_code=422, detail=f"Invalid YAML in spec: {exc}")

    resolved_tool_id = raw.get("tool", {}).get("id") or tool_id
    version          = str(raw.get("tool", {}).get("version", "1.0.0"))
    entrypoint       = raw.get("implementation", {}).get("entrypoint", "impl.py")

    if not resolved_tool_id:
        raise HTTPException(status_code=422, detail="spec.yaml must contain tool.id")

    # Validate spec schema before touching disk
    loader_check = BabelLoader(auto_register=False)
    try:
        jsonschema.validate(instance=raw, schema=loader_check._schema)
    except jsonschema.ValidationError as exc:
        raise HTTPException(status_code=422, detail=f"spec.yaml schema invalid: {exc.message}")

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path  = Path(tmp)
        spec_path = tmp_path / "spec.yaml"
        impl_path = tmp_path / entrypoint

        spec_path.write_bytes(spec_bytes)
        impl_path.write_bytes(impl_bytes)

        loader = BabelLoader(auto_register=False)
        report = loader.test(str(tmp_path))

        if report["failed"] > 0:
            failed_details = [r for r in report["results"] if not r["passed"]]
            print(f"[Vibe Callback] tool {resolved_tool_id} failed fixtures — not registered")
            return JSONResponse(
                status_code=422,
                content={
                    "success":  False,
                    "tool_id":  resolved_tool_id,
                    "message":  "Tool failed test fixtures — not registered",
                    "fixtures": failed_details,
                },
            )

        # All fixtures passed and spec is valid → persist to registry
        dest_dir = REGISTRY_DIR / resolved_tool_id / version
        dest_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy(spec_path, dest_dir / "spec.yaml")
        shutil.copy(impl_path, dest_dir / entrypoint)

        loader_reg = BabelLoader(auto_register=True)
        tool = loader_reg.load(str(dest_dir))

    print(f"[Vibe Callback] registered tool {resolved_tool_id} v{version}")
    return {
        "success":  True,
        "tool_id":  tool.id,
        "version":  tool.spec.version,
        "fixtures": {
            "passed": report["passed"],
            "failed": report["failed"],
        },
    }
