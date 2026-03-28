"""
demo_register_tool.py
─────────────────────
Demonstrates registering a brand new tool at runtime and immediately
using it across all three framework adapters without touching any
existing code.

Steps shown:
  1. Load the 8 core tools (they auto-register on import)
  2. Define and register a new `currency_convert` tool
  3. Verify it appears in the registry
  4. Test it live through Mistral, Pydantic AI, and AG2

Usage:
    export MISTRAL_API_KEY=your_key_here
    cd /Users/shekharsomani/Desktop/projects/babel
    conda run -n shekhar python demo_register_tool.py
"""

import os
import sys
import json

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "babel"))

# ── Babel ─────────────────────────────────────────────────────────────────────
from babel import babel_tool, register, get_global_registry, BabelRuntime
import babel.tools.core_tools  # registers the 8 built-in tools

# ── Framework clients ─────────────────────────────────────────────────────────
from mistralai import Mistral
from pydantic_ai import Agent
from pydantic_ai.models.mistral import MistralModel
from pydantic_ai.providers.mistral import MistralProvider
from autogen import AssistantAgent, UserProxyAgent

MODEL = "mistral-large-latest"

# ── Colours ───────────────────────────────────────────────────────────────────
CYAN   = "\033[96m"
GREEN  = "\033[92m"
YELLOW = "\033[93m"
MAGENTA= "\033[95m"
BOLD   = "\033[1m"
RESET  = "\033[0m"


def _p(colour: str, text: str) -> None:
    print(f"{colour}{text}{RESET}")


# ─────────────────────────────────────────────────────────────────────────────
# Step 1 — Define and register the new tool
# ─────────────────────────────────────────────────────────────────────────────

