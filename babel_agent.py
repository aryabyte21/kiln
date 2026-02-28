"""
babel_agent.py
--------------
Pydantic-AI agent wired to the Babel infrastructure.

This script proves Engineer 2's full stack is working end-to-end:

  .env (MISTRAL_API_KEY)
      ↓
  MistralModel (mistral-large-latest)
      ↓
  pydantic-ai Agent
      ↓  uses tools loaded via:
  BabelRuntime.load(tool_id)          ← compile-on-demand + LRU cache
      ↓ reads from
  LocalRegistry.query / get           ← SQLite registry
      ↓ tools registered there by
  babel_seed (compile + publish)      ← AG2Adapter compiler

Run:
    python babel_agent.py
"""

from __future__ import annotations

import os
import sys
import textwrap
from pathlib import Path

# ── Load .env ────────────────────────────────────────────────────────────────
# .env is one level up (Mistral/ folder)
from dotenv import load_dotenv

_ENV_PATH = Path(__file__).parent.parent / ".env"
load_dotenv(_ENV_PATH)

MISTRAL_API_KEY = os.getenv("MISTRAL_API_KEY")
if not MISTRAL_API_KEY:
    print("ERROR: MISTRAL_API_KEY not found in .env", file=sys.stderr)
    sys.exit(1)

# ── Project root on path ─────────────────────────────────────────────────────
PROJECT_ROOT = Path(__file__).parent
sys.path.insert(0, str(PROJECT_ROOT))

# ── Babel imports ─────────────────────────────────────────────────────────────
from babel_registry.compiler.adapters.ag2_adapter import AG2Adapter
from babel_registry.registry.local_registry import LocalRegistry
from babel_registry.runtime.babel_runtime import BabelRuntime

# ── pydantic-ai imports ───────────────────────────────────────────────────────
from pydantic_ai import Agent
from pydantic_ai.models.mistral import MistralModel
from pydantic_ai.providers.mistral import MistralProvider


# ─────────────────────────────────────────────────────────────────────────────
# Step 1 — Seed the Babel registry with E2's pre-built tools
# ─────────────────────────────────────────────────────────────────────────────

def seed_registry(registry: LocalRegistry, dist_dir: Path) -> None:
    """Compile and publish all tools from tools/ into the registry."""
    tools_dir = PROJECT_ROOT / "tools"
    adapter = AG2Adapter()

    for spec_file in sorted(tools_dir.glob("*/spec.yaml")):
        tool_name = spec_file.parent.name
        try:
            spec = adapter.load_spec(spec_file)
            tool_id = spec["id"]

            if registry.query(tool_id):
                print(f"  [registry] already registered: {tool_id}")
                continue

            impl_path = (spec_file.parent / spec["implementation"]["entry_point"]).resolve()
            adapter.compile(spec, impl_path, dist_dir)
            registry.publish(spec, impl_path, source="pre-built")
            print(f"  [registry] published: {tool_id}")
        except Exception as exc:
            print(f"  [registry] FAILED {tool_name}: {exc}")


# ─────────────────────────────────────────────────────────────────────────────
# Step 2 — Load Babel tools and wrap for pydantic-ai
# ─────────────────────────────────────────────────────────────────────────────

def load_babel_tools(runtime: BabelRuntime) -> list:
    """Load compiled tools from BabelRuntime and return callables for pydantic-ai."""
    tool_ids = [
        "com.aria.tools.weather",
        "com.aria.tools.maps_directions",
    ]
    callables = []
    for tool_id in tool_ids:
        try:
            tool = runtime.load(tool_id)
            callables.append(tool["function"])
            print(f"  [runtime]  loaded: {tool_id}  →  fn={tool['name']}()")
        except Exception as exc:
            print(f"  [runtime]  FAILED {tool_id}: {exc}")
    return callables


# ─────────────────────────────────────────────────────────────────────────────
# Step 3 — Build the pydantic-ai Agent
# ─────────────────────────────────────────────────────────────────────────────

def build_agent(tool_functions: list) -> Agent:
    model = MistralModel(
        "mistral-large-latest",
        provider=MistralProvider(api_key=MISTRAL_API_KEY),
    )
    agent = Agent(
        model=model,
        tools=tool_functions,
        system_prompt=(
            "You are ARIA, an intelligent assistant. "
            "You have access to real-time weather and maps tools. "
            "Always use the tools when asked about weather or directions. "
            "Be concise and factual."
        ),
    )
    return agent


# ─────────────────────────────────────────────────────────────────────────────
# Step 4 — Run test scenarios
# ─────────────────────────────────────────────────────────────────────────────

TESTS = [
    {
        "name": "Weather query",
        "query": "What is the current weather in Singapore?",
        "expects": ["temperature", "conditions"],
    },
    {
        "name": "Directions query",
        "query": "How long does it take to drive from Changi Airport to Marina Bay Sands?",
        "expects": ["minutes", "km", "drive"],
    },
    {
        "name": "Combined — both tools",
        "query": (
            "I'm planning a trip. Tell me the weather in London right now "
            "and how long it takes to walk from Heathrow Airport to the British Museum."
        ),
        "expects": ["weather", "walk"],
    },
]


def run_tests(agent: Agent) -> None:
    passed = 0
    failed = 0

    for i, test in enumerate(TESTS, 1):
        print(f"\n{'─'*60}")
        print(f"Test {i}: {test['name']}")
        print(f"Query:   {test['query'][:80]}")
        print(f"{'─'*60}")

        try:
            result = agent.run_sync(test["query"])
            response = result.output
            print(f"Response:\n{textwrap.fill(response, width=70, initial_indent='  ')}")

            # Soft check: at least one expected keyword appears (case-insensitive)
            response_lower = response.lower()
            keyword_hits = [k for k in test["expects"] if k.lower() in response_lower]
            if keyword_hits:
                print(f"\n  ✓ PASS — response contains: {keyword_hits}")
                passed += 1
            else:
                print(f"\n  ~ SOFT FAIL — expected any of {test['expects']} in response")
                failed += 1

        except Exception as exc:
            print(f"  ✗ ERROR: {exc}")
            failed += 1

    print(f"\n{'='*60}")
    print(f"Results: {passed}/{len(TESTS)} tests passed")

    print(f"\nRegistry stats:")
    print(f"  Total tools:    {registry.count()}")
    print(f"  Query hit rate: {registry.hit_rate():.1%}")
    print(f"  Cache state:    {runtime.cache_info()}")
    print(f"{'='*60}")


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("\n" + "="*60)
    print("  BABEL INFRASTRUCTURE TEST — pydantic-ai + Mistral")
    print("="*60)

    dist_dir = PROJECT_ROOT / "dist"
    registry = LocalRegistry()
    runtime = BabelRuntime(registry=registry, dist_dir=dist_dir)

    print("\n[1] Seeding registry ...")
    seed_registry(registry, dist_dir)

    print("\n[2] Loading tools via BabelRuntime ...")
    tool_functions = load_babel_tools(runtime)

    if not tool_functions:
        print("ERROR: No tools loaded — cannot build agent.", file=sys.stderr)
        sys.exit(1)

    print(f"\n[3] Building pydantic-ai Agent (mistral-large-latest) ...")
    agent = build_agent(tool_functions)
    print("  Agent ready.")

    print("\n[4] Running test queries ...")
    run_tests(agent)
