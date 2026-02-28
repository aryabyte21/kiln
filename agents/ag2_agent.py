"""
agents/ag2_agent.py
--------------------
AG2 (AutoGen) agent loading tools from Babel registry.

Flow:
  BabelRuntime.load() → {function, schema} → register_function(caller, executor) → initiate_chat()

AG2 uses a caller/executor pair:
  - AssistantAgent  → the LLM that decides which tool to call (caller)
  - UserProxyAgent  → executes the tool locally          (executor)
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv
load_dotenv(ROOT.parent / ".env")

import autogen
from autogen import AssistantAgent, UserProxyAgent, register_function

from babel_registry.registry.local_registry import LocalRegistry
from babel_registry.runtime.babel_runtime import BabelRuntime


def build_and_run(query: str) -> None:
    # ── Load tools from Babel ────────────────────────────────────────────────
    registry = LocalRegistry()
    runtime = BabelRuntime(registry=registry, dist_dir=ROOT / "dist")

    weather = runtime.load("com.aria.tools.weather")
    maps = runtime.load("com.aria.tools.maps_directions")

    # ── LLM config (Mistral via OpenAI-compatible endpoint) ──────────────────
    llm_config = {
        "model": "mistral-large-latest",
        "api_key": os.getenv("MISTRAL_API_KEY"),
        "api_type": "mistral",
    }

    # ── AG2 agent pair ────────────────────────────────────────────────────────
    assistant = AssistantAgent(
        name="ARIA",
        system_message=(
            "You are ARIA. Use the available tools to answer questions "
            "about weather and directions. Reply TERMINATE when done."
        ),
        llm_config=llm_config,
    )

    user_proxy = UserProxyAgent(
        name="User",
        human_input_mode="NEVER",
        max_consecutive_auto_reply=5,
        is_termination_msg=lambda msg: "TERMINATE" in msg.get("content", ""),
        code_execution_config=False,
    )

    # ── Register Babel tools with AG2 ─────────────────────────────────────────
    # register_function wires: LLM knows the schema (caller), proxy executes (executor)
    register_function(
        weather["function"],
        caller=assistant,
        executor=user_proxy,
        name=weather["name"],
        description=weather["description"],
    )

    register_function(
        maps["function"],
        caller=assistant,
        executor=user_proxy,
        name=maps["name"],
        description=maps["description"],
    )

    # ── Run ───────────────────────────────────────────────────────────────────
    user_proxy.initiate_chat(assistant, message=query, silent=False)


if __name__ == "__main__":
    print("\n[AG2 Agent]")
    build_and_run(
        "What is the weather in Singapore and how long to drive from Changi Airport to Marina Bay Sands?"
    )
