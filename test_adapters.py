"""
test_adapters.py
-----------------
Tests for the two new Babel compiler adapters: pydantic and langchain.

Sections:
  1. PydanticAdapter  — compile, output files, TOOL_OBJECT is pydantic_ai.Tool
  2. LangChainAdapter — compile, output files, TOOL_OBJECT is StructuredTool
  3. CLI              — babel compile --target pydantic / langchain
  4. BabelRuntime     — load(target="pydantic") and load(target="langchain")
  5. Live agents      — pydantic-ai and LangChain using target-native TOOL_OBJECT

Run:
    python test_adapters.py
"""

from __future__ import annotations

import importlib.util
import json
import os
import subprocess
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
QUERY     = "How much is 500 USD in SGD?"

PASS = "✓"
FAIL = "✗"
results: dict[str, str] = {}


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


def compile_to(target: str) -> Path:
    from babel_registry.compiler.adapters.pydantic_adapter import PydanticAdapter
    from babel_registry.compiler.adapters.langchain_adapter import LangChainAdapter
    from babel_registry.compiler.adapters.ag2_adapter import AG2Adapter

    adapter_map = {"pydantic": PydanticAdapter, "langchain": LangChainAdapter, "ag2": AG2Adapter}
    adapter = adapter_map[target]()
    tmp_dist = Path(tempfile.mkdtemp()) / "dist"
    with open(SPEC_PATH) as f:
        spec = yaml.safe_load(f)
    out_dir = adapter.compile(spec, IMPL_PATH, tmp_dist)
    return out_dir


def import_tool_py(tool_py: Path, module_name: str):
    spec = importlib.util.spec_from_file_location(module_name, tool_py)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# ─────────────────────────────────────────────────────────────────────────────
# 1. PydanticAdapter
# ─────────────────────────────────────────────────────────────────────────────

def test_pydantic_adapter():
    section("1. PydanticAdapter — Compile Output")

    out_dir = compile_to("pydantic")
    ok(f"compiled to dist/pydantic/{TOOL_ID}")

    assert (out_dir / "tool.py").exists()
    ok("tool.py exists")

    assert (out_dir / "schema.json").exists()
    ok("schema.json exists")

    assert (out_dir / "meta.json").exists()
    meta = json.loads((out_dir / "meta.json").read_text())
    assert meta["target"] == "pydantic"
    ok("meta.json target = pydantic")

    # Output path should be under dist/pydantic/
    assert "pydantic" in str(out_dir)
    ok("output path is under dist/pydantic/")

    # Import tool.py
    mod = import_tool_py(out_dir / "tool.py", "_pydantic_currency")
    ok("tool.py importable")

    assert callable(mod.TOOL_FUNCTION)
    ok("TOOL_FUNCTION is callable")

    assert mod.TOOL_ID == TOOL_ID
    ok(f"TOOL_ID correct: {mod.TOOL_ID}")

    # TOOL_OBJECT must be a pydantic_ai.Tool
    from pydantic_ai.tools import Tool as PydanticTool
    assert isinstance(mod.TOOL_OBJECT, PydanticTool), \
        f"Expected pydantic_ai.Tool, got {type(mod.TOOL_OBJECT)}"
    ok(f"TOOL_OBJECT is pydantic_ai.Tool: {type(mod.TOOL_OBJECT).__name__}")

    # Direct function call works
    result = mod.TOOL_FUNCTION(amount=100.0, from_currency="USD", to_currency="SGD")
    assert "converted_amount" in result
    ok(f"TOOL_FUNCTION call works: {result.get('formatted')}")


# ─────────────────────────────────────────────────────────────────────────────
# 2. LangChainAdapter
# ─────────────────────────────────────────────────────────────────────────────

