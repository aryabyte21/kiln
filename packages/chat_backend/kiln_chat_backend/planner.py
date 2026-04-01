"""
kiln_chat_backend/planner.py
────────────────────────────
KilnPlanner — Phase 2.

Converts a natural-language user request into a task graph JSON
by asking Mistral Large to reason over the currently available
Kiln tools on the Kiln registry.

Output schema
─────────────
{
  "task": "original user request",
  "nodes": [
    {
      "id":             "snake_case node id",
      "role":           "Human-readable agent role name",
      "task":           "What this agent should do",
      "tools":          ["com.kiln.tools.weather", ...]   // only tool IDs that exist
    }
  ],
  "edges":        [["from_node_id", "to_node_id"], ...],
  "entry_nodes":  ["node_ids with no incoming edges"],
  "exit_node":    "node_id that synthesises the final answer",
  "missing_tools": [
    {
      "id":          "com.kiln.tools.tool_id",
      "description": "What this tool should do",
      "inputs":      [{"name": "arg", "type": "str", "description": "...", "required": true}],
      "output":      {"type": "dict", "fields": [{"name": "result", "type": "str", "description": "..."}]}
    }
  ]
}

The planner does NOT trigger synthesis — it only reports gaps.
Triggering synthesis is the caller's responsibility.
"""

from __future__ import annotations

import json
import logging

import requests
from mistralai.client import Mistral

logger = logging.getLogger(__name__)

PLANNER_SYSTEM = """\
You are Kiln's task planner. Your job is to decompose a user request into a \
multi-agent task graph that can be executed by a team of specialised agents, \
each armed with Kiln tools fetched from a live registry.

Given:
  1. A user request
  2. A list of currently registered Kiln tools (id, name, description)

Produce a JSON object with EXACTLY these fields — no extras:

{
  "task": "<original user request>",
  "nodes": [
    {
      "id":    "<snake_case unique id>",
      "role":  "<agent role, e.g. WeatherAgent>",
      "task":  "<specific sub-task this agent must complete>",
      "tools": ["<tool_id>", ...]
    }
  ],
  "edges":         [["<from_id>", "<to_id>"], ...],
  "entry_nodes":   ["<node_ids that have no incoming edges>"],
  "exit_node":     "<node_id of the final synthesis/summary agent>",
  "missing_tools": [
    {
      "id":          "<com.kiln.tools.tool_name>",
      "description": "<one sentence: what this tool does>",
      "inputs":      [{"name": "<param>", "type": "<string|integer|float|boolean>", "description": "<desc>", "required": true}],
      "output":      {"type": "dict", "fields": [{"name": "<field>", "type": "<string|integer|float|boolean>", "description": "<desc>"}]}
    }
  ]
}

Rules:
- Only use tool IDs from the provided list. Never invent tool IDs.
- The exit_node synthesises all upstream results. It should use no tools.
- If a sub-task has no matching tool, describe the ideal tool in missing_tools \
  with its full id, description, inputs and output schema so synthesis can build it. \
  Do NOT add invented tool IDs to any node's tools list.
- Keep it simple: 2-7 nodes for most requests.
- entry_nodes are all nodes with no incoming edges.
- Output raw JSON only, no markdown fences.
"""


class KilnPlanner:
    """
    Phase 2: produces a task graph from a user request + Kiln registry tool list.

    Usage:
        planner = KilnPlanner(
            registry_url="http://localhost:8766",
            api_key="...",
        )
        task_graph = planner.plan("Get the weather in Singapore and convert 100 SGD to EUR")
    """

    def __init__(
        self,
        registry_url: str = "http://localhost:8766",
        api_key: str = "",
        model: str = "mistral-large-latest",
    ):
        self._server_url = registry_url.rstrip("/")
        self._client     = Mistral(api_key=api_key)
        self._model      = model

    # ── Public API ─────────────────────────────────────────────────────────────

    def plan(self, user_request: str, tools: list[dict] | None = None) -> dict:
        """
        Produce a task graph for the given user request.

        Args:
            user_request: Natural-language task description.
            tools:        Optional pre-fetched tool list. When provided, the
                          HTTP call to the Kiln registry is skipped. Useful when
                          calling from within the Kiln registry itself to avoid a
                          self-request deadlock.

        Returns:
            Task graph dict (see module docstring for schema).

        Raises:
            requests.ConnectionError  – Kiln registry is not running (only when tools=None)
            json.JSONDecodeError      – Mistral returned non-JSON
        """
        if tools is None:
            tools = self._fetch_tools()
        graph = self._call_planner(user_request, tools)
        return graph

    # ── Private ────────────────────────────────────────────────────────────────

    def _fetch_tools(self) -> list[dict]:
        """GET /tools from the Kiln registry."""
        try:
            resp = requests.get(f"{self._server_url}/tools", timeout=5)
            resp.raise_for_status()
            return resp.json()
        except requests.ConnectionError:
            raise requests.ConnectionError(
                f"Kiln registry not reachable at {self._server_url}. "
                "Run: python run_server.py"
            ) from None

    def _call_planner(self, user_request: str, tools: list[dict]) -> dict:
        import time

        tool_summary = "\n".join(
            f"  - {t['id']}: {t['description'][:80]}"
            for t in tools
        )

        user_msg = (
            f"User request: {user_request}\n\n"
            f"Available Kiln tools:\n{tool_summary}\n\n"
            "Produce the task graph JSON now."
        )

        # Retry on rate limit (429) with exponential backoff
        last_error = None
        for attempt in range(3):
            try:
                response = self._client.chat.complete(
                    model=self._model,
                    messages=[
                        {"role": "system", "content": PLANNER_SYSTEM},
                        {"role": "user",   "content": user_msg},
                    ],
                    response_format={"type": "json_object"},
                )
                break
            except Exception as exc:
                last_error = exc
                err_str = str(exc)
                if "429" in err_str or "rate" in err_str.lower() or "capacity" in err_str.lower():
                    wait = 2 ** attempt * 2  # 2s, 4s, 8s
                    logger.warning("Mistral rate limited (attempt %d/3), retrying in %ds", attempt + 1, wait)
                    time.sleep(wait)
                    continue
                raise  # non-retryable error
        else:
            raise last_error  # type: ignore[misc]

        raw = response.choices[0].message.content

        try:
            graph = json.loads(raw)
        except json.JSONDecodeError as exc:
            logger.error("Mistral returned invalid JSON: %s", raw[:300])
            # Return a minimal single-node graph so execution can still proceed
            return {
                "task": user_request,
                "nodes": [
                    {
                        "id": "fallback",
                        "role": "GeneralAgent",
                        "task": user_request,
                        "tools": [],
                    }
                ],
                "edges": [],
                "entry_nodes": ["fallback"],
                "exit_node": "fallback",
                "missing_tools": [],
                "_parse_error": str(exc),
            }

        graph["task"] = user_request      # ensure original request is preserved
        return graph
