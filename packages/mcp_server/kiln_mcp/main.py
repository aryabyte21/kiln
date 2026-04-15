"""
kiln_mcp/main.py
----------------
Kiln MCP Server -- bridges the MCP JSON-RPC protocol to the Kiln Registry API.
"""

from __future__ import annotations

import json
import logging
import os

from mcp.server.fastmcp import Context, FastMCP
from mcp.server.session import ServerSession
from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Mount, Route

from kiln_shared.httpx_client import async_client
from kiln_shared.request_id import KilnRequestIDMiddleware

from kiln_mcp import tools as tool_module

logger = logging.getLogger(__name__)

REGISTRY_URL = os.environ.get("KILN_REGISTRY_URL", "http://localhost:8766")

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


@mcp.tool()
async def kiln_search_tools(query: str, ctx: Context[ServerSession, None]) -> str:
    """Search the Kiln tool registry by keyword. Returns matching tools."""
    await ctx.info(f"Searching for: {query}")
    try:
        async with async_client(timeout=10) as client:
            resp = await client.get(f"{REGISTRY_URL}/tools/search", params={"q": query})
            resp.raise_for_status()
            results = resp.json()
            if not results:
                return "No tools found matching your query."
            return "\n".join(
                f"- **{t['name']}** (`{t['id']}`): {t['description']}" for t in results
            )
    except Exception as e:
        return f"Search failed: {e}"


@mcp.tool()
async def kiln_refresh_tools(ctx: Context[ServerSession, None]) -> str:
    """Refresh the tool catalog from the Kiln registry."""
    await ctx.info("Refreshing tools from registry...")
    added = await tool_module.sync_tools(mcp)
    if added > 0:
        try:
            await ctx.session.send_tool_list_changed()
            await ctx.info(f"Added {added} new tools and notified client")
        except Exception:
            await ctx.info(f"Added {added} new tools (notification not supported by client)")
    total = tool_module.get_registered_tool_count()
    return f"Refreshed. {added} new tools added. Total: {total} tools available."


@mcp.tool()
async def kiln_registry_stats(ctx: Context[ServerSession, None]) -> str:
    """Get statistics about the Kiln tool registry."""
    await ctx.info("Fetching registry stats")
    try:
        async with async_client(timeout=10) as client:
            resp = await client.get(f"{REGISTRY_URL}/tools/stats")
            resp.raise_for_status()
            return json.dumps(resp.json(), indent=2)
    except Exception as e:
        return f"Failed to fetch stats: {e}"


async def _livez(_request: Request) -> JSONResponse:
    return JSONResponse({"status": "ok", "service": "kiln-mcp-server"})


async def _readyz(_request: Request) -> JSONResponse:
    checks: dict[str, str] = {}
    overall = "ok"

    try:
        async with async_client(timeout=2.0) as client:
            resp = await client.get(f"{REGISTRY_URL}/livez")
            if resp.status_code == 200:
                checks["registry_api"] = "ok"
            else:
                checks["registry_api"] = f"unhealthy: HTTP {resp.status_code}"
                overall = "degraded"
    except Exception as exc:
        checks["registry_api"] = f"unreachable: {exc!s}"
        overall = "degraded"

    checks["registered_tools"] = f"ok ({tool_module.get_registered_tool_count()} tools)"

    body = {"status": overall, "service": "kiln-mcp-server", "checks": checks}
    if overall != "ok":
        return JSONResponse(status_code=503, content=body)
    return JSONResponse(body)


async def _health(request: Request) -> JSONResponse:
    return await _readyz(request)


def build_http_app() -> Starlette:
    mcp_app = mcp.streamable_http_app()
    return Starlette(
        routes=[
            Route("/livez", _livez, methods=["GET"]),
            Route("/readyz", _readyz, methods=["GET"]),
            Route("/health", _health, methods=["GET"]),
            Mount("/", app=mcp_app),
        ],
        middleware=[Middleware(KilnRequestIDMiddleware)],
        lifespan=mcp_app.router.lifespan_context,
    )


def main():
    import sys

    from kiln_shared.logging_config import setup_logging
    setup_logging()

    transport = sys.argv[1] if len(sys.argv) > 1 else "streamable-http"
    host = os.environ.get("KILN_MCP_HOST", "127.0.0.1")
    port = int(os.environ.get("KILN_MCP_PORT", "8768"))

    logger.info("Starting Kiln MCP Server on %s:%s (transport: %s)", host, port, transport)

    if transport == "stdio":
        mcp.run(transport="stdio")
    else:
        import uvicorn
        app = build_http_app()
        uvicorn.run(app, host=host, port=port)


if __name__ == "__main__":
    main()