@babel_tool(
    id="com.aria.tools.currency_convert",
    description=(
        "Convert a monetary amount from one currency to another. "
        "Returns the converted amount and the exchange rate used."
    ),
    tags=["finance", "currency", "conversion"],
    category="finance",
    param_descriptions={
        "amount":        "The amount to convert (must be positive)",
        "from_currency": "Source currency code",
        "to_currency":   "Target currency code",
    },
    param_enums={
        "from_currency": ["USD", "SGD", "EUR", "GBP", "JPY"],
        "to_currency":   ["USD", "SGD", "EUR", "GBP", "JPY"],
    },
)
def currency_convert(amount: float, from_currency: str, to_currency: str) -> dict:
    """Mock exchange rates pegged to USD. Swap in a live FX API here."""
    rates_to_usd = {
        "USD": 1.0000,
        "SGD": 0.7410,
        "EUR": 1.0820,
        "GBP": 1.2710,
        "JPY": 0.0067,
    }
    if from_currency not in rates_to_usd or to_currency not in rates_to_usd:
        return {"error": "Unsupported currency pair", "success": False}

    usd_amount    = amount * rates_to_usd[from_currency]
    converted     = usd_amount / rates_to_usd[to_currency]
    rate          = rates_to_usd[from_currency] / rates_to_usd[to_currency]

    return {
        "amount":        amount,
        "from_currency": from_currency,
        "to_currency":   to_currency,
        "converted":     round(converted, 2),
        "rate":          round(rate, 6),
        "success":       True,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Step 2 — Mistral test
# ─────────────────────────────────────────────────────────────────────────────

def test_mistral(query: str, client: Mistral, registry) -> None:
    _p(MAGENTA, "\n  [Mistral direct]")

    runtime = BabelRuntime(target="mistral", registry=registry)
    # Only expose the new tool so the test is focused
    compiled  = runtime.get("com.aria.tools.currency_convert")
    tool_map  = {compiled.name: compiled}
    tool_defs = [compiled.tool_def]

    messages = [{"role": "user", "content": query}]

    while True:
        response = client.chat.complete(
            model=MODEL, messages=messages, tools=tool_defs, tool_choice="auto"
        )
        msg = response.choices[0].message
        messages.append(msg)
        if not msg.tool_calls:
            _p(GREEN, f"  ← {msg.content}")
            return

        for tc in msg.tool_calls:
            args   = json.loads(tc.function.arguments) if isinstance(tc.function.arguments, str) else tc.function.arguments
            _p(YELLOW, f"  → {tc.function.name}({args})")
            result = tool_map[tc.function.name].call(args)
            _p(GREEN, f"  ← {result}")
            messages.append({
                "role": "tool", "tool_call_id": tc.id,
                "name": tc.function.name, "content": json.dumps(result),
            })


# ─────────────────────────────────────────────────────────────────────────────
# Step 3 — Pydantic AI test
# ─────────────────────────────────────────────────────────────────────────────

def test_pydantic_ai(query: str, api_key: str, registry) -> None:
    _p(MAGENTA, "\n  [Pydantic AI]")

    runtime  = BabelRuntime(target="pydantic_ai", registry=registry)
    compiled = runtime.get("com.aria.tools.currency_convert")
    pai_tool = compiled.as_tool()

    model = MistralModel(MODEL, provider=MistralProvider(api_key=api_key))
    agent = Agent(model, tools=[pai_tool])
    result = agent.run_sync(query)

    for msg in result.all_messages():
        for part in getattr(msg, "parts", []):
            kind = getattr(part, "part_kind", None)
            if kind == "tool-call":
                args_raw = getattr(getattr(part, "args", ""), "args_dict", part.args)
                _p(YELLOW, f"  → {part.tool_name}({args_raw})")
            elif kind == "tool-return":
                _p(GREEN, f"  ← {part.content}")

    _p(GREEN, f"  ← {result.output}")


# ─────────────────────────────────────────────────────────────────────────────
# Step 4 — AG2 test
# ─────────────────────────────────────────────────────────────────────────────

def test_ag2(query: str, api_key: str, registry) -> None:
    _p(MAGENTA, "\n  [AG2]")

    llm_config = {
        "config_list": [{"model": MODEL, "api_key": api_key, "api_type": "mistral"}],
        "cache_seed": None,
    }

    assistant = AssistantAgent(
        name="assistant",
        llm_config=llm_config,
        system_message=(
            "You are a helpful assistant. Use tools when needed. "
            "Reply TERMINATE when the task is fully complete."
        ),
        is_termination_msg=lambda m: "TERMINATE" in m.get("content", ""),
    )
    user_proxy = UserProxyAgent(
        name="user_proxy",
        human_input_mode="NEVER",
        max_consecutive_auto_reply=5,
        code_execution_config=False,
        is_termination_msg=lambda m: "TERMINATE" in m.get("content", ""),
    )

    runtime  = BabelRuntime(target="ag2", registry=registry)
    compiled = runtime.get("com.aria.tools.currency_convert")
    compiled.register(caller=assistant, executor=user_proxy)

    user_proxy.initiate_chat(assistant, message=query, silent=False, max_turns=6)


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

def main() -> None:
    api_key = os.environ.get("MISTRAL_API_KEY", "").strip()
    if not api_key:
        print("Error: MISTRAL_API_KEY environment variable is not set.")
        sys.exit(1)

    registry = get_global_registry()

    # ── Before registration ───────────────────────────────────────────────
    _p(BOLD, "\n─── Registry BEFORE registering new tool ───────────────────")
    _p(CYAN,  f"  Tool count : {len(registry)}")
    _p(CYAN,  f"  Tool IDs   : {registry.list_ids()}")

    # ── Register the new tool ─────────────────────────────────────────────
    _p(BOLD, "\n─── Registering: com.aria.tools.currency_convert ───────────")
    register(currency_convert)

    # ── After registration ────────────────────────────────────────────────
    _p(BOLD, "\n─── Registry AFTER registering new tool ────────────────────")
    _p(CYAN,  f"  Tool count : {len(registry)}")
    _p(CYAN,  f"  Tool IDs   : {registry.list_ids()}")

    # Spot-check the spec
    spec = registry.get("com.aria.tools.currency_convert").spec
    _p(CYAN,  f"  Spec ID    : {spec.id}")
    _p(CYAN,  f"  Params     : {[p.name for p in spec.params]}")
    _p(CYAN,  f"  Category   : {spec.category}")
    _p(CYAN,  f"  Tags       : {spec.tags}")

    # ── Test query ────────────────────────────────────────────────────────
    QUERY = "How much is 250 SGD in EUR? Show the rate too."

    _p(BOLD, f"\n{'━' * 62}")
    _p(CYAN,  f"  Query: {QUERY}")
    _p(BOLD,  f"{'━' * 62}")

    client = Mistral(api_key=api_key)

    test_mistral(QUERY, client, registry)
    test_pydantic_ai(QUERY, api_key, registry)
    test_ag2(QUERY, api_key, registry)

    _p(BOLD, "\n─── All three adapters returned results for the new tool ────")


if __name__ == "__main__":
    main()
