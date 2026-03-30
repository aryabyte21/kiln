"""
kiln_mcp/main.py
────────────────
Kiln MCP Server — bridges the MCP JSON-RPC protocol to the Kiln Registry API.

Any MCP-compatible client (Claude Desktop, Cursor, VS Code Copilot, Windsurf)
can connect to this server and immediately access every tool in the registry.

Features:
  - tools/list → returns all registered Kiln tools as MCP tools
  - tools/call → proxies execution to registry_api /tools/{id}/execute
  - Dynamic tool refresh — polls registry_api for new tools and notifies clients
  - Streamable HTTP transport for production, stdio for local dev

Usage:
    # Streamable HTTP (production)
    uv run python -m kiln_mcp.main

    # Or via Nx
    nx run mcp-server:dev

MCP client config (e.g., Claude Desktop):
    {
      "mcpServers": {
        "kiln": {
          "url": "http://localhost:8768/mcp"
        }
      }
    }
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os

import httpx
from mcp.server.fastmcp import Context, FastMCP
from mcp.server.session import ServerSession

logger = logging.getLogger(__name__)

# ── Configuration ─────────────────────────────────────────────────────────────

REGISTRY_URL = os.environ.get("KILN_REGISTRY_URL", "http://localhost:8766")
POLL_INTERVAL = int(os.environ.get("KILN_MCP_POLL_INTERVAL", "30"))  # seconds

# ── MCP Server ────────────────────────────────────────────────────────────────

mcp = FastMCP(
    "Kiln",
    instructions=(
        "Kiln is a self-evolving tool registry for AI agents. "
        "All tools are dynamically loaded from the Kiln registry. "
        "When you need a tool that doesn't exist, describe what you need "
        "and it may be synthesized automatically."
    ),
    stateless_http=True,
    json_response=True,
)

# ── Tool Registry State ──────────────────────────────────────────────────────

_registered_tools: dict[str, dict] = {}  # tool_id → tool spec from registry API
_tool_lock = asyncio.Lock()


def _fetch_tools_sync() -> list[dict]:
    """Fetch all tools from the Kiln Registry API (sync, for startup)."""
    try:
        resp = httpx.get(f"{REGISTRY_URL}/tools", timeout=10)
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        logger.warning("Failed to fetch tools from registry: %s", e)
        return []


async def _fetch_tools() -> list[dict]:
    """Fetch all tools from the Kiln Registry API (async, for polling)."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(f"{REGISTRY_URL}/tools")
            resp.raise_for_status()
            return resp.json()
    except Exception as e:
        logger.error("Failed to fetch tools from registry: %s", e)
        return []


async def _execute_tool(tool_id: str, args: dict) -> dict:
    """Execute a tool via the Kiln Registry API."""
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{REGISTRY_URL}/tools/{tool_id}/execute",
            json={"args": args},
            headers={"X-Internal-Secret": os.environ.get("KILN_INTERNAL_SECRET", "")},
        )
        resp.raise_for_status()
        return resp.json()


def _build_mcp_tool_schema(tool_spec: dict) -> dict:
    """Convert a Kiln tool spec's params into MCP-compatible JSON Schema."""
    type_map = {
        "str": "string", "int": "integer", "float": "number",
        "bool": "boolean", "list": "array", "dict": "object",
    }
    properties = {}
    required = []
    for p in tool_spec.get("params", []):
        prop: dict = {
            "type": type_map.get(p.get("type", "str"), "string"),
            "description": p.get("description", ""),
        }
        if p.get("enum"):
            prop["enum"] = p["enum"]
        if p.get("default") is not None:
            prop["default"] = p["default"]
        properties[p["name"]] = prop
        if p.get("required", True):
            required.append(p["name"])

    return {
        "type": "object",
        "properties": properties,
        "required": required,
    }


def _make_tool_handler(tool_id: str, tool_name: str):
    """Create an async handler function for an MCP tool."""
    async def handler(ctx: Context[ServerSession, None], **kwargs) -> str:
        await ctx.info(f"Executing {tool_name} ({tool_id})")
        try:
            result = await _execute_tool(tool_id, kwargs)
            if result.get("success"):
                return json.dumps(result.get("result", {}), indent=2, default=str)
            return json.dumps({"error": result.get("detail", "Unknown error")})
        except httpx.HTTPStatusError as e:
            error_detail = e.response.text
            with contextlib.suppress(Exception):
                error_detail = e.response.json().get("detail", error_detail)
            return json.dumps({"error": str(error_detail)})
        except Exception as e:
            return json.dumps({"error": str(e)})

    handler.__name__ = tool_name
    handler.__doc__ = _registered_tools.get(tool_id, {}).get("description", "")
    return handler


