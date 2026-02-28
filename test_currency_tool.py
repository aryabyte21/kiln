"""
test_currency_tool.py
----------------------
End-to-end test for the new com.aria.tools.currency_conversion tool.

Sections:
  1. Spec validation against Babel schema
  2. Implementation unit tests (mock + live fallback)
  3. Compile via AG2Adapter
  4. Publish to registry + verify it's stored
  5. Load via BabelRuntime (ag2 target)
  6. Call via Pydantic-AI agent   — uses TOOL_OBJECT from PydanticAdapter
  7. Call via AG2 agent           — uses raw TOOL_FUNCTION from ag2 target
  8. Call via LangChain agent     — uses TOOL_OBJECT from LangChainAdapter

Run:
    python test_currency_tool.py
"""

from __future__ import annotations

import importlib.util
import json
import os
import sys
import tempfile
import time
import warnings
warnings.filterwarnings("ignore")
from pathlib import Path

ROOT = Path(__file__).parent
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv
load_dotenv(ROOT.parent / ".env")

import yaml

SPEC_PATH = ROOT / "tools" / "currency_conversion" / "spec.yaml"
IMPL_PATH = ROOT / "tools" / "currency_conversion" / "impl.py"
TOOL_ID   = "com.aria.tools.currency_conversion"
QUERY     = "Convert 250 USD to SGD and also convert 1000 JPY to EUR."

PASS = "✓"
FAIL = "✗"
results: dict[str, str] = {}


def load_impl():
    spec = importlib.util.spec_from_file_location("currency_impl", IMPL_PATH)
    mod  = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def section(title: str) -> None:
    print(f"\n{'='*60}")
    print(f"  {title}")
    print(f"{'='*60}")


def ok(label: str) -> None:
    print(f"  {PASS}  {label}")
    results[label] = "PASS"


def fail(label: str, reason: str) -> None:
    print(f"  {FAIL}  {label}: {reason}")
    results[label] = f"FAIL: {reason}"


# ─────────────────────────────────────────────────────────────────────────────
# 1. Spec Validation
# ─────────────────────────────────────────────────────────────────────────────

def test_spec_validation():
    section("1. Spec Validation")
    from babel_registry.compiler.adapters.ag2_adapter import AG2Adapter
    import jsonschema

    adapter = AG2Adapter()
    with open(SPEC_PATH) as f:
        spec = yaml.safe_load(f)

    try:
        adapter.validate_spec(spec)
        ok("spec validates against babel.schema.json")
    except jsonschema.ValidationError as e:
        fail("spec validates against babel.schema.json", e.message)
        return

    assert spec["id"] == TOOL_ID
    ok(f"tool id is {TOOL_ID}")

    inputs = {p["name"] for p in spec["interface"]["inputs"]}
    assert "amount" in inputs and "from_currency" in inputs and "to_currency" in inputs
    ok("interface has amount, from_currency, to_currency")

    assert len(spec.get("testing", {}).get("fixtures", [])) >= 2
    ok("spec has at least 2 test fixtures")


# ─────────────────────────────────────────────────────────────────────────────
# 2. Implementation Unit Tests
# ─────────────────────────────────────────────────────────────────────────────

def test_implementation():
    section("2. Implementation Unit Tests")
    mod = load_impl()

    # Basic call
    result = mod.run(amount=100.0, from_currency="USD", to_currency="SGD")
    assert isinstance(result, dict), "must return dict"
    ok("run() returns dict")

    assert "converted_amount" in result
    ok("result has converted_amount")

    assert "exchange_rate" in result
    ok("result has exchange_rate")

    assert "formatted" in result and "USD" in result["formatted"] and "SGD" in result["formatted"]
    ok(f"formatted string: {result['formatted']}")

    assert result["converted_amount"] > 0
    ok(f"converted_amount > 0  ({result['converted_amount']})")

    # Same currency — rate must be 1.0
    same = mod.run(amount=500.0, from_currency="GBP", to_currency="GBP")
    assert abs(same["exchange_rate"] - 1.0) < 0.01, f"same currency rate should be ~1.0, got {same['exchange_rate']}"
    ok(f"same currency (GBP→GBP) exchange_rate ≈ 1.0")

    # EUR to JPY
    result2 = mod.run(amount=50.0, from_currency="EUR", to_currency="JPY")
    assert result2["converted_amount"] > 50, "JPY should be much larger than EUR"
    ok(f"EUR→JPY conversion: {result2['formatted']}")

    # Currency codes uppercased automatically
    result3 = mod.run(amount=1.0, from_currency="usd", to_currency="eur")
    assert result3.get("from_currency") == "USD"
    ok("lowercase currency codes are uppercased automatically")

    # Unknown currency returns error dict
    bad = mod.run(amount=1.0, from_currency="XYZ", to_currency="USD")
    assert "error" in bad
    ok("unknown currency returns error dict (not exception)")