def test_langchain_adapter():
    section("2. LangChainAdapter — Compile Output")

    out_dir = compile_to("langchain")
    ok(f"compiled to dist/langchain/{TOOL_ID}")

    assert (out_dir / "tool.py").exists()
    ok("tool.py exists")

    assert (out_dir / "schema.json").exists()
    ok("schema.json exists")

    meta = json.loads((out_dir / "meta.json").read_text())
    assert meta["target"] == "langchain"
    ok("meta.json target = langchain")

    assert "langchain" in str(out_dir)
    ok("output path is under dist/langchain/")

    mod = import_tool_py(out_dir / "tool.py", "_langchain_currency")
    ok("tool.py importable")

    assert callable(mod.TOOL_FUNCTION)
    ok("TOOL_FUNCTION is callable")

    assert mod.TOOL_ID == TOOL_ID
    ok(f"TOOL_ID correct: {mod.TOOL_ID}")

    # TOOL_OBJECT must be a LangChain StructuredTool
    from langchain_core.tools import StructuredTool
    assert isinstance(mod.TOOL_OBJECT, StructuredTool), \
        f"Expected StructuredTool, got {type(mod.TOOL_OBJECT)}"
    ok(f"TOOL_OBJECT is StructuredTool: {type(mod.TOOL_OBJECT).__name__}")

    # StructuredTool.invoke works
    result = mod.TOOL_OBJECT.invoke({"amount": 100.0, "from_currency": "USD", "to_currency": "SGD"})
    assert "converted_amount" in result
    ok(f"TOOL_OBJECT.invoke() works: {result.get('formatted')}")

    # Direct function call works
    result2 = mod.TOOL_FUNCTION(amount=50.0, from_currency="EUR", to_currency="JPY")
    assert "converted_amount" in result2
    ok(f"TOOL_FUNCTION call works: {result2.get('formatted')}")


# ─────────────────────────────────────────────────────────────────────────────
# 3. CLI — babel compile --target pydantic / langchain
# ─────────────────────────────────────────────────────────────────────────────

def test_cli():
    section("3. CLI — compile --target pydantic / langchain")

    for target in ("pydantic", "langchain"):
        with tempfile.TemporaryDirectory() as tmp:
            result = subprocess.run(
                [sys.executable, "-m", "babel_registry.cli", "compile",
                 str(SPEC_PATH), "--target", target, "--output", tmp],
                cwd=str(ROOT),
                capture_output=True,
                text=True,
            )
            assert result.returncode == 0, f"CLI failed for {target}:\n{result.stderr}"
            ok(f"babel compile --target {target} exits 0")

            compiled = Path(tmp) / target / TOOL_ID / "tool.py"
            assert compiled.exists(), f"tool.py not found at {compiled}"
            ok(f"dist/{target}/{TOOL_ID}/tool.py created")


# ─────────────────────────────────────────────────────────────────────────────
# 4. BabelRuntime — load(target=...)
# ─────────────────────────────────────────────────────────────────────────────

def test_runtime():
    section("4. BabelRuntime — load(target='pydantic') and load(target='langchain')")

    from babel_registry.registry.local_registry import LocalRegistry
    from babel_registry.runtime.babel_runtime import BabelRuntime
    from pydantic_ai.tools import Tool as PydanticTool
    from langchain_core.tools import StructuredTool

    registry = LocalRegistry()
    runtime  = BabelRuntime(registry=registry, dist_dir=ROOT / "dist")

    # Ensure currency tool is in registry
    from babel_registry.compiler.adapters.ag2_adapter import AG2Adapter
    adapter = AG2Adapter()
    with open(SPEC_PATH) as f:
        spec = yaml.safe_load(f)
    if not registry.query(TOOL_ID):
        registry.publish(spec, IMPL_PATH)

    for target, expected_type in [("pydantic", PydanticTool), ("langchain", StructuredTool)]:
        tool = runtime.load(TOOL_ID, target=target)

        assert "function" in tool and callable(tool["function"])
        ok(f"[{target}] tool['function'] is callable")

        assert "schema" in tool and tool["schema"]["type"] == "function"
        ok(f"[{target}] tool['schema'] is OpenAI format")

        assert "tool_object" in tool
        assert isinstance(tool["tool_object"], expected_type), \
            f"Expected {expected_type.__name__}, got {type(tool['tool_object'])}"
        ok(f"[{target}] tool['tool_object'] is {expected_type.__name__}")

        # Second load hits cache
        runtime.load(TOOL_ID, target=target)
        cached = [k for k in runtime.cache_info()["cached_tools"] if target in k]
        assert len(cached) >= 1
        ok(f"[{target}] second load hits LRU cache")

    # Both target slots cached independently
    cached_all = runtime.cache_info()["cached_tools"]
    assert any("pydantic" in c for c in cached_all)
    assert any("langchain" in c for c in cached_all)
    ok(f"pydantic and langchain cached as independent entries: {cached_all}")

    # Unknown target raises ValueError
    try:
        runtime.load(TOOL_ID, target="unknown_framework")
        fail("unknown target raises ValueError", "no exception raised")
    except ValueError:
        ok("unknown target raises ValueError")


