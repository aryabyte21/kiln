"""
demo_loader.py
──────────────
End-to-end test of the Phase 1 spec-first Babel layer.

Shows the complete lifecycle:
  1. Validate a spec.yaml against the JSON Schema
  2. Run test fixtures before registration (what Vibe does before publishing)
  3. Load the tool from disk into the SQLite registry
  4. Confirm it is reachable via BabelRuntime
  5. Call it through the Mistral adapter — same result as a @babel_tool tool

Usage:
    export MISTRAL_API_KEY=your_key_here
    cd /Users/shekharsomani/Desktop/projects/babel
    conda run -n shekhar python demo_loader.py
"""

import os
import sys
import json

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "babel"))

from babel import BabelLoader, BabelRuntime, get_global_registry
from mistralai import Mistral

REGISTRY_DIR = os.path.join(os.path.dirname(__file__), "registry", "tools")
MODEL        = "mistral-large-latest"

CYAN    = "\033[96m"
GREEN   = "\033[92m"
YELLOW  = "\033[93m"
MAGENTA = "\033[95m"
RED     = "\033[91m"
BOLD    = "\033[1m"
RESET   = "\033[0m"


def _p(colour: str, text: str) -> None:
    print(f"{colour}{text}{RESET}")


# ─────────────────────────────────────────────────────────────────────────────
# Step 1 — Run test fixtures (what Vibe does before publishing)
# ─────────────────────────────────────────────────────────────────────────────

def show_test_results(loader: BabelLoader, tool_dir: str, tool_name: str) -> None:
    _p(BOLD, f"\n── Test fixtures: {tool_name} {'─' * (40 - len(tool_name))}")
    report = loader.test(tool_dir)

    for r in report["results"]:
        status = f"{GREEN}PASS{RESET}" if r["passed"] else f"{RED}FAIL{RESET}"
        err    = f"  → {r['error']}" if r["error"] else ""
        print(f"  Fixture {r['fixture']}: {status}{err}")

    summary_colour = GREEN if report["failed"] == 0 else RED
    _p(summary_colour, f"  {report['passed']}/{report['passed'] + report['failed']} fixtures passed")


# ─────────────────────────────────────────────────────────────────────────────
# Step 2 — Validate schema (show what a bad spec looks like)
# ─────────────────────────────────────────────────────────────────────────────

def show_schema_validation(loader: BabelLoader) -> None:
    import jsonschema, yaml

    _p(BOLD, "\n── Schema validation demo ───────────────────────────────")

    bad_spec = {
        "babel_version": "1.0",
        "tool": {
            "id": "INVALID ID WITH SPACES",   # ← violates pattern
            "name": "my_tool",
            "version": "1.0.0",
            "description": "Too short",        # ← minLength 10 violation
        },
        "interface": {"inputs": [], "outputs": []},
        "implementation": {"runtime": "python3.10", "entrypoint": "tool.py"},
    }

    try:
        jsonschema.validate(instance=bad_spec, schema=loader._schema)
        _p(RED, "  No error raised — schema too permissive!")
    except jsonschema.ValidationError as exc:
        _p(GREEN, f"  Schema correctly rejected bad spec:")
        _p(YELLOW, f"  {exc.message}")


# ─────────────────────────────────────────────────────────────────────────────
# Step 3 — Call the loaded tool through the Mistral adapter
# ─────────────────────────────────────────────────────────────────────────────

def call_via_mistral(tool_id: str, query: str, client: Mistral, registry) -> None:
    _p(MAGENTA, f"\n  [Mistral ← {tool_id}]")

    runtime  = BabelRuntime(target="mistral", registry=registry)
    compiled = runtime.get(tool_id)
    tool_map = {compiled.name: compiled}

    messages = [{"role": "user", "content": query}]

    while True:
        response = client.chat.complete(
            model=MODEL,
            messages=messages,
            tools=[compiled.tool_def],
            tool_choice="auto",
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
# Main
# ─────────────────────────────────────────────────────────────────────────────

def main() -> None:
    api_key = os.environ.get("MISTRAL_API_KEY", "").strip()
    if not api_key:
        print("Error: MISTRAL_API_KEY not set.")
        sys.exit(1)

    client  = Mistral(api_key=api_key)
    loader  = BabelLoader(auto_register=True)
    registry = get_global_registry()

    _p(BOLD, f"\n{'═' * 62}")
    _p(BOLD,  "  Babel Phase 1 — Spec-First Loader Demo")
    _p(BOLD, f"{'═' * 62}")

    # ── Schema validation ─────────────────────────────────────────────────
    show_schema_validation(loader)

    # ── Tool 1: weather ───────────────────────────────────────────────────
    weather_dir = os.path.join(REGISTRY_DIR, "com.aria.tools.weather", "1.0.0")

    _p(BOLD, "\n── Loading: com.aria.tools.weather ──────────────────────")
    show_test_results(loader, weather_dir, "weather")

    _p(CYAN,  f"\n  Registry before load: {len(registry)} tools")
    loader.load(weather_dir)
    _p(CYAN,  f"  Registry after load:  {len(registry)} tools")

    # Inspect the spec that was loaded from YAML
    spec = registry.get("com.aria.tools.weather").spec
    _p(CYAN, f"  Spec source:  spec.yaml → BabelToolSpec")
    _p(CYAN, f"  ID:           {spec.id}")
    _p(CYAN, f"  Params:       {[p.name for p in spec.params]}")
    _p(CYAN, f"  Required:     {[p.name for p in spec.params if p.required]}")
    _p(CYAN, f"  Optional:     {[p.name for p in spec.params if not p.required]}")

    call_via_mistral(
        "com.aria.tools.weather",
        "What is the weather in Singapore right now?",
        client, registry,
    )

    # ── Tool 2: currency_convert ──────────────────────────────────────────
    currency_dir = os.path.join(REGISTRY_DIR, "com.aria.tools.currency_convert", "1.0.0")

    _p(BOLD, "\n── Loading: com.aria.tools.currency_convert ─────────────")
    show_test_results(loader, currency_dir, "currency_convert")

    loader.load(currency_dir)
    _p(CYAN, f"  Registry now has: {len(registry)} tools")

    call_via_mistral(
        "com.aria.tools.currency_convert",
        "How much is 500 SGD in EUR? Include the rate.",
        client, registry,
    )

    # ── load_all demo ─────────────────────────────────────────────────────
    _p(BOLD, "\n── load_all() — scan and load entire registry dir ───────")

    fresh_loader = BabelLoader(auto_register=False)   # don't re-register
    tools = fresh_loader.load_all(REGISTRY_DIR)
    _p(CYAN, f"  Found {len(tools)} tools in {REGISTRY_DIR}")
    for t in tools:
        _p(CYAN, f"    {t.spec.id:<45} v{t.spec.version}")

    _p(BOLD, f"\n{'═' * 62}")
    _p(GREEN, "  Phase 1 complete. spec.yaml → validate → test → register → adapt")
    _p(BOLD, f"{'═' * 62}\n")


if __name__ == "__main__":
    main()