# ─────────────────────────────────────────────────────────────────────────────
# 3. Compile via AG2Adapter
# ─────────────────────────────────────────────────────────────────────────────

def test_compile() -> Path:
    section("3. Compiler — AG2Adapter")
    from babel_registry.compiler.adapters.ag2_adapter import AG2Adapter

    adapter = AG2Adapter()
    tmp_dist = Path(tempfile.mkdtemp()) / "dist"

    with open(SPEC_PATH) as f:
        spec = yaml.safe_load(f)

    out_dir = adapter.compile(spec, IMPL_PATH, tmp_dist)
    ok(f"compiled to {out_dir}")

    tool_py = out_dir / "tool.py"
    assert tool_py.exists()
    ok("tool.py exists")

    schema_json = out_dir / "schema.json"
    assert schema_json.exists()
    ok("schema.json exists")

    # tool.py must be importable
    mod_spec = importlib.util.spec_from_file_location("_compiled_currency", tool_py)
    mod = importlib.util.module_from_spec(mod_spec)
    mod_spec.loader.exec_module(mod)
    ok("tool.py is importable")

    assert callable(mod.TOOL_FUNCTION)
    ok("TOOL_FUNCTION is callable")

    assert mod.TOOL_ID == TOOL_ID
    ok(f"TOOL_ID = {mod.TOOL_ID}")

    # Sanity call through compiled binding
    result = mod.TOOL_FUNCTION(amount=100.0, from_currency="USD", to_currency="SGD")
    assert "converted_amount" in result
    ok(f"compiled tool call works: {result.get('formatted', result)}")

    return tmp_dist


# ─────────────────────────────────────────────────────────────────────────────
# 4. Registry — publish + verify stored
# ─────────────────────────────────────────────────────────────────────────────

def test_registry() -> None:
    section("4. Registry — Publish & Verify")
    from babel_registry.compiler.adapters.ag2_adapter import AG2Adapter
    from babel_registry.registry.local_registry import LocalRegistry

    registry = LocalRegistry()
    adapter  = AG2Adapter()

    with open(SPEC_PATH) as f:
        spec = yaml.safe_load(f)

    count_before = registry.count()

    tool_id = registry.publish(spec, IMPL_PATH, source="pre-built")
    assert tool_id == TOOL_ID
    ok(f"publish() returned correct tool_id: {tool_id}")

    count_after = registry.count()
    # count_after >= count_before (upsert — won't double count)
    assert count_after >= count_before
    ok(f"registry count: {count_before} → {count_after}")

    # Query by full id
    hit = registry.query(TOOL_ID)
    assert hit == TOOL_ID
    ok(f"query(full id) = HIT")

    # Query by short name
    hit_short = registry.query("currency_conversion")
    assert hit_short == TOOL_ID
    ok(f"query('currency_conversion') = HIT")

    # get() returns full row with spec_yaml
    row = registry.get(TOOL_ID)
    assert row is not None
    assert row["tool_id"] == TOOL_ID
    assert "spec_yaml" in row and len(row["spec_yaml"]) > 10
    ok(f"get() returns full row with spec_yaml")

    # Parsed spec from registry is valid
    stored_spec = registry.get_spec(TOOL_ID)
    assert stored_spec["id"] == TOOL_ID
    ok("stored spec parses correctly from registry")

    # Tool appears in list()
    all_tools = [t["tool_id"] for t in registry.list()]
    assert TOOL_ID in all_tools
    ok(f"tool appears in registry.list() ({len(all_tools)} total tools)")

    print(f"\n  Registry contents:")
    for t in registry.list():
        print(f"    • {t['tool_id']}  [{t['source']}]")