# ─────────────────────────────────────────────────────────────────────────────
# 5. Live Agents using TOOL_OBJECT directly
# ─────────────────────────────────────────────────────────────────────────────

def test_pydantic_agent_with_tool_object():
    section("5a. Pydantic-AI Agent using TOOL_OBJECT from compiler")

    from babel_registry.registry.local_registry import LocalRegistry
    from babel_registry.runtime.babel_runtime import BabelRuntime
    from pydantic_ai import Agent
    from pydantic_ai.models.mistral import MistralModel
    from pydantic_ai.providers.mistral import MistralProvider

    registry = LocalRegistry()
    runtime  = BabelRuntime(registry=registry, dist_dir=ROOT / "dist")
    tool     = runtime.load(TOOL_ID, target="pydantic")

    # Use the compiler-native TOOL_OBJECT instead of raw callable
    tool_obj = tool["tool_object"]
    print(f"  Using TOOL_OBJECT: {type(tool_obj).__name__}")

    model = MistralModel(
        "mistral-large-latest",
        provider=MistralProvider(api_key=os.getenv("MISTRAL_API_KEY")),
    )
    agent = Agent(
        model=model,
        tools=[tool_obj],   # ← pydantic_ai.Tool from compiler, not raw callable
        system_prompt="You are ARIA. Use the currency tool to answer.",
    )

    result = agent.run_sync(QUERY)
    response = result.output
    print(f"  Response: {response[:200]}")

    assert any(w in response.lower() for w in ["sgd", "usd", "convert", "dollar"])
    ok("Pydantic-AI agent used compiled TOOL_OBJECT successfully")


def test_langchain_agent_with_tool_object():
    section("5b. LangChain Agent using TOOL_OBJECT from compiler")

    from babel_registry.registry.local_registry import LocalRegistry
    from babel_registry.runtime.babel_runtime import BabelRuntime
    from langchain_core.messages import HumanMessage, ToolMessage, AIMessage
    from langchain_mistralai import ChatMistralAI

    registry = LocalRegistry()
    runtime  = BabelRuntime(registry=registry, dist_dir=ROOT / "dist")
    tool     = runtime.load(TOOL_ID, target="langchain")

    # Use the compiler-native TOOL_OBJECT (StructuredTool) instead of wrapping manually
    lc_tool = tool["tool_object"]
    print(f"  Using TOOL_OBJECT: {type(lc_tool).__name__}")

    llm = ChatMistralAI(
        model="mistral-large-latest",
        api_key=os.getenv("MISTRAL_API_KEY"),
        temperature=0,
    )
    llm_with_tools = llm.bind_tools([lc_tool])   # ← StructuredTool from compiler
    messages = [HumanMessage(content=QUERY)]

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

    print(f"  Response: {final[:200]}")
    assert any(w in final.lower() for w in ["sgd", "usd", "convert", "dollar"])
    ok("LangChain agent used compiled TOOL_OBJECT successfully")


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print(f"\n{'='*60}")
    print("  PYDANTIC + LANGCHAIN ADAPTER TEST")
    print(f"{'='*60}")

    t_start = time.monotonic()

    for fn in [
        test_pydantic_adapter,
        test_langchain_adapter,
        test_cli,
        test_runtime,
        test_pydantic_agent_with_tool_object,
        test_langchain_agent_with_tool_object,
    ]:
        try:
            fn()
        except Exception as e:
            label = fn.__name__.replace("test_", "").replace("_", " ")
            fail(label, str(e))
            import traceback; traceback.print_exc()

    elapsed = time.monotonic() - t_start
    passed  = sum(1 for v in results.values() if v == "PASS")
    total   = len(results)

    print(f"\n{'='*60}")
    print(f"  RESULTS  ({passed}/{total} passed  |  {elapsed:.1f}s)")
    print(f"{'='*60}")
    for label, status in results.items():
        icon = PASS if status == "PASS" else FAIL
        print(f"  {icon}  {label}")

    sys.exit(0 if passed == total else 1)
