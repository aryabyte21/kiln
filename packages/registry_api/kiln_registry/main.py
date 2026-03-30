"""
kiln_registry/main.py
─────────────────────
KilnRegistryAPI — FastAPI REST layer over the Kiln registry.

Exposes the registry as a local HTTP service so that:
  - Agents on any machine / framework can discover and call tools
  - Synthesis pipeline (Docker) can register new tools via multipart upload
  - Tools hot-load into running agents without restart

Endpoints
─────────
  GET  /health                      -> server status + tool count
  GET  /audio                       -> serve a generated audio file
  GET  /tools                       -> list all registered tools
  GET  /tools/{tool_id}             -> single tool spec + JSON schema
  POST /tools/register              -> multipart: spec_file + impl_file
  POST /tools/{tool_id}/execute     -> {"args": {...}} -> result dict
  POST /tools/{tool_id}/test        -> run spec.yaml fixtures, return report
  DELETE /tools/{tool_id}           -> unregister a tool

  POST /synthesis/callback          -> receive synthesis result, auto-register tool

Usage:
    uvicorn kiln_registry.main:app --host 0.0.0.0 --port 8766 --reload
"""

from __future__ import annotations

import logging
import shutil
import tempfile
from pathlib import Path
from typing import Any

import httpx
import jsonschema
import yaml
from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from kiln_shared.auth import KilnUser, invalidate_api_key_cache, require_auth, require_jwt_auth, verify_internal_secret
from kiln_shared.config import get_config

from .loader import KilnLoader
from .registry import get_global_registry

logger = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────

REGISTRY_DIR         = Path(__file__).parent.parent.parent.parent / "registry" / "tools"
KILN_CALLBACK_URL    = "http://host.docker.internal:8766/synthesis/callback"