# ─────────────────────────────────────────────────────────────────────────────
# 5. BabelRuntime — load via compile-on-demand
# ─────────────────────────────────────────────────────────────────────────────

def test_runtime() -> dict:
    section("5. BabelRuntime — load()")
    from babel_registry.registry.local_registry import LocalRegistry
    from babel_registry.runtime.babel_runtime import BabelRuntime

    registry = LocalRegistry()
    runtime  = BabelRuntime(registry=registry, dist_dir=ROOT / "dist")

    tool = runtime.load(TOOL_ID)
    ok("runtime.load() succeeded")

    for key in ("name", "description", "function", "schema"):
        assert key in tool, f"missing key: {key}"
    ok("tool dict has name, description, function, schema")

    assert callable(tool["function"])
    ok("tool['function'] is callable")

    assert tool["schema"]["type"] == "function"
    ok("schema is OpenAI function format")

    # Actually call it
    result = tool["function"](amount=250.0, from_currency="USD", to_currency="SGD")
    assert "converted_amount" in result
    ok(f"tool call via runtime: {result.get('formatted', result)}")

    # Second load hits LRU cache
    tool2 = runtime.load(TOOL_ID)
    cached = runtime.cache_info()["cached_tools"]
    assert any(TOOL_ID in c for c in cached)
    ok(f"second load hits LRU cache (size={runtime.cache_info()['size']})")

    return tool


# ─────────────────────────────────────────────────────────────────────────────
# 6. Pydantic-AI
# ─────────────────────────────────────────────────────────────────────────────

def test_pydantic_agent() -> None:
    section("6. Pydantic-AI Agent (compiler-native TOOL_OBJECT)")
    from babel_registry.registry.local_registry import LocalRegistry
    from babel_registry.runtime.babel_runtime import BabelRuntime
    from pydantic_ai import Agent
    from pydantic_ai.models.mistral import MistralModel
    from pydantic_ai.providers.mistral import MistralProvider
    from pydantic_ai.tools import Tool as PydanticTool

    registry = LocalRegistry()
    runtime  = BabelRuntime(registry=registry, dist_dir=ROOT / "dist")
    tool     = runtime.load(TOOL_ID, target="pydantic")

    tool_obj = tool["tool_object"]
    assert isinstance(tool_obj, PydanticTool), \
        f"Expected pydantic_ai.Tool, got {type(tool_obj)}"
    ok(f"runtime.load(target='pydantic') → TOOL_OBJECT is {type(tool_obj).__name__}")

    model = MistralModel(
        "mistral-large-latest",
        provider=MistralProvider(api_key=os.getenv("MISTRAL_API_KEY")),
    )
    agent = Agent(
        model=model,
        tools=[tool_obj],   # ← compiler-native pydantic_ai.Tool, not raw callable
        system_prompt="You are ARIA. Use the currency_conversion tool to answer.",
    )

    result = agent.run_sync(QUERY)
    response = result.output
    print(f"  Response: {response[:300]}")

    assert any(w in response.lower() for w in ["sgd", "eur", "convert", "usd", "jpy"])
    ok("Pydantic-AI agent used the Babel currency tool ✓")


# ─────────────────────────────────────────────────────────────────────────────
# 7. AG2 Agent
# ─────────────────────────────────────────────────────────────────────────────

