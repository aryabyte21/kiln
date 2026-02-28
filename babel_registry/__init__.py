"""
babel/__init__.py
─────────────────
Public API surface for the Babel package.

Import from here in all user-facing code:

    from babel import babel_tool, register, BabelRegistry, BabelRuntime
"""

from .spec import babel_tool, BabelTool, BabelToolSpec, ToolParam, ToolReturn
from .registry import BabelRegistry, register, get_global_registry
from .sqlite_registry import SQLiteRegistry
from .runtime import BabelRuntime
from .loader import BabelLoader

__all__ = [
    # Decorator (hand-written tools)
    "babel_tool",
    # Data classes
    "BabelTool",
    "BabelToolSpec",
    "ToolParam",
    "ToolReturn",
    # Registry
    "BabelRegistry",
    "SQLiteRegistry",
    "register",
    "get_global_registry",
    # Runtime
    "BabelRuntime",
    # Spec-first loader (Vibe-synthesised tools)
    "BabelLoader",
]
