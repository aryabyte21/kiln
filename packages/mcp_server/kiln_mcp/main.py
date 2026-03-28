"""
kiln/mcp_server/main.py
───────────────────────
Placeholder for the Kiln MCP Server.

In the MCP phase, this will be a stateless adapter that bridges the
MCP JSON-RPC protocol to the Registry API's REST endpoints:
  - tools/list → GET /tools
  - tools/call → POST /tools/{id}/execute
  - notifications/tools/list_changed → emitted when new tools are registered

For now, this is a placeholder to reserve the directory structure.
"""

from fastapi import FastAPI

app = FastAPI(
    title="KilnMCPServer",
    description="Placeholder — MCP server built in a later phase",
    version="1.0.0",
)


@app.get("/health")
def health():
    return {"status": "placeholder", "service": "kiln-mcp-server"}
