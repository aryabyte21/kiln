"""
babel.registry.local_registry
------------------------------
SQLite-backed tool registry for ARIA's Babel system.

Public API consumed by other engineers:

    registry = LocalRegistry()                     # default db path
    registry.query("weather")                      # → "com.aria.tools.weather" | None
    registry.publish(spec_dict, impl_path)         # → tool_id
    registry.list()                                # → [{"tool_id": ..., "name": ..., ...}, ...]
    registry.get("com.aria.tools.weather")         # → full row dict | None

E1 (Planner) calls query() to check registry before flagging a gap.
E3 (AG2 Runner) calls publish() after Vibe synthesis.
"""

from __future__ import annotations

import json
import logging
import sqlite3
from pathlib import Path
from typing import Optional

import yaml

logger = logging.getLogger(__name__)

_DEFAULT_DB_PATH = Path(__file__).parent.parent.parent / "babel_registry.db"
_MIGRATION_PATH = Path(__file__).parent / "migrations" / "001_initial.sql"


class LocalRegistry:
    """SQLite-backed Babel tool registry."""

    def __init__(self, db_path: Path = _DEFAULT_DB_PATH) -> None:
        self.db_path = Path(db_path)
        self._conn = self._connect()
        self._run_migrations()

    # ------------------------------------------------------------------
    # Connection + schema
    # ------------------------------------------------------------------

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path), check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    def _run_migrations(self) -> None:
        sql = _MIGRATION_PATH.read_text()
        self._conn.executescript(sql)
        self._conn.commit()

    # ------------------------------------------------------------------
    # Core API
    # ------------------------------------------------------------------

    def query(self, tool_name: str) -> Optional[str]:
        """Look up a tool by name or full tool_id.

        Matches on:
          - Exact tool_id  (e.g. "com.aria.tools.weather")
          - Short name     (last segment, e.g. "weather")
          - Tool name      (e.g. "Weather Tool")

        Returns:
            tool_id string if found, None on miss.

        Side effect: logs a registry_event row for observability.
        """
        cursor = self._conn.execute(
            """
            SELECT tool_id FROM tools
            WHERE tool_id = ?
               OR tool_id LIKE ?
               OR LOWER(name) = LOWER(?)
            LIMIT 1
            """,
            (tool_name, f"%.{tool_name}", tool_name),
        )
        row = cursor.fetchone()

        if row:
            tool_id = row["tool_id"]
            self._log_event("query_hit", tool_id, {"query": tool_name})
            logger.debug("Registry HIT: query=%r → tool_id=%r", tool_name, tool_id)
            return tool_id
        else:
            self._log_event("query_miss", None, {"query": tool_name})
            logger.debug("Registry MISS: query=%r", tool_name)
            return None

    def publish(
        self,
        spec: dict,
        impl_path: str | Path,
        source: str = "pre-built",
    ) -> str:
        """Add or update a tool in the registry.

        Args:
            spec:       Validated Babel spec dict.
            impl_path:  Absolute path to the implementation file.
            source:     Origin of the tool ('pre-built', 'synthesized', 'imported').

        Returns:
            tool_id of the published tool.

        Raises:
            ValueError: if spec is missing required fields.
        """
        tool_id = spec["id"]
        name = spec["name"]
        version = spec.get("metadata", {}).get("version", "1.0.0")
        description = spec.get("description", "")
        tags = json.dumps(spec.get("metadata", {}).get("tags", []))
        spec_yaml = yaml.dump(spec, default_flow_style=False)
        impl_str = str(Path(impl_path).resolve())

        self._conn.execute(
            """
            INSERT INTO tools (tool_id, name, version, description, spec_yaml, impl_path, tags, source)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(tool_id) DO UPDATE SET
                name        = excluded.name,
                version     = excluded.version,
                description = excluded.description,
                spec_yaml   = excluded.spec_yaml,
                impl_path   = excluded.impl_path,
                tags        = excluded.tags,
                source      = excluded.source,
                updated_at  = CURRENT_TIMESTAMP
            """,
            (tool_id, name, version, description, spec_yaml, impl_str, tags, source),
        )
        self._conn.commit()
        self._log_event("publish", tool_id, {"source": source, "version": version})
        logger.info("Published tool: %s (source=%s)", tool_id, source)
        return tool_id

    def list(self) -> list[dict]:
        """Return all tools in the registry as a list of dicts."""
        cursor = self._conn.execute(
            "SELECT tool_id, name, version, description, tags, source, created_at FROM tools ORDER BY created_at"
        )
        rows = []
        for row in cursor.fetchall():
            rows.append({
                "tool_id": row["tool_id"],
                "name": row["name"],
                "version": row["version"],
                "description": row["description"],
                "tags": json.loads(row["tags"]),
                "source": row["source"],
                "created_at": row["created_at"],
            })
        return rows

    def get(self, tool_id: str) -> Optional[dict]:
        """Return full registry row for a tool_id, or None if not found."""
        cursor = self._conn.execute(
            "SELECT * FROM tools WHERE tool_id = ?",
            (tool_id,),
        )
        row = cursor.fetchone()
        if not row:
            return None
        return {
            "tool_id": row["tool_id"],
            "name": row["name"],
            "version": row["version"],
            "description": row["description"],
            "spec_yaml": row["spec_yaml"],
            "impl_path": row["impl_path"],
            "tags": json.loads(row["tags"]),
            "source": row["source"],
            "created_at": row["created_at"],
        }

    def get_spec(self, tool_id: str) -> Optional[dict]:
        """Return the parsed spec dict for a tool_id, or None."""
        row = self.get(tool_id)
        if not row:
            return None
        return yaml.safe_load(row["spec_yaml"])

    def count(self) -> int:
        """Return total number of tools in the registry."""
        cursor = self._conn.execute("SELECT COUNT(*) FROM tools")
        return cursor.fetchone()[0]

    # ------------------------------------------------------------------
    # Observability support
    # ------------------------------------------------------------------

    def _log_event(self, event_type: str, tool_id: Optional[str], detail: dict) -> None:
        """Log a registry event for W&B Weave observability (E3 reads this)."""
        try:
            self._conn.execute(
                "INSERT INTO registry_events (event_type, tool_id, detail) VALUES (?, ?, ?)",
                (event_type, tool_id, json.dumps(detail)),
            )
            self._conn.commit()
        except Exception:
            pass  # never let observability logging crash the main flow

    def get_events(self, limit: int = 100) -> list[dict]:
        """Return recent registry events (for W&B Weave logging)."""
        cursor = self._conn.execute(
            "SELECT * FROM registry_events ORDER BY created_at DESC LIMIT ?",
            (limit,),
        )
        return [dict(row) for row in cursor.fetchall()]

    def hit_rate(self) -> float:
        """Compute registry query hit rate (hits / total queries)."""
        cursor = self._conn.execute(
            """
            SELECT
                SUM(CASE WHEN event_type = 'query_hit'  THEN 1 ELSE 0 END) as hits,
                SUM(CASE WHEN event_type = 'query_miss' THEN 1 ELSE 0 END) as misses
            FROM registry_events
            WHERE event_type IN ('query_hit', 'query_miss')
            """
        )
        row = cursor.fetchone()
        hits = row["hits"] or 0
        misses = row["misses"] or 0
        total = hits + misses
        return hits / total if total > 0 else 0.0

    # ------------------------------------------------------------------
    # Cleanup
    # ------------------------------------------------------------------

    def close(self) -> None:
        self._conn.close()

    def __del__(self) -> None:
        try:
            self._conn.close()
        except Exception:
            pass
