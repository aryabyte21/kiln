"""End-to-end test for the Interpreter → Planner pipeline.

Runs a set of test requests through both agents and saves each stage's
output as JSON files in the tmp/ directory.
"""

import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

from babel.agents import InterpreterAgent, PlannerAgent

TMP_DIR = Path(__file__).parent / "tmp"
TMP_DIR.mkdir(exist_ok=True)

TEST_REQUESTS = [
    "Book a table for two at an Italian restaurant tonight at 7pm near Orchard Road and send a WhatsApp to Sarah about it",
    "What's the weather like tomorrow in Singapore? Also find me directions from Changi Airport to Marina Bay Sands",
    "Schedule a meeting with David next Tuesday at 3pm and email him the invite",
]


def run_test(request: str, index: int) -> bool:
    """Run a single request through Interpreter → Planner and save outputs."""
    prefix = f"test_{index + 1}"
    print(f"\n{'=' * 60}")
    print(f"TEST {index + 1}: {request[:70]}...")
    print("=" * 60)

    # --- Interpreter ---
    print("\n[1/2] Running Interpreter...")
    try:
        interpreter = InterpreterAgent()
        intent = interpreter.run(request)
    except Exception as e:
        print(f"  FAIL — Interpreter error: {e}")
        return False

    intent_path = TMP_DIR / f"{prefix}_intent.json"
    intent_path.write_text(json.dumps(intent, indent=2))
    print(f"  OK — intent saved to {intent_path.relative_to(Path.cwd())}")
    print(f"  Goal: {intent.get('goal', 'N/A')}")
    print(f"  Entities: {len(intent.get('entities', []))}")
    print(f"  Constraints: {intent.get('constraints', [])}")
    print(f"  Dependencies: {len(intent.get('dependencies', []))}")

    # --- Planner ---
    print("\n[2/2] Running Planner...")
    try:
        planner = PlannerAgent()
        graph = planner.run(intent)
    except Exception as e:
        print(f"  FAIL — Planner error: {e}")
        return False

    graph_path = TMP_DIR / f"{prefix}_graph.json"
    graph_path.write_text(json.dumps(graph, indent=2))
    print(f"  OK — graph saved to {graph_path.relative_to(Path.cwd())}")
    print(f"  Nodes: {len(graph.get('nodes', []))}")
    print(f"  Edges: {len(graph.get('edges', []))}")
    print(f"  Gaps:  {len(graph.get('gaps', []))}")

    if graph.get("gaps"):
        for gap in graph["gaps"]:
            print(f"    gap: {gap['tool']} — {gap.get('description', '')[:60]}")

    return True


def main():
    passed = 0
    failed = 0

    for i, request in enumerate(TEST_REQUESTS):
        if run_test(request, i):
            passed += 1
        else:
            failed += 1

    print(f"\n{'=' * 60}")
    print(f"RESULTS: {passed} passed, {failed} failed out of {len(TEST_REQUESTS)}")
    print(f"Outputs saved in: {TMP_DIR.relative_to(Path.cwd())}/")
    print("=" * 60)

    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
