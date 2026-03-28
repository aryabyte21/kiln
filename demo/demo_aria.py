"""
demo_aria.py
────────────
End-to-end ARIA Phase 2 + Phase 4 demo.

Flow:
  1. Start BabelServer (must be running — see run_server.py)
  2. ARIAPlanner (Phase 2) — user request → task graph via Mistral
  3. ARIAGraphFlow (Phase 4) — task graph → AG2 multi-agent execution
  4. Print final synthesised answer

Usage:
    # Terminal 1 — start BabelServer
    conda run -n shekhar python run_server.py

    # Terminal 2 — run demo
    export MISTRAL_API_KEY=your_key_here
    conda run -n shekhar python demo_aria.py
"""

import os
import sys
import json

sys.path.insert(0, os.path.dirname(__file__))

from aria import ARIAPlanner, ARIAGraphFlow

BABEL_SERVER   = "http://localhost:8765"
MODEL          = "mistral-large-latest"

CYAN    = "\033[96m"
GREEN   = "\033[92m"
YELLOW  = "\033[93m"
MAGENTA = "\033[95m"
BOLD    = "\033[1m"
RED     = "\033[91m"
RESET   = "\033[0m"


def _p(colour: str, text: str) -> None:
    print(f"{colour}{text}{RESET}")


def run_scenario(scenario: str, planner: ARIAPlanner, flow: ARIAGraphFlow) -> None:
    _p(BOLD, f"\n{'═' * 62}")
    _p(CYAN,  f"  USER REQUEST: {scenario}")
    _p(BOLD, f"{'═' * 62}")

    # ── Phase 2: Plan ─────────────────────────────────────────────────────────
    _p(YELLOW, "\n  Phase 2: Planning task graph...")
    task_graph = planner.plan(scenario)

    _p(GREEN, f"  Nodes:         {[n['id'] for n in task_graph['nodes']]}")
    _p(GREEN, f"  Edges:         {task_graph.get('edges', [])}")
    _p(GREEN, f"  Entry:         {task_graph.get('entry_nodes', [])}")
    _p(GREEN, f"  Exit:          {task_graph.get('exit_node', '?')}")

    if task_graph.get("missing_tools"):
        _p(RED, f"  Missing tools: {task_graph['missing_tools']}")
        _p(RED,  "  (Would trigger Vibe synthesis in Phase 3)")

    # ── Phase 4: Execute ──────────────────────────────────────────────────────
    _p(YELLOW, "\n  Phase 4: Executing graph with AG2...")
    final_answer = flow.run(task_graph, verbose=True)

    _p(BOLD,  f"\n{'─' * 62}")
    _p(MAGENTA, "  FINAL ANSWER:")
    _p(GREEN,   f"  {final_answer}")
    _p(BOLD,  f"{'─' * 62}")


def main() -> None:
    api_key = os.environ.get("MISTRAL_API_KEY", "").strip()
    if not api_key:
        print("Error: MISTRAL_API_KEY not set.")
        sys.exit(1)

    # ── Check BabelServer is up ────────────────────────────────────────────────
    import requests
    try:
        health = requests.get(f"{BABEL_SERVER}/health", timeout=3).json()
        _p(GREEN, f"\n  BabelServer: OK — {health['tool_count']} tools registered")
    except Exception:
        _p(RED, f"\n  BabelServer not running at {BABEL_SERVER}")
        _p(RED,  "  Start it with: conda run -n shekhar python run_server.py")
        sys.exit(1)

    llm_config = {
        "config_list": [
            {
                "model":    MODEL,
                "api_key":  api_key,
                "api_type": "mistral",
            }
        ],
        "cache_seed": None,
    }

    planner = ARIAPlanner(
        babel_server_url=BABEL_SERVER,
        api_key=api_key,
        model=MODEL,
    )
    flow = ARIAGraphFlow(
        babel_server_url=BABEL_SERVER,
        llm_config=llm_config,
    )

    # ── Scenarios ──────────────────────────────────────────────────────────────

    # Scenario 1: Two parallel tasks → one summary
    run_scenario(
        "What is the weather in Singapore right now, and how much is 500 SGD in EUR? "
        "Give me a combined summary.",
        planner,
        flow,
    )

    # Scenario 2: Sequential dependency
    run_scenario(
        "Convert 1000 USD to SGD, then tell me the weather in Singapore. "
        "Summarise both results together.",
        planner,
        flow,
    )


if __name__ == "__main__":
    main()
