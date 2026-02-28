"""
aria/__init__.py
────────────────
ARIA — Adaptive Runtime Intelligence Architecture

Phase 2: ARIAPlanner   — user request → task graph JSON via Mistral
Phase 4: ARIAGraphFlow — task graph → AG2 multi-agent execution
"""

from .planner import ARIAPlanner
from .graph_flow import ARIAGraphFlow

__all__ = ["ARIAPlanner", "ARIAGraphFlow"]