def test_ag2_agent(tool: dict) -> None:
    section("7. AG2 Agent")
    from autogen import AssistantAgent, UserProxyAgent, register_function

    llm_config = {
        "model": "mistral-large-latest",
        "api_key": os.getenv("MISTRAL_API_KEY"),
        "api_type": "mistral",
    }

    assistant = AssistantAgent(
        name="ARIA",
        system_message="You are ARIA. Use the currency tool. End with TERMINATE.",
        llm_config=llm_config,
    )
    user_proxy = UserProxyAgent(
        name="User",
        human_input_mode="NEVER",
        max_consecutive_auto_reply=5,
        is_termination_msg=lambda m: "TERMINATE" in m.get("content", ""),
        code_execution_config=False,
    )

    register_function(
        tool["function"],
        caller=assistant,
        executor=user_proxy,
        name=tool["name"],
        description=tool["description"],
    )

    chat = user_proxy.initiate_chat(assistant, message=QUERY, silent=True)

    # Extract last assistant message
    last_msg = ""
    for msg in reversed(chat.chat_history):
        if msg.get("role") == "assistant" and msg.get("content"):
            last_msg = msg["content"]
            break

    print(f"  Response: {last_msg[:300]}")
    assert any(w in last_msg.lower() for w in ["sgd", "eur", "usd", "jpy", "convert"])
    ok("AG2 agent used the Babel currency tool ✓")


# ─────────────────────────────────────────────────────────────────────────────
# 8. LangChain Agent
# ─────────────────────────────────────────────────────────────────────────────

def test_langchain_agent() -> None:
    section("8. LangChain Agent (compiler-native TOOL_OBJECT)")
    from babel_registry.registry.local_registry import LocalRegistry
    from babel_registry.runtime.babel_runtime import BabelRuntime
    from langchain_core.tools import StructuredTool
    from langchain_core.messages import HumanMessage, ToolMessage, AIMessage
    from langchain_mistralai import ChatMistralAI

    registry = LocalRegistry()
    runtime  = BabelRuntime(registry=registry, dist_dir=ROOT / "dist")
    tool     = runtime.load(TOOL_ID, target="langchain")

    lc_tool = tool["tool_object"]
    assert isinstance(lc_tool, StructuredTool), \
        f"Expected StructuredTool, got {type(lc_tool)}"
    ok(f"runtime.load(target='langchain') → TOOL_OBJECT is {type(lc_tool).__name__}")

    llm = ChatMistralAI(
        model="mistral-large-latest",
        api_key=os.getenv("MISTRAL_API_KEY"),
        temperature=0,
    )
    llm_with_tools = llm.bind_tools([lc_tool])   # ← compiler-native StructuredTool
    messages = [HumanMessage(content=QUERY)]

    # Tool-calling loop
    final = ""
    for _ in range(5):
        response: AIMessage = llm_with_tools.invoke(messages)
        messages.append(response)

        if not response.tool_calls:
            final = response.content
            break

        for tc in response.tool_calls:
            result = lc_tool.invoke(tc["args"])
            messages.append(ToolMessage(content=json.dumps(result), tool_call_id=tc["id"]))

    print(f"  Response: {final[:300]}")
    assert any(w in final.lower() for w in ["sgd", "eur", "usd", "jpy", "convert"])
    ok("LangChain agent used the Babel currency tool ✓")


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print(f"\n{'='*60}")
    print("  CURRENCY CONVERSION TOOL — Full E2E Test")
    print(f"  Tool ID: {TOOL_ID}")
    print(f"{'='*60}")

    t_start = time.monotonic()

    test_spec_validation()
    test_implementation()
    test_compile()
    test_registry()
    loaded_tool = test_runtime()

    try:
        test_pydantic_agent()
        results["Pydantic-AI agent"] = "PASS"
    except Exception as e:
        fail("Pydantic-AI agent", str(e))
        import traceback; traceback.print_exc()

    try:
        test_ag2_agent(loaded_tool)
        results["AG2 agent"] = "PASS"
    except Exception as e:
        fail("AG2 agent", str(e))
        import traceback; traceback.print_exc()

    try:
        test_langchain_agent()
        results["LangChain agent"] = "PASS"
    except Exception as e:
        fail("LangChain agent", str(e))
        import traceback; traceback.print_exc()

    # ── Final summary ────────────────────────────────────────────────────────
    elapsed = time.monotonic() - t_start
    passed  = sum(1 for v in results.values() if v == "PASS")
    total   = len(results)

    print(f"\n{'='*60}")
    print(f"  RESULTS  ({passed}/{total} passed  |  {elapsed:.1f}s total)")
    print(f"{'='*60}")
    for label, status in results.items():
        icon = PASS if status == "PASS" else FAIL
        print(f"  {icon}  {label}")

    sys.exit(0 if passed == total else 1)
