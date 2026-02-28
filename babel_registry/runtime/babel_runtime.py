"""
babel.runtime.babel_runtime
-----------------------------
BabelRuntime: compile-on-demand + LRU cache for tool loading.

Supports all four Babel targets:
    "ag2"        → AG2Adapter        → TOOL_FUNCTION + TOOL_SCHEMA
    "raw_python" → RawPythonAdapter  → TOOL_FUNCTION
    "pydantic"   → PydanticAdapter   → TOOL_FUNCTION + TOOL_OBJECT (pydantic_ai.Tool)
    "langchain"  → LangChainAdapter  → TOOL_FUNCTION + TOOL_OBJECT (StructuredTool)

Public API:

    runtime = BabelRuntime()

    # AG2 (default)
    tool = runtime.load("com.aria.tools.weather")
    # {"name", "description", "function", "schema", "tool_id"}

    # Pydantic-AI — includes tool_object ready for Agent(tools=[...])
    tool = runtime.load("com.aria.tools.weather", target="pydantic")
    # {"name", "description", "function", "schema", "tool_id", "tool_object"}

    # LangChain — includes tool_object ready for llm.bind_tools([...])
    tool = runtime.load("com.aria.tools.weather", target="langchain")
    # {"name", "description", "function", "schema", "tool_id", "tool_object"}

Cache is keyed by (tool_id, target) so each framework gets its own entry.
"""

from __future__ import annotations

import importlib.util
import logging
import time
from collections import OrderedDict
from pathlib import Path
from typing import Any, Callable, Optional

import yaml

from babel_registry.compiler.adapters.ag2_adapter import AG2Adapter
from babel_registry.compiler.adapters.raw_python_adapter import RawPythonAdapter
from babel_registry.compiler.adapters.pydantic_adapter import PydanticAdapter
from babel_registry.compiler.adapters.langchain_adapter import LangChainAdapter
from babel_registry.compiler.base import BabelAdapter
from babel_registry.registry.local_registry import LocalRegistry

logger = logging.getLogger(__name__)

_DEFAULT_DIST_DIR = Path(__file__).parent.parent.parent / "dist"
_CACHE_MAX_SIZE = 64

_ADAPTER_MAP: dict[str, type[BabelAdapter]] = {
    "ag2":        AG2Adapter,
    "raw_python":  RawPythonAdapter,
    "pydantic":   PydanticAdapter,
    "langchain":  LangChainAdapter,
}