app = FastAPI(
    title="KilnRegistryAPI",
    description=(
        "Local tool registry and execution service. "
        "Agents call /tools to discover tools and /tools/{id}/execute to run them. "
        "The synthesis pipeline registers new tools via POST /tools/register."
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

# ── Startup ───────────────────────────────────────────────────────────────────

@app.on_event("startup")
async def _startup() -> None:
    from kiln_shared.logging_config import setup_logging
    setup_logging()

    """Initialize database and load all tools from disk into the registry."""
    import json as _json

    from .db import db_upsert_tool, init_db

    # Initialize async database (creates tables if needed)
    await init_db()
    logger.info("Database initialized")

    # Load all tools from disk into the in-process registry
    if REGISTRY_DIR.exists():
        loader = KilnLoader(auto_register=True)
        tools  = loader.load_all(str(REGISTRY_DIR))
        logger.info(f"Loaded {len(tools)} tools from {REGISTRY_DIR}")

        # Sync tool metadata to async database
        for tool in tools:
            s = tool.spec
            await db_upsert_tool(
                tool_id=s.id,
                name=s.name,
                spec_json=_json.dumps(_tool_to_dict(tool)),
                description=s.description,
                version=s.version,
                author=s.author,
                category=s.category,
                tags_json=_json.dumps(s.tags),
            )
        logger.info(f"Synced {len(tools)} tools to database")
    else:
        logger.info(f"Registry dir not found: {REGISTRY_DIR} — starting empty")


# ── Helpers ───────────────────────────────────────────────────────────────────

def _tool_to_dict(tool) -> dict:
    """Convert a KilnTool to a JSON-serialisable summary dict."""
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
    return {"status": "ok", "service": "kiln-registry-api", "tool_count": len(registry)}


@app.get("/audio", summary="Serve a generated audio file by absolute path")
def serve_audio(path: str):
    """Serve an audio file produced by a tool (e.g. ElevenLabs TTS)."""
    file = Path(path)
    if not file.is_file():
        raise HTTPException(status_code=404, detail="Audio file not found")
    suffix = file.suffix.lower()
    media_types = {".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".flac": "audio/flac"}
    return FileResponse(file, media_type=media_types.get(suffix, "application/octet-stream"))


@app.get("/tools", summary="List all registered tools")
def list_tools():
    """
    Returns every registered tool with its spec and LLM-ready tool_def.
    Agents should call this at the top of every loop iteration to pick up
    tools registered by the synthesis pipeline since the last call.
    """
    registry = get_global_registry()
    return [
        {**_tool_to_dict(t), "tool_def": _tool_def(t)}
        for t in registry.list()
    ]


@app.get("/tools/search", summary="Search tools by query string")
async def search_tools(q: str = ""):
    """Full-text search across tool names, descriptions, tags, and IDs."""
    if not q.strip():
        return []

    from .db import db_search_tools

    results = await db_search_tools(q.strip())
    # Match results against in-memory registry to get callables
    registry = get_global_registry()
    matched = []
    for row in results:
        tool = registry.get(row.id)
        if tool:
            matched.append({**_tool_to_dict(tool), "tool_def": _tool_def(tool)})
    return matched


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
    spec_file: UploadFile = File(..., description="spec.yaml — validated against kiln.schema.json"),
    impl_file: UploadFile = File(..., description="Python implementation file, e.g. weather.py"),
    _user: KilnUser = Depends(require_auth),
):
    """
    Register a new tool from a spec.yaml + implementation .py file.

    Workflow:
      1. Parse spec_file to extract tool.id and tool.version
      2. Save both files to registry/tools/{tool_id}/{version}/
      3. Run test fixtures (if any defined in spec.yaml)
      4. If all fixtures pass, load + register the tool
      5. Return the result — including fixture report

    Called by the synthesis pipeline (Docker) after synthesising a new tool.

    curl example:
        curl -X POST http://localhost:8766/tools/register \\
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
        raise HTTPException(status_code=422, detail=f"Invalid YAML in spec_file: {exc}") from exc

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

        loader = KilnLoader(auto_register=False)

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

        # ── All fixtures passed -> persist files to registry ──────────────────
        dest_dir = REGISTRY_DIR / tool_id / version
        dest_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy(spec_path, dest_dir / "spec.yaml")
        shutil.copy(impl_path, dest_dir / impl_name)

        # ── Load + register from the persistent location ─────────────────────
        loader_reg = KilnLoader(auto_register=True)
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
def execute_tool(tool_id: str, body: dict, _user: KilnUser = Depends(require_auth)):
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
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Tool '{tool_id}' raised {type(exc).__name__}: {exc}",
        ) from exc

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

    loader = KilnLoader(auto_register=False)
    report = loader.test(str(tool_dir))
    return report


@app.delete("/tools/{tool_id:path}", summary="Unregister a tool")
def delete_tool(tool_id: str, _user: KilnUser = Depends(require_auth)):
    """
    Remove a tool from the in-memory registry.
    Does NOT delete files from disk (to allow re-registration).
    """
    registry = get_global_registry()
    if not registry.has(tool_id):
        raise HTTPException(status_code=404, detail=f"Tool '{tool_id}' not found")
    registry.unregister(tool_id)
    return {"success": True, "tool_id": tool_id}


# ── Synthesis Callback Endpoint ───────────────────────────────────────────────

@app.post("/synthesis/callback", summary="Receive synthesis result and auto-register tool")
async def synthesis_callback(
    request: Request,
    tool_id:  str        = Form(...,  description="Kiln tool ID, e.g. com.kiln.tools.weather"),
    spec:     UploadFile = File(...,  description="Generated spec.yaml"),
    impl:     UploadFile = File(...,  description="Generated impl.py"),
    env_vars: str | None = Form(None, description="JSON-encoded list of required env var dicts"),
):
    """
    Called by the synthesis pipeline (Docker) when tool synthesis is complete.

    Accepts multipart/form-data with:
        tool_id  — Kiln tool ID
        spec     — spec.yaml file
        impl     — impl.py file
        env_vars — optional JSON string of [{name, description}, ...]

    On success: validates fixtures, saves files to registry, loads + registers the tool.

    Returns:
        {"success": true,  "tool_id": "...", "version": "...", "fixtures": {...}}
    """
    verify_internal_secret(request)

    spec_bytes = await spec.read()
    impl_bytes = await impl.read()

    # Parse spec to get id, version, and entrypoint filename
    try:
        raw = yaml.safe_load(spec_bytes)
    except yaml.YAMLError as exc:
        raise HTTPException(status_code=422, detail=f"Invalid YAML in spec: {exc}") from exc

    resolved_tool_id = raw.get("tool", {}).get("id") or tool_id
    version          = str(raw.get("tool", {}).get("version", "1.0.0"))
    entrypoint       = raw.get("implementation", {}).get("entrypoint", "impl.py")

    if not resolved_tool_id:
        raise HTTPException(status_code=422, detail="spec.yaml must contain tool.id")

    # Validate spec schema before touching disk
    loader_check = KilnLoader(auto_register=False)
    try:
        jsonschema.validate(instance=raw, schema=loader_check._schema)
    except jsonschema.ValidationError as exc:
        raise HTTPException(status_code=422, detail=f"spec.yaml schema invalid: {exc.message}") from exc

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path  = Path(tmp)
        spec_path = tmp_path / "spec.yaml"
        impl_path = tmp_path / entrypoint

        spec_path.write_bytes(spec_bytes)
        impl_path.write_bytes(impl_bytes)

        loader = KilnLoader(auto_register=False)
        report = loader.test(str(tmp_path))

        if report["failed"] > 0:
            failed_details = [r for r in report["results"] if not r["passed"]]
            logger.warning(f"tool {resolved_tool_id} failed fixtures — not registered")
            return JSONResponse(
                status_code=422,
                content={
                    "success":  False,
                    "tool_id":  resolved_tool_id,
                    "message":  "Tool failed test fixtures — not registered",
                    "fixtures": failed_details,
                },
            )

        # All fixtures passed and spec is valid -> persist to registry
        dest_dir = REGISTRY_DIR / resolved_tool_id / version
        dest_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy(spec_path, dest_dir / "spec.yaml")
        shutil.copy(impl_path, dest_dir / entrypoint)

        loader_reg = KilnLoader(auto_register=True)
        tool = loader_reg.load(str(dest_dir))

    logger.info(f"registered tool {resolved_tool_id} v{version}")
    return {
        "success":  True,
        "tool_id":  tool.id,
        "version":  tool.spec.version,
        "fixtures": {
            "passed": report["passed"],
            "failed": report["failed"],
        },
    }


# ── Auth / API Key Management Endpoints ──────────────────────────────────────


@app.post("/auth/api-key", summary="Generate an API key for the authenticated user")
async def create_api_key(user: KilnUser = Depends(require_jwt_auth)):
    """
    Generate a new API key for CLI/MCP access. JWT auth required (no API key fallback).
    If a key already exists, returns the existing key.
    """
    import secrets

    config = get_config()
    if not config.clerk_secret_key:
        raise HTTPException(status_code=500, detail="CLERK_SECRET_KEY not configured")

    # Check if user already has a key
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            f"https://api.clerk.com/v1/users/{user.user_id}",
            headers={"Authorization": f"Bearer {config.clerk_secret_key}"},
        )
        resp.raise_for_status()
        user_data = resp.json()

    existing_key = user_data.get("private_metadata", {}).get("api_key", "")
    if existing_key:
        return {"api_key": existing_key, "message": "Existing key returned"}

    # Generate new key
    api_key = f"kiln_{user.user_id}_{secrets.token_hex(16)}"

    # Store in Clerk user metadata
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.patch(
            f"https://api.clerk.com/v1/users/{user.user_id}/metadata",
            headers={"Authorization": f"Bearer {config.clerk_secret_key}"},
            json={"private_metadata": {"api_key": api_key}},
        )
        resp.raise_for_status()

    return {"api_key": api_key, "message": "API key created"}


@app.get("/auth/api-key", summary="Get the current user's API key (masked)")
async def get_api_key(user: KilnUser = Depends(require_jwt_auth)):
    """Returns the user's API key with all but the last 4 characters masked."""
    config = get_config()
    if not config.clerk_secret_key:
        raise HTTPException(status_code=500, detail="CLERK_SECRET_KEY not configured")

    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            f"https://api.clerk.com/v1/users/{user.user_id}",
            headers={"Authorization": f"Bearer {config.clerk_secret_key}"},
        )
        resp.raise_for_status()
        user_data = resp.json()

    api_key = user_data.get("private_metadata", {}).get("api_key", "")
    if not api_key:
        raise HTTPException(status_code=404, detail="No API key generated yet. Call POST /auth/api-key first.")

    masked = "*" * (len(api_key) - 4) + api_key[-4:]
    return {"api_key": masked}


@app.post("/auth/api-key/regenerate", summary="Regenerate the user's API key")
async def regenerate_api_key(user: KilnUser = Depends(require_jwt_auth)):
    """Invalidates the old key and generates a new one."""
    import secrets

    config = get_config()
    if not config.clerk_secret_key:
        raise HTTPException(status_code=500, detail="CLERK_SECRET_KEY not configured")

    # Get old key to invalidate cache
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            f"https://api.clerk.com/v1/users/{user.user_id}",
            headers={"Authorization": f"Bearer {config.clerk_secret_key}"},
        )
        resp.raise_for_status()
        user_data = resp.json()

    old_key = user_data.get("private_metadata", {}).get("api_key", "")
    if old_key:
        invalidate_api_key_cache(old_key)

    # Generate and store new key
    api_key = f"kiln_{user.user_id}_{secrets.token_hex(16)}"

    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.patch(
            f"https://api.clerk.com/v1/users/{user.user_id}/metadata",
            headers={"Authorization": f"Bearer {config.clerk_secret_key}"},
            json={"private_metadata": {"api_key": api_key}},
        )
        resp.raise_for_status()

    return {"api_key": api_key, "message": "API key regenerated"}
