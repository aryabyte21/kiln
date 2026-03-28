"""
demo_ag2.py
───────────
Demonstrates Babel tools inside an AG2 (AutoGen) agent backed by Mistral.

The AG2 adapter compiles each BabelTool into a typed wrapper function
whose signature is built with exec() so AG2's inspect.signature()
introspection works correctly. Tools are registered with register_function
so the AssistantAgent can plan calls and the UserProxyAgent executes them.

Usage:
    export MISTRAL_API_KEY=your_key_here
    cd /Users/shekharsomani/Desktop/projects/babel
    conda run -n shekhar python demo_ag2.py
"""

import os
import sys
import io
import contextlib

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "babel"))

# ── Babel setup ──────────────────────────────────────────────────────────────
from babel import BabelRuntime, get_global_registry
import babel.tools.core_tools  # side-effect: registers all 8 tools

# ── AG2 ───────────────────────────────────────────────────────────────────────
from autogen import AssistantAgent, UserProxyAgent

MODEL   = "mistral-large-latest"

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
    "What is the current weather in Singapore? Provide all the details.",

    # 2. Two-step: contacts → email
    (
        "Look up Rahul in the contacts. "
        "Then send him an email with subject 'Meeting Tomorrow' and body "
        "'Hi Rahul, just a reminder that we have a meeting at 10am tomorrow.'"
    ),

    # 3. Two-step: restaurant → calendar
    (
        "Search for a top-rated Indian restaurant near Marina Bay, Singapore "
        "for 4 people. Once found, create a Google Calendar event titled "
        "'Team Dinner' on 2025-08-20 at 19:30 at that restaurant for 2 hours."
    ),
]


# ── Runner ────────────────────────────────────────────────────────────────────

def run_query(query: str, assistant: AssistantAgent, user_proxy: UserProxyAgent) -> None:
    _p(BOLD, f"\n{'━' * 62}")
    _p(CYAN, f"  Query: {query}")
    _p(BOLD, f"{'━' * 62}\n")

    # Reset conversation history between queries so agents start fresh
    assistant.reset()
    user_proxy.reset()

    user_proxy.initiate_chat(
        assistant,
        message=query,
        silent=False,
        max_turns=10,
    )


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    api_key = os.environ.get("MISTRAL_API_KEY", "").strip()
    if not api_key:
        print("Error: MISTRAL_API_KEY environment variable is not set.")
        sys.exit(1)

    # ── AG2 / Mistral config ──────────────────────────────────────────────
    llm_config = {
        "config_list": [
            {
                "model":    MODEL,
                "api_key":  api_key,
                "api_type": "mistral",
            }
        ],
        "cache_seed": None,   # disable caching for live demos
    }

    # ── Create agents ─────────────────────────────────────────────────────
    assistant = AssistantAgent(
        name="assistant",
        llm_config=llm_config,
        system_message=(
            "You are a helpful assistant. Use the provided tools to answer "
            "the user's request. Always call a tool when it is relevant. "
            "Reply TERMINATE when you have fully completed the task."
        ),
        is_termination_msg=lambda msg: "TERMINATE" in msg.get("content", ""),
    )

    user_proxy = UserProxyAgent(
        name="user_proxy",
        human_input_mode="NEVER",
        max_consecutive_auto_reply=10,
        code_execution_config=False,
        is_termination_msg=lambda msg: "TERMINATE" in msg.get("content", ""),
    )

    # ── Compile & register all Babel tools with AG2 ───────────────────────
    registry = get_global_registry()
    runtime  = BabelRuntime(target="ag2", registry=registry)

    compiled_tools = runtime.get_all()

    _p(BOLD, f"\n[Babel → AG2] {len(compiled_tools)} tools compiled")
    _p(CYAN, f"  Tools: {[t.name for t in compiled_tools]}")
    _p(CYAN, f"  Model: {MODEL}\n")

    for compiled in compiled_tools:
        compiled.register(caller=assistant, executor=user_proxy)

    # ── Run test scenarios ────────────────────────────────────────────────
    for query in QUERIES:
        run_query(query, assistant, user_proxy)
        print()


if __name__ == "__main__":
    main()
