"""
agents/run_all_agents.py
-------------------------
Run all three agents against the same Babel tool registry.
Shows that the same compiled tools work across pydantic-ai, AG2, and LangChain.
"""

from __future__ import annotations

import os
import sys
import time
import warnings
warnings.filterwarnings("ignore")
from pathlib import Path

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv
load_dotenv(ROOT.parent / ".env")

QUERY = (
    "What is the weather in Singapore and how long does it take "
    "to drive from Changi Airport to Marina Bay Sands?"
)

DIVIDER = "=" * 65


def section(title: str) -> None:
    print(f"\n{DIVIDER}")
    print(f"  {title}")
    print(DIVIDER)


# ─────────────────────────────────────────────────────────────────────────────
# 1. Pydantic-AI
# ─────────────────────────────────────────────────────────────────────────────

def run_pydantic() -> None:
    section("AGENT 1 — Pydantic-AI + Mistral")
    from agents.pydantic_agent import build_agent

    t0 = time.monotonic()
    agent = build_agent()
    result = agent.run_sync(QUERY)
    elapsed = time.monotonic() - t0

    print(f"Query:    {QUERY}\n")
    print(f"Response: {result.output}")
    print(f"\n  ✓ Pydantic-AI done in {elapsed:.1f}s")


# ─────────────────────────────────────────────────────────────────────────────
# 2. AG2 (AutoGen)
# ─────────────────────────────────────────────────────────────────────────────

def run_ag2() -> None:
    section("AGENT 2 — AG2 (AutoGen) + Mistral")

    import os, sys
    from pathlib import Path

    from babel.registry.local_registry import LocalRegistry
    from babel.runtime.babel_runtime import BabelRuntime
    import autogen
    from autogen import AssistantAgent, UserProxyAgent, register_function

    registry = LocalRegistry()
    runtime = BabelRuntime(registry=registry, dist_dir=ROOT / "dist")

    weather = runtime.load("com.aria.tools.weather")
    maps = runtime.load("com.aria.tools.maps_directions")

    llm_config = {
        "model": "mistral-large-latest",
        "api_key": os.getenv("MISTRAL_API_KEY"),
        "api_type": "mistral",
    }

    assistant = AssistantAgent(
        name="ARIA",
        system_message=(
            "You are ARIA. Use available tools to answer. "
            "End your final message with TERMINATE."
        ),
        llm_config=llm_config,
    )

    user_proxy = UserProxyAgent(
        name="User",
        human_input_mode="NEVER",
        max_consecutive_auto_reply=6,
        is_termination_msg=lambda msg: "TERMINATE" in msg.get("content", ""),
        code_execution_config=False,
    )

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

    print(f"Query: {QUERY}\n")
    t0 = time.monotonic()
    user_proxy.initiate_chat(assistant, message=QUERY, silent=False)
    elapsed = time.monotonic() - t0
    print(f"\n  ✓ AG2 done in {elapsed:.1f}s")


# ─────────────────────────────────────────────────────────────────────────────
# 3. LangChain
# ─────────────────────────────────────────────────────────────────────────────

def run_langchain() -> None:
    section("AGENT 3 — LangChain + Mistral")
    from agents.langchain_agent import run

    print(f"Query:    {QUERY}\n")
    t0 = time.monotonic()
    answer = run(QUERY)
    elapsed = time.monotonic() - t0

    print(f"Response: {answer}")
    print(f"\n  ✓ LangChain done in {elapsed:.1f}s")


# ─────────────────────────────────────────────────────────────────────────────
# Registry summary — same tools used by all three agents
# ─────────────────────────────────────────────────────────────────────────────

def print_registry_summary() -> None:
    from babel.registry.local_registry import LocalRegistry
    registry = LocalRegistry()

    section("BABEL REGISTRY SUMMARY")
    tools = registry.list()
    for t in tools:
        print(f"  {t['tool_id']}")
        print(f"    source: {t['source']}  |  tags: {', '.join(t['tags'][:3])}")

    print(f"\n  Total tools:    {len(tools)}")
    print(f"  Query hit rate: {registry.hit_rate():.1%}")
    print(f"\n  All three agents pulled from the same registry. ✓")


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print(f"\n{'='*65}")
    print("  BABEL MULTI-FRAMEWORK AGENT TEST")
    print("  Same tools. Three frameworks. One registry.")
    print(f"{'='*65}")

    results = {}

    try:
        run_pydantic()
        results["Pydantic-AI"] = "PASS"
    except Exception as exc:
        print(f"  ✗ Pydantic-AI FAILED: {exc}")
        results["Pydantic-AI"] = f"FAIL: {exc}"

    try:
        run_ag2()
        results["AG2"] = "PASS"
    except Exception as exc:
        print(f"  ✗ AG2 FAILED: {exc}")
        results["AG2"] = f"FAIL: {exc}"

    try:
        run_langchain()
        results["LangChain"] = "PASS"
    except Exception as exc:
        print(f"  ✗ LangChain FAILED: {exc}")
        results["LangChain"] = f"FAIL: {exc}"

    print_registry_summary()

    section("FINAL RESULTS")
    for framework, status in results.items():
        icon = "✓" if status == "PASS" else "✗"
        print(f"  {icon}  {framework:<15} {status}")
