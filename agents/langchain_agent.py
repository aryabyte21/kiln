"""
agents/langchain_agent.py
--------------------------
LangChain agent loading tools from Babel registry.

Flow:
  BabelRuntime.load() → {function, schema} → StructuredTool → ChatMistralAI.bind_tools()
  → tool-calling loop → final answer

LangChain wraps Babel callables as StructuredTool objects, which give
the LLM a JSON schema and execute the callable on tool_call responses.
"""

from __future__ import annotations

import json
import os
import sys
import warnings
warnings.filterwarnings("ignore")
from pathlib import Path

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv
load_dotenv(ROOT.parent / ".env")

from langchain_core.tools import StructuredTool
from langchain_core.messages import HumanMessage, AIMessage, ToolMessage
from langchain_mistralai import ChatMistralAI

from babel_registry.registry.local_registry import LocalRegistry
from babel_registry.runtime.babel_runtime import BabelRuntime


def babel_tool_to_langchain(tool: dict) -> StructuredTool:
    """Convert a Babel runtime tool dict into a LangChain StructuredTool."""
    # Extract the JSON schema parameters block for LangChain
    fn_schema = tool["schema"]["function"]
    params_schema = fn_schema["parameters"]

    return StructuredTool.from_function(
        func=tool["function"],
        name=tool["name"],
        description=tool["description"],
        args_schema=None,   # LangChain infers from function signature
    )


def run(query: str) -> str:
    # ── Load tools from Babel ────────────────────────────────────────────────
    registry = LocalRegistry()
    runtime = BabelRuntime(registry=registry, dist_dir=ROOT / "dist")

    weather = runtime.load("com.aria.tools.weather")
    maps = runtime.load("com.aria.tools.maps_directions")

    lc_tools = [
        babel_tool_to_langchain(weather),
        babel_tool_to_langchain(maps),
    ]

    # ── LangChain + Mistral ───────────────────────────────────────────────────
    llm = ChatMistralAI(
        model="mistral-large-latest",
        api_key=os.getenv("MISTRAL_API_KEY"),
        temperature=0,
    )
    llm_with_tools = llm.bind_tools(lc_tools)

    # ── Tool-calling loop ─────────────────────────────────────────────────────
    messages = [HumanMessage(content=query)]

    while True:
        response: AIMessage = llm_with_tools.invoke(messages)
        messages.append(response)

        # No tool calls → final answer
        if not response.tool_calls:
            return response.content

        # Execute each tool call and feed results back
        for tc in response.tool_calls:
            tool_name = tc["name"]
            tool_args = tc["args"]
            tool_id = tc["id"]

            # Find the matching LangChain tool and invoke it
            matched = next((t for t in lc_tools if t.name == tool_name), None)
            if matched:
                result = matched.invoke(tool_args)
            else:
                result = {"error": f"Unknown tool: {tool_name}"}

            messages.append(
                ToolMessage(
                    content=json.dumps(result),
                    tool_call_id=tool_id,
                )
            )


if __name__ == "__main__":
    print("\n[LangChain Agent]")
    answer = run(
        "What is the weather in Singapore and how long to drive from Changi Airport to Marina Bay Sands?"
    )
    print(answer)
