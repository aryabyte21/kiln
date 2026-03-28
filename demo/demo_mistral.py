"""
demo_mistral.py
───────────────
Demonstrates Babel with a Mistral agent using tool calling.

The agent can use all 8 core Babel tools to answer a natural language
query. Tool definitions are compiled once by the Mistral adapter;
the agentic loop handles multi-step function calling automatically.

Usage:
    export MISTRAL_API_KEY=your_key_here
    cd /Users/shekharsomani/Desktop/projects/babel
    python demo_mistral.py
"""

import os
import sys
import json

# Make sure the babel package is importable when running from this directory.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "babel"))

from babel import BabelRuntime, get_global_registry
import babel.tools.core_tools  # side-effect: registers all 8 tools

try:
    from mistralai import Mistral
except ImportError:
    print("Mistral SDK not installed. Run: pip install mistralai")
    sys.exit(1)


MODEL = "mistral-large-latest"

# ── Colour helpers (optional, degrades gracefully on terminals without ANSI) ──

CYAN   = "\033[96m"
GREEN  = "\033[92m"
YELLOW = "\033[93m"
RESET  = "\033[0m"
BOLD   = "\033[1m"


def _p(colour: str, text: str) -> None:
    print(f"{colour}{text}{RESET}")


# ── Agentic loop ──────────────────────────────────────────────────────────────

def run_agent(
    query: str,
    compiled_tools: list,
    tool_map: dict,
    client: "Mistral",
) -> str:
    """
    Send a query to Mistral and keep calling tools until the model
    produces a final text answer (no more tool_calls in the response).

    Args:
        query:          The user's natural-language question.
        compiled_tools: List of CompiledMistralTool objects from BabelRuntime.
        tool_map:       Dict mapping function name → CompiledMistralTool.
        client:         Authenticated Mistral client.

    Returns:
        The model's final text response.
    """
    tool_defs = [t.tool_def for t in compiled_tools]
    messages  = [{"role": "user", "content": query}]

    _p(BOLD, f"\n{'━' * 62}")
    _p(CYAN, f"  Query: {query}")
    _p(BOLD, f"{'━' * 62}")

    step = 0
    while True:
        step += 1
        response = client.chat.complete(
            model=MODEL,
            messages=messages,
            tools=tool_defs,
            tool_choice="auto",
        )

        message = response.choices[0].message

        # Append the assistant turn (with or without tool_calls)
        messages.append(message)

        # No tool calls → final answer
        if not message.tool_calls:
            return message.content

        # ── Execute every tool call the model requested ────────────────────
        _p(YELLOW, f"\n  [Step {step}] Model requested {len(message.tool_calls)} tool call(s):")

        for tc in message.tool_calls:
            fn_name = tc.function.name
            raw_args = tc.function.arguments

            # Mistral may return args as a string or already-parsed dict
            args = json.loads(raw_args) if isinstance(raw_args, str) else raw_args

            _p(YELLOW, f"    → {fn_name}({json.dumps(args)})")

            compiled = tool_map.get(fn_name)
            if compiled is None:
                result = {"error": f"Unknown tool: {fn_name}"}
            else:
                try:
                    result = compiled.call(args)
                except Exception as exc:
                    result = {"error": str(exc)}

            _p(GREEN, f"    ← {json.dumps(result, ensure_ascii=False)}")

            # Feed the result back to Mistral as a tool message
            messages.append({
                "role":         "tool",
                "tool_call_id": tc.id,
                "name":         fn_name,
                "content":      json.dumps(result, ensure_ascii=False),
            })


# ── Demo scenarios ────────────────────────────────────────────────────────────

QUERIES = [
    # Single-tool: weather
    "What is the current weather in Singapore?",

    # Multi-tool: contacts + WhatsApp
    (
        "Look up Priya's contact details, then send her a WhatsApp message "
        "saying 'Hey Priya, are you free for lunch tomorrow?'"
    ),

    # Multi-tool: restaurant + calendar
    (
        "Find a good Japanese restaurant near Marina Bay, Singapore for 2 people. "
        "Once you have the restaurant name, create a calendar event called "
        "'Dinner with Priya' for 2025-06-15 at 19:00 at that restaurant."
    ),
]


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    api_key = os.environ.get("MISTRAL_API_KEY", "").strip()
    if not api_key:
        print("Error: MISTRAL_API_KEY environment variable is not set.")
        print("  export MISTRAL_API_KEY=your_key_here")
        sys.exit(1)

    client = Mistral(api_key=api_key)

    # ── Build the tool set ────────────────────────────────────────────────
    registry = get_global_registry()
    runtime  = BabelRuntime(target="mistral", registry=registry)

    compiled_tools = runtime.get_all()
    tool_map       = {t.name: t for t in compiled_tools}

    _p(BOLD, f"\n[Babel] {len(compiled_tools)} tools loaded into Mistral agent")
    _p(CYAN, f"  Tools: {[t.name for t in compiled_tools]}")
    _p(CYAN, f"  Model: {MODEL}\n")

    # ── Run each demo query ───────────────────────────────────────────────
    for query in QUERIES:
        answer = run_agent(query, compiled_tools, tool_map, client)
        _p(BOLD, "\n  [Final Answer]")
        print(f"  {answer}")
        print()


if __name__ == "__main__":
    main()
