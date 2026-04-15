"""
kiln_mcp/main.py
----------------
Kiln MCP Server -- bridges the MCP JSON-RPC protocol to the Kiln Registry API
with OAuth 2.1 + PKCE authentication (delegating user identity to Clerk).
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os

from mcp.server.auth.provider import ProviderTokenVerifier
from mcp.server.auth.settings import AuthSettings, ClientRegistrationOptions
from mcp.server.fastmcp import Context, FastMCP
from mcp.server.session import ServerSession
from pydantic import AnyHttpUrl
from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Mount, Route

from kiln_mcp import tools as tool_module
from kiln_mcp.auth.clerk_callback import build_callback_route
from kiln_mcp.auth.provider import KilnOAuthProvider
from kiln_mcp.auth.store import InMemoryOAuthStore
from kiln_shared.httpx_client import async_client
from kiln_shared.request_id import KilnRequestIDMiddleware

logger = logging.getLogger(__name__)

REGISTRY_URL = os.environ.get("KILN_REGISTRY_URL", "http://localhost:8766")
POLL_INTERVAL = int(os.environ.get("KILN_MCP_POLL_INTERVAL", "30"))
ISSUER_URL = os.environ.get("KILN_MCP_ISSUER_URL", "http://localhost:8768")
CLERK_DOMAIN = os.environ.get("CLERK_DOMAIN", "").strip()

_oauth_store = InMemoryOAuthStore()
_oauth_provider = KilnOAuthProvider(
    store=_oauth_store,
    clerk_domain=CLERK_DOMAIN,
    issuer_url=ISSUER_URL,
)

_auth_enabled = bool(CLERK_DOMAIN)


def _build_mcp() -> FastMCP:
    common_kwargs = dict(
        instructions=(
            "Kiln is a self-evolving tool registry for AI agents. "
            "All tools are dynamically loaded from the Kiln registry. "
            "When you need a tool that doesn't exist, describe what you need "
            "and it may be synthesized automatically."
        ),
        stateless_http=True,
        json_response=True,
    )
    if _auth_enabled:
        return FastMCP(
            "Kiln",
            **common_kwargs,
            auth_server_provider=_oauth_provider,
            token_verifier=ProviderTokenVerifier(_oauth_provider),
            auth=AuthSettings(
                issuer_url=AnyHttpUrl(ISSUER_URL),
                resource_server_url=None,
                client_registration_options=ClientRegistrationOptions(
                    enabled=True,
                    valid_scopes=["kiln:tools"],
                    default_scopes=["kiln:tools"],
                ),
            ),
        )
    logger.warning(
        "CLERK_DOMAIN not set -- OAuth disabled, running unauthenticated (dev only)"
    )
    return FastMCP("Kiln", **common_kwargs)


mcp = _build_mcp()


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
    checks["auth"] = "enabled" if _auth_enabled else "disabled"

    body = {"status": overall, "service": "kiln-mcp-server", "checks": checks}
    if overall != "ok":
        return JSONResponse(status_code=503, content=body)
    return JSONResponse(body)


async def _health(request: Request) -> JSONResponse:
    return await _readyz(request)


async def _poll_registry() -> None:
    while True:
        await asyncio.sleep(POLL_INTERVAL)
        try:
            added = await asyncio.wait_for(
                tool_module.sync_tools(mcp),
                timeout=POLL_INTERVAL * 0.8,
            )
            if added > 0:
                logger.info("Added %d new tools from registry", added)
        except TimeoutError:
            logger.error("Registry poll timed out")
        except Exception as e:
            logger.error("Registry poll failed: %s", e)


async def _cleanup_loop() -> None:
    while True:
        await asyncio.sleep(60)
        try:
            _oauth_store.cleanup()
        except Exception as e:
            logger.error("OAuth store cleanup failed: %s", e)


def build_http_app() -> Starlette:
    mcp_app = mcp.streamable_http_app()

    extra_routes: list[Route] = [
        Route("/livez", _livez, methods=["GET"]),
        Route("/readyz", _readyz, methods=["GET"]),
        Route("/health", _health, methods=["GET"]),
    ]

    if _auth_enabled:
        extra_routes.append(
            build_callback_route(store=_oauth_store, clerk_domain=CLERK_DOMAIN)
        )

    @contextlib.asynccontextmanager
    async def lifespan(_app):
        mcp_lifespan_cm = mcp_app.router.lifespan_context(_app)
        await mcp_lifespan_cm.__aenter__()
        try:
            try:
                await tool_module.sync_tools(mcp)
                logger.info(
                    "Initial tool sync complete (%d tools)",
                    tool_module.get_registered_tool_count(),
                )
            except Exception as e:
                logger.error("Initial tool sync failed: %s", e)

            poll_task = asyncio.create_task(_poll_registry())
            cleanup_task = asyncio.create_task(_cleanup_loop())
            try:
                yield
            finally:
                poll_task.cancel()
                cleanup_task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await poll_task
                with contextlib.suppress(asyncio.CancelledError):
                    await cleanup_task
        finally:
            await mcp_lifespan_cm.__aexit__(None, None, None)

    return Starlette(
        routes=[*extra_routes, Mount("/", app=mcp_app)],
        middleware=[Middleware(KilnRequestIDMiddleware)],
        lifespan=lifespan,
    )


def main():
    import sys

    from kiln_shared.logging_config import setup_logging
    setup_logging()

    transport = sys.argv[1] if len(sys.argv) > 1 else "streamable-http"
    host = os.environ.get("KILN_MCP_HOST", "127.0.0.1")
    port = int(os.environ.get("KILN_MCP_PORT", "8768"))

    logger.info(
        "Starting Kiln MCP Server on %s:%s (transport: %s, auth: %s)",
        host, port, transport, "enabled" if _auth_enabled else "disabled",
    )

    if transport == "stdio":
        mcp.run(transport="stdio")
    else:
        import uvicorn
        app = build_http_app()
        uvicorn.run(app, host=host, port=port)


if __name__ == "__main__":
    main()
