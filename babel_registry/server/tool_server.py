"""
babel_registry.server.tool_server
-----------------------------------
FastAPI server that exposes every registered Babel tool over HTTP.

External agents call tools without needing to know anything about the
local file system — only the server URL matters.

Endpoints:
    GET  /tools                          list all registered tools
    GET  /tools/{tool_id}/schema         OpenAI-format tool schema
    POST /tools/{tool_id}/invoke         call the tool, returns JSON result

Run:
    python3 -m babel_registry.server.tool_server
    # or
    uvicorn babel_registry.server.tool_server:app --reload --port 8000
"""

from __future__ import annotations

from pathlib import Path

import yaml
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from babel_registry.compiler.adapters.ag2_adapter import AG2Adapter
from babel_registry.registry.local_registry import LocalRegistry
from babel_registry.runtime.babel_runtime import BabelRuntime

_ROOT    = Path(__file__).parent.parent.parent
_DIST    = _ROOT / "dist"
_TOOLS   = _ROOT / "tools"

registry = LocalRegistry()
runtime  = BabelRuntime(registry=registry, dist_dir=_DIST)

app = FastAPI(
    title="Babel Tool Server",
    description="Exposes registered Babel tools as HTTP endpoints for external agents.",
    version="1.0.0",
)


# ── helpers ──────────────────────────────────────────────────────────────────

def _load(tool_id: str) -> dict:
    """Load tool via runtime, raising 404 if not found."""
    try:
        return runtime.load(tool_id, target="ag2")
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Tool not found: {tool_id}")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ── routes ───────────────────────────────────────────────────────────────────

@app.get("/tools", summary="List all registered tools")
def list_tools():
    """Return every tool currently in the registry."""
    tools = registry.list()
    return [
        {
            "tool_id":     t["tool_id"],
            "name":        t["name"],
            "description": t["description"],
            "version":     t["version"],
            "tags":        t["tags"],
        }
        for t in tools
    ]


@app.get("/tools/{tool_id}/schema", summary="Get OpenAI-format schema for a tool")
def get_schema(tool_id: str):
    """Return the OpenAI-compatible function schema for the given tool."""
    tool = _load(tool_id)
    return tool["schema"]


class InvokeRequest(BaseModel):
    args: dict


@app.post("/tools/{tool_id}/invoke", summary="Invoke a tool")
def invoke_tool(tool_id: str, body: InvokeRequest):
    """
    Call the tool with the provided arguments.

    Request body:
        { "args": { "param1": value1, "param2": value2 } }

    Returns the tool's output dict directly.
    """
    tool = _load(tool_id)
    try:
        result = tool["function"](**body.args)
    except TypeError as e:
        raise HTTPException(status_code=422, detail=f"Invalid arguments: {e}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Tool execution failed: {e}")
    return JSONResponse(content=result)


# ── registration (called by vibe_tool webhook) ───────────────────────────────


@app.post("/tools/register", summary="Register a synthesized tool")
async def register_tool(
    tool_id: str = Form(...),
    spec: UploadFile = File(...),
    impl: UploadFile = File(...),
):
    """Accept a synthesized tool (spec.yaml + impl.py) and register it.

    Called by the vibe_tool service after successful synthesis.
    Expects multipart form with:
        - tool_id: Babel tool ID (e.g. com.aria.tools.weather)
        - spec: spec.yaml file
        - impl: impl.py file
    """
    # Sanitize tool_id for directory name
    dir_name = tool_id.replace(".", "_")
    tool_dir = _TOOLS / dir_name
    tool_dir.mkdir(parents=True, exist_ok=True)

    spec_path = tool_dir / "spec.yaml"
    impl_path = tool_dir / "impl.py"

    # Save uploaded files
    spec_bytes = await spec.read()
    impl_bytes = await impl.read()
    spec_path.write_bytes(spec_bytes)
    impl_path.write_bytes(impl_bytes)

    try:
        # Validate and compile
        adapter = AG2Adapter()
        spec_dict = adapter.load_spec(spec_path)
        adapter.compile(spec_dict, impl_path, _DIST / "ag2")

        # Publish to registry
        registry.publish(spec_dict, impl_path, source="synthesized")

        # Invalidate runtime cache so next load picks up the new tool
        runtime.invalidate(tool_id, target="ag2")

        return {"tool_id": spec_dict["id"], "status": "registered"}

    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Registration failed: {e}")


# ── entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("babel_registry.server.tool_server:app", host="0.0.0.0", port=8000, reload=False)
