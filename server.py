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

Usage:
    conda run -n shekhar python run_server.py
    # or:
    conda run -n shekhar uvicorn babel.server:app --host 0.0.0.0 --port 8765 --reload
"""

from __future__ import annotations

import shutil
import tempfile
from pathlib import Path
from typing import Any

import yaml
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse

from .loader import BabelLoader
from .registry import get_global_registry

# ── Constants ─────────────────────────────────────────────────────────────────

REGISTRY_DIR = Path(__file__).parent.parent / "registry" / "tools"

app = FastAPI(
    title="BabelServer",
    description=(
        "Local tool registry and execution service. "
        "Agents call /tools to discover tools and /tools/{id}/execute to run them. "
        "Vibe Coder registers new tools via POST /tools/register."
    ),
    version="1.0.0",
)

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
