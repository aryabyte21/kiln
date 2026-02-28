"""
Babel — ARIA's universal tool packaging standard.

E2 owns this entire package.

Sub-packages:
  babel.spec       — JSON Schema validator + sample specs
  babel.compiler   — Compile specs into AG2 / raw Python bindings
  babel.runtime    — Load compiled tools with LRU cache
  babel.registry   — SQLite-backed tool registry
  babel.cli        — CLI: compile, publish, install, registry list
"""

__version__ = "1.0.0"