async def sync_tools() -> int:
    """
    Fetch tools from registry and register/unregister as needed.
    Returns the number of new tools added.
    """
    tools = await _fetch_tools()
    if not tools:
        return 0

    async with _tool_lock:
        current_ids = set(_registered_tools.keys())
        new_ids = {t["id"] for t in tools}

        # Register new tools
        added = 0
        for tool in tools:
            tid = tool["id"]
            if tid not in current_ids:
                handler = _make_tool_handler(tid, tool["name"])
                handler.__doc__ = tool.get("description", "")

                # Register with FastMCP using the low-level API
                mcp.tool(
                    name=tool["name"],
                    description=tool.get("description", ""),
                )(handler)

                _registered_tools[tid] = tool
                added += 1
                logger.info("Registered MCP tool: %s (%s)", tool["name"], tid)

        # Log removed tools (can't easily unregister from FastMCP, but they become stale)
        removed = current_ids - new_ids
        if removed:
            logger.warning("Tools removed from registry (stale in MCP): %s", removed)

        return added


# ── Background Poller ─────────────────────────────────────────────────────────

_poll_task: asyncio.Task | None = None


async def _poll_registry():
    """Periodically check for new tools and notify clients."""
    while True:
        await asyncio.sleep(POLL_INTERVAL)
        try:
            added = await sync_tools()
            if added > 0:
                logger.info("Added %d new tools from registry", added)
                # Notify all connected MCP clients that tools changed
                # (FastMCP handles this internally when tools are added)
        except Exception as e:
            logger.error("Registry poll failed: %s", e)


def load_tools_on_startup() -> int:
    """Synchronously load tools from registry before the event loop starts."""
    tools = _fetch_tools_sync()
    if not tools:
        return 0

    added = 0
    for tool in tools:
        tid = tool["id"]
        if tid not in _registered_tools:
            handler = _make_tool_handler(tid, tool["name"])
            handler.__doc__ = tool.get("description", "")

            mcp.tool(
                name=tool["name"],
                description=tool.get("description", ""),
            )(handler)

            _registered_tools[tid] = tool
            added += 1
            logger.info("Registered MCP tool: %s (%s)", tool["name"], tid)

    return added


# ── Built-in Utility Tools ───────────────────────────────────────────────────

@mcp.tool()
async def kiln_search_tools(query: str, ctx: Context[ServerSession, None]) -> str:
    """Search the Kiln tool registry by keyword. Returns matching tools."""
    await ctx.info(f"Searching for: {query}")
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"{REGISTRY_URL}/tools/search",
                params={"q": query},
            )
            resp.raise_for_status()
            tools = resp.json()
            if not tools:
                return "No tools found matching your query."
            result = []
            for t in tools:
                result.append(f"- **{t['name']}** (`{t['id']}`): {t['description']}")
            return "\n".join(result)
    except Exception as e:
        return f"Search failed: {e}"


@mcp.tool()
async def kiln_registry_stats(ctx: Context[ServerSession, None]) -> str:
    """Get statistics about the Kiln tool registry."""
    await ctx.info("Fetching registry stats")
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(f"{REGISTRY_URL}/tools/stats")
            resp.raise_for_status()
            return json.dumps(resp.json(), indent=2)
    except Exception as e:
        return f"Failed to fetch stats: {e}"


# ── Entry Point ──────────────────────────────────────────────────────────────

def main():
    """CLI entry point for the Kiln MCP Server."""
    import sys

    from kiln_shared.logging_config import setup_logging
    setup_logging()

    transport = sys.argv[1] if len(sys.argv) > 1 else "streamable-http"
    host = os.environ.get("KILN_MCP_HOST", "127.0.0.1")
    port = int(os.environ.get("KILN_MCP_PORT", "8768"))

    # Load tools synchronously before the event loop starts
    count = load_tools_on_startup()
    logger.info("Loaded %d tools from registry (%s)", count, REGISTRY_URL)
    logger.info("Starting Kiln MCP Server on %s:%s (transport: %s)", host, port, transport)

    mcp.run(transport=transport, host=host, port=port)


if __name__ == "__main__":
    main()