class BabelRuntime:
    """Compile-on-demand tool loader with in-memory LRU cache.

    Args:
        registry:   LocalRegistry instance (default: new instance at default db path).
        dist_dir:   Root directory for compiled tool artifacts.
        cache_size: Max number of (tool_id, target) entries to hold in memory.
    """

    def __init__(
        self,
        registry: Optional[LocalRegistry] = None,
        dist_dir: Path = _DEFAULT_DIST_DIR,
        cache_size: int = _CACHE_MAX_SIZE,
    ) -> None:
        self.registry = registry or LocalRegistry()
        self.dist_dir = Path(dist_dir)
        self.dist_dir.mkdir(parents=True, exist_ok=True)
        self._cache: OrderedDict[tuple[str, str], dict[str, Any]] = OrderedDict()
        self._cache_size = cache_size

    # ------------------------------------------------------------------
    # Core public API
    # ------------------------------------------------------------------

    def load(self, tool_id: str, target: str = "ag2") -> dict[str, Any]:
        """Load a compiled tool object for the specified framework target.

        Args:
            tool_id: Full tool ID (e.g. "com.aria.tools.weather").
            target:  "ag2" | "raw_python" | "pydantic" | "langchain"

        Returns:
            Dict with keys:
              - name        (str)
              - description (str)
              - function    (callable)
              - schema      (dict)  — OpenAI-compatible tool schema
              - tool_id     (str)
              - tool_object (framework-native object | None)
                            pydantic_ai.Tool for target="pydantic"
                            StructuredTool   for target="langchain"
                            None             for target="ag2" / "raw_python"

        Raises:
            KeyError:   if tool_id not found in the registry.
            ValueError: if target is not a known compilation target.
        """
        if target not in _ADAPTER_MAP:
            raise ValueError(f"Unknown target {target!r}. Choose from: {list(_ADAPTER_MAP)}")

        cache_key = (tool_id, target)

        # 1. LRU cache hit
        if cache_key in self._cache:
            self._cache.move_to_end(cache_key)
            logger.debug("Cache HIT: %s [%s]", tool_id, target)
            return self._cache[cache_key]

        logger.debug("Cache MISS: %s [%s] — compiling", tool_id, target)
        t0 = time.monotonic()

        # 2. Check if compiled artifact already exists on disk
        tool_py_path = self.dist_dir / target / tool_id / "tool.py"
        if not tool_py_path.exists():
            self._compile(tool_id, target)

        # 3. Import and extract exports
        tool_obj = self._import_tool_module(tool_py_path)

        elapsed_ms = (time.monotonic() - t0) * 1000
        logger.info("Loaded %s [%s] in %.1fms", tool_id, target, elapsed_ms)

        self._cache_put(cache_key, tool_obj)
        return tool_obj

    def precompile_all(self, target: str = "ag2") -> list[str]:
        """Compile every tool in the registry to dist/ for a given target.

        Returns:
            List of tool_ids that were compiled (skips already-compiled ones).
        """
        compiled = []
        for entry in self.registry.list():
            tid = entry["tool_id"]
            if not (self.dist_dir / target / tid / "tool.py").exists():
                try:
                    self._compile(tid, target)
                    compiled.append(tid)
                except Exception as exc:
                    logger.error("Failed to precompile %s [%s]: %s", tid, target, exc)
        return compiled

    def invalidate(self, tool_id: str, target: str = "ag2") -> None:
        """Evict a specific (tool_id, target) entry from the cache."""
        self._cache.pop((tool_id, target), None)

    def cache_info(self) -> dict[str, Any]:
        """Return cache stats."""
        return {
            "size": len(self._cache),
            "max_size": self._cache_size,
            "cached_tools": [f"{tid}[{tgt}]" for (tid, tgt) in self._cache.keys()],
        }

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _compile(self, tool_id: str, target: str) -> Path:
        """Fetch spec+impl from registry and compile to dist/<target>/."""
        row = self.registry.get(tool_id)
        if not row:
            raise KeyError(f"Tool not found in registry: {tool_id!r}")

        spec = yaml.safe_load(row["spec_yaml"])
        impl_path = Path(row["impl_path"])

        if not impl_path.exists():
            raise RuntimeError(f"Implementation file not found for {tool_id}: {impl_path}")

        adapter = _ADAPTER_MAP[target]()
        out_dir = adapter.compile(spec, impl_path, self.dist_dir)
        logger.info("Compiled %s [%s] → %s", tool_id, target, out_dir)
        return out_dir

    def _import_tool_module(self, tool_py_path: Path) -> dict[str, Any]:
        """Dynamically import a compiled tool.py and extract all exports."""
        # Use a unique module name to avoid collisions across targets
        parent = tool_py_path.parent
        unique_name = f"_babel_{parent.parent.name}_{parent.name.replace('.', '_')}"
        spec = importlib.util.spec_from_file_location(unique_name, tool_py_path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)

        fn: Callable = mod.TOOL_FUNCTION
        tool_id: str = mod.TOOL_ID
        schema: dict = mod.TOOL_SCHEMA
        # TOOL_OBJECT is present in pydantic + langchain targets; None otherwise
        tool_object = getattr(mod, "TOOL_OBJECT", None)

        return {
            "name":        schema["function"]["name"],
            "description": schema["function"]["description"],
            "function":    fn,
            "schema":      schema,
            "tool_id":     tool_id,
            "tool_object": tool_object,
        }

    def _cache_put(self, cache_key: tuple[str, str], tool_obj: dict[str, Any]) -> None:
        """Insert into LRU cache, evicting oldest entry if at capacity."""
        if len(self._cache) >= self._cache_size:
            evicted = next(iter(self._cache))
            del self._cache[evicted]
            logger.debug("Cache evicted: %s[%s]", *evicted)
        self._cache[cache_key] = tool_obj
        self._cache.move_to_end(cache_key)
