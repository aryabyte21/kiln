"""
test_pydantic_unit_converter.py
--------------------------------
Uses a pydantic-ai Agent to call the unit_converter Babel tool.

Steps this file runs:
  1. Load com.aria.tools.unit_converter from the registry via BabelRuntime
  2. Get the compiler-native pydantic_ai.Tool (TOOL_OBJECT)
  3. Create a pydantic-ai Agent backed by Mistral
  4. Ask three natural-language questions that require the tool
  5. Print responses

Run:
    python3 test_pydantic_unit_converter.py
"""

import os
import sys
from pathlib import Path

ROOT = Path(__file__).parent
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv
load_dotenv(ROOT.parent / ".env")

from babel_registry.registry.local_registry import LocalRegistry
from babel_registry.runtime.babel_runtime import BabelRuntime
from pydantic_ai import Agent
from pydantic_ai.models.mistral import MistralModel
from pydantic_ai.providers.mistral import MistralProvider

TOOL_ID = "com.aria.tools.unit_converter"

QUERIES = [
    "How many miles is 10 kilometres?",
    "Convert 98.6 degrees Fahrenheit to Celsius.",
    "I weigh 80 kg. What is that in pounds?",
]


def main():
    # ── 1. Load tool from registry ────────────────────────────────────────────
    registry = LocalRegistry()
    runtime  = BabelRuntime(registry=registry, dist_dir=ROOT / "dist")

    print(f"\nLoading '{TOOL_ID}' with target='pydantic' ...")
    tool = runtime.load(TOOL_ID, target="pydantic")

    tool_obj = tool["tool_object"]
    print(f"  Tool loaded : {tool['name']}")
    print(f"  TOOL_OBJECT : {type(tool_obj).__name__}")

    # ── 2. Build pydantic-ai Agent ────────────────────────────────────────────
    api_key = os.getenv("MISTRAL_API_KEY")
    if not api_key:
        print("\nERROR: MISTRAL_API_KEY not set in .env", file=sys.stderr)
        sys.exit(1)

    model = MistralModel(
        "mistral-large-latest",
        provider=MistralProvider(api_key=api_key),
    )
    agent = Agent(
        model=model,
        tools=[tool_obj],
        system_prompt=(
            "You are ARIA, a helpful assistant. "
            "Use the unit_converter tool to answer measurement questions accurately."
        ),
    )

    # ── 3. Run queries ────────────────────────────────────────────────────────
    print(f"\n{'='*60}")
    print("  PYDANTIC-AI AGENT — Unit Converter")
    print(f"{'='*60}")

    all_passed = True
    for i, query in enumerate(QUERIES, 1):
        print(f"\n[{i}] Q: {query}")
        try:
            result   = agent.run_sync(query)
            response = result.output
            print(f"     A: {response}")
        except Exception as e:
            print(f"     ERROR: {e}")
            all_passed = False

    print(f"\n{'='*60}")
    print("  Done.")
    print(f"{'='*60}\n")
    sys.exit(0 if all_passed else 1)


if __name__ == "__main__":
    main()
