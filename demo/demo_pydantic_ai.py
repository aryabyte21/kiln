"""
demo_pydantic_ai.py
────────────────────
Demonstrates Babel tools inside a Pydantic AI agent backed by Mistral.

The Pydantic AI adapter compiles each BabelTool into a pydantic_ai.Tool
by building a properly-annotated wrapper function that Pydantic AI can
introspect to generate the schema it sends to the model.

Usage:
    export MISTRAL_API_KEY=your_key_here
    cd /Users/shekharsomani/Desktop/projects/babel
    conda run -n shekhar python demo_pydantic_ai.py
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "babel"))

# ── Babel setup ──────────────────────────────────────────────────────────────
from babel import BabelRuntime, get_global_registry
import babel.tools.core_tools  # side-effect: registers all 8 tools

# ── Pydantic AI ───────────────────────────────────────────────────────────────
from pydantic_ai import Agent
from pydantic_ai.models.mistral import MistralModel
from pydantic_ai.providers.mistral import MistralProvider

MODEL = "mistral-large-latest"

# ── Colour helpers ────────────────────────────────────────────────────────────
CYAN   = "\033[96m"
GREEN  = "\033[92m"
YELLOW = "\033[93m"
BOLD   = "\033[1m"
RESET  = "\033[0m"


def _p(colour: str, text: str) -> None:
    print(f"{colour}{text}{RESET}")


# ── Test scenarios ────────────────────────────────────────────────────────────

QUERIES = [
    # 1. Single tool
    "What is the current weather in Singapore? Give me all the details.",

    # 2. Two-step: contacts → WhatsApp
    (
        "Look up Rahul's contact and send him an email saying "
        "'Hi Rahul, the project demo went great today!'"
    ),

    # 3. Three-step: restaurant → directions → calendar
    (
        "Find an Italian restaurant near Marina Bay, Singapore for 2 people. "
        "Get directions from Raffles Hotel to that restaurant by walking. "
        "Then create a calendar event 'Lunch with team' on 2025-07-10 at 12:30 "
        "at the restaurant for 90 minutes."
    ),
]


# ── Runner ────────────────────────────────────────────────────────────────────

def run_query(agent: Agent, query: str) -> None:
    _p(BOLD, f"\n{'━' * 62}")
    _p(CYAN, f"  Query: {query}")
    _p(BOLD, f"{'━' * 62}")

    result = agent.run_sync(query)

    # Print tool call trace from message history
    for msg in result.all_messages():
        # ToolCallPart messages show what tools were invoked
        for part in getattr(msg, "parts", []):
            kind = getattr(part, "part_kind", None)
            if kind == "tool-call":
                args = getattr(part, "args", "")
                # args may be an ArgsDict or plain dict
                args_raw = getattr(args, "args_dict", args)
                _p(YELLOW, f"\n  → Tool call: {part.tool_name}({args_raw})")
            elif kind == "tool-return":
                _p(GREEN, f"  ← Result: {part.content}")

    _p(BOLD, "\n  [Final Answer]")
    print(f"  {result.output}\n")


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    api_key = os.environ.get("MISTRAL_API_KEY", "").strip()
    if not api_key:
        print("Error: MISTRAL_API_KEY environment variable is not set.")
        sys.exit(1)

    # ── Build tool list from Babel registry ───────────────────────────────
    registry = get_global_registry()
    runtime  = BabelRuntime(target="pydantic_ai", registry=registry)

    compiled_tools = runtime.get_all()
    pai_tools      = [t.as_tool() for t in compiled_tools]

    _p(BOLD, f"\n[Babel → Pydantic AI] {len(pai_tools)} tools compiled")
    _p(CYAN, f"  Tools: {[t.name for t in compiled_tools]}")
    _p(CYAN, f"  Model: {MODEL}\n")

    # ── Create the Pydantic AI agent ──────────────────────────────────────
    model = MistralModel(MODEL, provider=MistralProvider(api_key=api_key))
    agent = Agent(model, tools=pai_tools)

    # ── Run test scenarios ────────────────────────────────────────────────
    for query in QUERIES:
        run_query(agent, query)


if __name__ == "__main__":
    main()
