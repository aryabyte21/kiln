"""
babel.runtime.babel_runtime
-----------------------------
BabelRuntime: compile-on-demand + LRU cache for AG2 tool loading.

Public API consumed by E3 (AG2 GraphFlow):

    runtime = BabelRuntime()
    tool = runtime.load("com.aria.tools.weather")
    # tool = {
    #     "name":        "weather",
    #     "description": "Get current weather...",
    #     "function":    <callable>,
    #     "schema":      {...}   # OpenAI-compatible tool schema
    # }

Loading a cached compiled tool takes < 5ms.
First compile (cache miss) takes ~50–200ms.

Design:
- On load(tool_id): look in LRU cache → if miss, fetch from registry, compile
  with AG2Adapter, write to dist/, import tool.py, cache result.
- Cache is in-memory only (process lifetime). The compiled dist/ files persist
  on disk between runs for fast reload.
"""

from __future__ import annotations

import importlib.util
import logging
import time
from collections import OrderedDict
from pathlib import Path
from typing import Any, Callable, Optional

import yaml

from babel.compiler.adapters.ag2_adapter import AG2Adapter
from babel.registry.local_registry import LocalRegistry

logger = logging.getLogger(__name__)

_DEFAULT_DIST_DIR = Path(__file__).parent.parent.parent / "dist"
_CACHE_MAX_SIZE = 64  # max compiled tools held in memory


class BabelRuntime:
    """Compile-on-demand tool loader with in-memory LRU cache.

    Args:
        registry:  LocalRegistry instance (default: new instance at default db path).
        dist_dir:  Root directory for compiled tool artifacts.
        cache_size: Max number of compiled tools to hold in memory.
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
        self._adapter = AG2Adapter()
        self._cache: OrderedDict[str, dict[str, Any]] = OrderedDict()
        self._cache_size = cache_size

    # ------------------------------------------------------------------
    # Core public API
    # ------------------------------------------------------------------

    def load(self, tool_id: str, target: str = "ag2") -> dict[str, Any]:
        """Load a compiled tool object ready for AG2 registration.

        Args:
            tool_id: Full tool ID (e.g. "com.aria.tools.weather").
            target:  Compilation target. Only "ag2" is supported in v1.0.

        Returns:
            Dict with keys:
              - name        (str)  — short function name
              - description (str)  — used by LLM to select the tool
              - function    (callable) — the actual Python function
              - schema      (dict) — OpenAI-compatible tool schema

        Raises:
            KeyError: if tool_id is not found in the registry.
            RuntimeError: if compilation fails.
        """
        # 1. Check in-memory LRU cache
        if tool_id in self._cache:
            self._cache.move_to_end(tool_id)
            logger.debug("Cache HIT: %s", tool_id)
            return self._cache[tool_id]

        logger.debug("Cache MISS: %s — compiling", tool_id)
        t0 = time.monotonic()

        # 2. Check if compiled artifact already exists on disk
        out_dir = self.dist_dir / "ag2" / tool_id
        tool_py_path = out_dir / "tool.py"

        if not tool_py_path.exists():
            # Need to compile
            self._compile(tool_id)

        # 3. Import the compiled tool.py
        tool_obj = self._import_tool_module(tool_py_path)

        elapsed_ms = (time.monotonic() - t0) * 1000
        logger.info("Loaded %s in %.1fms", tool_id, elapsed_ms)

        # 4. Cache and return
        self._cache_put(tool_id, tool_obj)
        return tool_obj

    def precompile_all(self) -> list[str]:
        """Compile every tool in the registry to dist/. Call at startup.

        Returns:
            List of tool_ids that were compiled (skips already-compiled ones).
        """
        compiled = []
        for entry in self.registry.list():
            tool_id = entry["tool_id"]
            out_dir = self.dist_dir / "ag2" / tool_id
            if not (out_dir / "tool.py").exists():
                try:
                    self._compile(tool_id)
                    compiled.append(tool_id)
                except Exception as exc:
                    logger.error("Failed to precompile %s: %s", tool_id, exc)
        return compiled

    def invalidate(self, tool_id: str) -> None:
        """Evict a tool from the in-memory cache (force recompile on next load)."""
        self._cache.pop(tool_id, None)

    def cache_info(self) -> dict[str, Any]:
        """Return cache stats."""
        return {
            "size": len(self._cache),
            "max_size": self._cache_size,
            "cached_tools": list(self._cache.keys()),
        }

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _compile(self, tool_id: str) -> Path:
        """Fetch spec+impl from registry and compile to dist/."""
        row = self.registry.get(tool_id)
        if not row:
            raise KeyError(f"Tool not found in registry: {tool_id!r}")

        spec = yaml.safe_load(row["spec_yaml"])
        impl_path = Path(row["impl_path"])

        if not impl_path.exists():
            raise RuntimeError(
                f"Implementation file not found for {tool_id}: {impl_path}"
            )

        out_dir = self._adapter.compile(spec, impl_path, self.dist_dir)
        logger.info("Compiled %s → %s", tool_id, out_dir)
        return out_dir

    def _import_tool_module(self, tool_py_path: Path) -> dict[str, Any]:
        """Dynamically import a compiled tool.py and extract exports."""
        module_name = f"_babel_compiled_{tool_py_path.parent.name.replace('.', '_')}"
        spec = importlib.util.spec_from_file_location(module_name, tool_py_path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)

        fn: Callable = mod.TOOL_FUNCTION
        tool_id: str = mod.TOOL_ID
        schema: dict = mod.TOOL_SCHEMA

        return {
            "name": schema["function"]["name"],
            "description": schema["function"]["description"],
            "function": fn,
            "schema": schema,
            "tool_id": tool_id,
        }

    def _cache_put(self, tool_id: str, tool_obj: dict[str, Any]) -> None:
        """Insert into LRU cache, evicting LRU entry if at capacity."""
        if len(self._cache) >= self._cache_size:
            evicted = next(iter(self._cache))
            del self._cache[evicted]
            logger.debug("Cache evicted: %s", evicted)
        self._cache[tool_id] = tool_obj
        self._cache.move_to_end(tool_id)
