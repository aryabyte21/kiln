"""
test_external_pydantic_agent.py
---------------------------------
Simulates an external pydantic-ai agent that calls Babel tools over HTTP.

This file has ZERO knowledge of:
  - Where impl.py lives on disk
  - The babel_registry package internals
  - Any local file paths

All it knows:
  - The Babel Tool Server URL  (BABEL_SERVER_URL)
  - The tool ID it wants to use
  - Its own Mistral API key

Run (two terminals):

  Terminal 1 — start the Babel tool server:
      python3 -m babel_registry.server.tool_server

  Terminal 2 — run this agent:
      python3 test_external_pydantic_agent.py
"""

import inspect
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent / ".env")

import httpx
from pydantic_ai import Agent
from pydantic_ai.models.mistral import MistralModel
from pydantic_ai.providers.mistral import MistralProvider
from pydantic_ai.tools import Tool as PydanticTool

# ── config ────────────────────────────────────────────────────────────────────

SERVER_URL = os.getenv("BABEL_SERVER_URL", "http://localhost:8000")
TOOL_ID    = "com.aria.tools.unit_converter"

QUERIES = [
    "How many miles is 10 kilometres?",
    "Convert 98.6 Fahrenheit to Celsius.",
    "I weigh 80 kg — how many pounds is that?",
]


# ── remote tool factory ───────────────────────────────────────────────────────

_JSON_TYPE_MAP = {
    "string":  str,
    "integer": int,
    "number":  float,
    "boolean": bool,
    "object":  dict,
    "array":   list,
}


def make_remote_tool(tool_id: str, server_url: str) -> PydanticTool:
    """
    Build a pydantic_ai.Tool that calls the Babel Tool Server over HTTP.

    Dynamically reconstructs the exact function signature from the server's
    schema so pydantic-ai knows which parameters to pass to the LLM.

    The agent doesn't import anything from babel_registry — it only sends
    HTTP requests to the server.
    """
    # Fetch tool schema from server
    resp = httpx.get(f"{server_url}/tools/{tool_id}/schema", timeout=10)
    if resp.status_code == 404:
        raise RuntimeError(f"Tool '{tool_id}' not found on server {server_url}")
    resp.raise_for_status()

    schema    = resp.json()
    fn_name   = schema["function"]["name"]
    fn_desc   = schema["function"]["description"]
    props     = schema["function"]["parameters"]["properties"]
    required  = schema["function"]["parameters"].get("required", [])

    # Build an explicit typed signature so pydantic-ai can infer parameters
    sig_params = []
    for pname, pinfo in props.items():
        annotation = _JSON_TYPE_MAP.get(pinfo.get("type", "string"), str)
        default    = inspect.Parameter.empty if pname in required else None
        sig_params.append(
            inspect.Parameter(
                pname,
                kind=inspect.Parameter.POSITIONAL_OR_KEYWORD,
                default=default,
                annotation=annotation,
            )
        )

    def call_remote(**kwargs) -> dict:
        response = httpx.post(
            f"{server_url}/tools/{tool_id}/invoke",
            json={"args": kwargs},
            timeout=30,
        )
        response.raise_for_status()
        return response.json()

    # Patch the function with the explicit signature, name, and docstring.
    # pydantic-ai uses BOTH inspect.signature() and typing.get_type_hints(),
    # so we must set __signature__ AND __annotations__ together.
    call_remote.__signature__  = inspect.Signature(sig_params)
    call_remote.__annotations__ = {p.name: p.annotation for p in sig_params}
    call_remote.__annotations__["return"] = dict
    call_remote.__name__       = fn_name
    call_remote.__doc__        = fn_desc

    return PydanticTool(call_remote, name=fn_name, description=fn_desc)


# ── main ──────────────────────────────────────────────────────────────────────

def main():
    print(f"\n{'='*60}")
    print("  EXTERNAL PYDANTIC-AI AGENT")
    print(f"  Server : {SERVER_URL}")
    print(f"  Tool   : {TOOL_ID}")
    print(f"{'='*60}")

    # Check server is up
    try:
        httpx.get(f"{SERVER_URL}/tools", timeout=5).raise_for_status()
    except Exception:
        print(f"\nERROR: Cannot reach Babel server at {SERVER_URL}")
        print("  Run this first:  python3 -m babel_registry.server.tool_server")
        sys.exit(1)

    # Build remote tool — no babel_registry imports needed
    print(f"\nFetching tool schema from server ...")
    tool = make_remote_tool(TOOL_ID, SERVER_URL)
    print(f"  Remote tool ready: {tool.name}")

    # Build agent
    api_key = os.getenv("MISTRAL_API_KEY")
    if not api_key:
        print("ERROR: MISTRAL_API_KEY not set", file=sys.stderr)
        sys.exit(1)

    model = MistralModel(
        "mistral-large-latest",
        provider=MistralProvider(api_key=api_key),
    )
    agent = Agent(
        model=model,
        tools=[tool],
        system_prompt=(
            "You are an external assistant. "
            "Use the unit_converter tool to answer measurement questions."
        ),
    )

    # Run queries
    for i, query in enumerate(QUERIES, 1):
        print(f"\n[{i}] Q: {query}")
        try:
            result = agent.run_sync(query)
            print(f"     A: {result.output}")
        except Exception as e:
            print(f"     ERROR: {e}")

    print(f"\n{'='*60}\n")


if __name__ == "__main__":
    main()
