"""
kiln_chat_backend/graph_flow.py
───────────────────────────────
KilnGraphFlow — Phase 4.

Takes the task graph produced by KilnPlanner and executes it as a
directed AG2 multi-agent workflow.

Architecture
────────────
Each graph node becomes an AG2 AssistantAgent + UserProxyAgent pair.
Tools assigned to a node are fetched from the Kiln registry and wrapped in
HTTP-calling stubs so:
  - Tools run on the Kiln registry, not in this process
  - Any agent on any machine can call the same tools
  - Newly registered tools are available without restart

Execution order
───────────────
A topological sort of the task graph determines the run order.
Upstream node results are injected as context into each downstream node's
initial message, so the final synthesis node sees all partial results.

Flow (example):
  weather_node ──┐
                 ├──→ summary_node → final answer
  currency_node ─┘

  1. weather_node  runs  → "28°C, partly cloudy in Singapore"
  2. currency_node runs  → "100 SGD = 68.48 EUR at 0.6848"
  3. summary_node  runs  with both results → synthesised final answer
"""

from __future__ import annotations

import logging
import os
from typing import Any

import requests
from autogen import AssistantAgent, UserProxyAgent, register_function

logger = logging.getLogger(__name__)

# ── Topological sort (Kahn's algorithm) ───────────────────────────────────────

def _topo_sort(nodes: list[dict], edges: list[list[str]]) -> list[str]:
    node_ids  = [n["id"] for n in nodes]
    in_degree = {nid: 0 for nid in node_ids}
    adj: dict[str, list[str]] = {nid: [] for nid in node_ids}

    for src, dst in edges:
        in_degree[dst] += 1
        adj[src].append(dst)

    queue  = [nid for nid, deg in in_degree.items() if deg == 0]
    result = []

    while queue:
        nid = queue.pop(0)
        result.append(nid)
        for neighbor in adj[nid]:
            in_degree[neighbor] -= 1
            if in_degree[neighbor] == 0:
                queue.append(neighbor)

    return result


# ── KilnToolBridge ───────────────────────────────────────────────────────────

def _make_http_tool(
    tool_id: str,
    spec: dict,
    server_url: str,
    node_id: str = "",
    on_event=None,
):
    """
    Create an AG2-compatible Python callable that runs a Kiln tool
    via HTTP POST to the Kiln registry.

    Dynamically builds a function with the exact signature (name,
    typed parameters, defaults) so AG2's inspect.signature() works.
    Emits tool_call and tool_result events if on_event is provided.
    """
    name   = spec["name"]
    params = spec["params"]

    _TYPE_MAP = {
        "str": "str", "int": "int", "float": "float",
        "bool": "bool", "list": "list", "dict": "dict",
    }

    sig_parts = []
    for p in params:
        t = _TYPE_MAP.get(p["type"], "str")
        if not p["required"] and p["default"] is not None:
            sig_parts.append(f"{p['name']}: {t} = {repr(p['default'])}")
        elif not p["required"]:
            sig_parts.append(f"{p['name']}: {t} = None")
        else:
            sig_parts.append(f"{p['name']}: {t}")

    sig_str    = ", ".join(sig_parts)
    kwargs_str = ", ".join(f'"{p["name"]}": {p["name"]}' for p in params)

    fn_source = (
        f"def {name}({sig_str}):\n"
        f"    \"\"\"{spec['description']}\"\"\"\n"
        f"    resp = _http_call(_server_url, _tool_id, {{{kwargs_str}}})\n"
        f"    return resp\n"
    )

    def _http_call(url: str, tid: str, args: dict) -> Any:
        if on_event:
            on_event({"type": "tool_call", "node_id": node_id, "tool": name, "args": args})
        r = requests.post(
            f"{url}/tools/{tid}/execute",
            json={"args": args},
            timeout=30,
        )
        r.raise_for_status()
        result = r.json()["result"]
        if on_event:
            on_event({"type": "tool_result", "node_id": node_id, "tool": name, "result": result})
        return result

    namespace = {
        "_http_call":  _http_call,
        "_server_url": server_url,
        "_tool_id":    tool_id,
    }
    # Use compile + exec to build the callable with the correct signature
    code = compile(fn_source, f"<kiln_tool_{name}>", "exec")
    _dynamic_exec(code, namespace)
    return namespace[name]


def _dynamic_exec(code, namespace):
    """Execute compiled code in namespace to create the tool function."""
    # This indirection exists so that the dynamic function creation is
    # isolated into its own helper for clarity.
    exec(code, namespace)  # noqa: S102


# ── Result extraction ─────────────────────────────────────────────────────────

def _extract_result(node_id: str, chat_history: list[dict]) -> str:
    """
    Pull the last substantive message from the AssistantAgent in this node.

    AG2 stores the UserProxyAgent's own messages as role='assistant' and the
    AssistantAgent's messages as role='user' from the executor's perspective.
    Filtering by agent name (stored in the 'name' field) is reliable.
    """
    target_name = f"{node_id}_assistant"

    # First pass: look for messages by the named assistant agent
    for msg in reversed(chat_history):
        if target_name not in (msg.get("name") or ""):
            continue
        content = (msg.get("content") or "").replace("TERMINATE", "").strip()
        if content:
            return content

    # Fallback: last non-empty, non-tool message
    for msg in reversed(chat_history):
        if msg.get("role") == "tool":
            continue
        content = (msg.get("content") or "").replace("TERMINATE", "").strip()
        if content:
            return content

    return "(no result)"


# ── KilnGraphFlow ─────────────────────────────────────────────────────────────

class KilnGraphFlow:
    """
    Phase 4: executes a task graph as a directed AG2 multi-agent workflow.

    Usage:
        flow = KilnGraphFlow(
            registry_url     = "http://localhost:8766",
            llm_config       = {"config_list": [...], "cache_seed": None},
        )
        result = flow.run(task_graph, verbose=True)
    """

    def __init__(
        self,
        registry_url: str = "http://localhost:8766",
        llm_config: dict | None = None,
        on_event=None,
    ):
        self._server_url = registry_url.rstrip("/")
        self._llm_config = llm_config or {}
        self._tool_cache: dict[str, dict] = {}   # tool_id → spec dict
        self._on_event   = on_event              # callable(event_dict) | None

    def _emit(self, event_type: str, **data) -> None:
        if self._on_event:
            self._on_event({"type": event_type, **data})

    # ── Public API ─────────────────────────────────────────────────────────────

    def run(self, task_graph: dict, extra_env: dict[str, str] | None = None, verbose: bool = True) -> str:
        """
        Execute the task graph and return the final synthesised answer.

        Args:
            task_graph: Dict produced by KilnPlanner.plan()
            extra_env:  Optional dict of env vars to inject for this run only
                        (e.g. API keys supplied by the user via the UI).
            verbose:    Print node-by-node execution progress

        Returns:
            Final answer string from the exit node.
        """
        # Inject per-run env vars, restore originals on exit
        _saved: dict[str, str | None] = {}
        if extra_env:
            for k, v in extra_env.items():
                _saved[k] = os.environ.get(k)
                os.environ[k] = v

        try:
            return self._run_graph(task_graph, verbose)
        finally:
            for k, original in _saved.items():
                if original is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = original

    # ── Failure detection ──────────────────────────────────────────────────────

    _FAILURE_PATTERNS = (
        '"success": false',
        "'success': false",
        "(no result)",
        "no wikipedia article found",
        "could not find",
        "failed to",
        "unable to complete",
        "api key not set",
        "error occurred",
        "no results found",
        "not found for",
    )

    def _is_failure(self, result: str) -> bool:
        """Return True if the node result looks like a tool/task failure."""
        lower = result.lower()
        return any(p in lower for p in self._FAILURE_PATTERNS)

    def _run_graph(self, task_graph: dict, verbose: bool) -> str:
        """Internal: execute nodes in topological order."""
        nodes     = {n["id"]: n for n in task_graph["nodes"]}
        edges     = task_graph.get("edges", [])
        exit_node = task_graph["exit_node"]
        order     = _topo_sort(list(nodes.values()), edges)

        if verbose:
            self._print_graph(task_graph, order)

        # Fetch all tool specs we'll need upfront (one batch GET)
        self._warm_tool_cache(task_graph["nodes"])

        # Execute nodes in topological order, accumulating context
        context: dict[str, str] = {}   # node_id → result text

        for node_id in order:
            node = nodes[node_id]
            self._emit(
                "node_start",
                node_id=node_id,
                role=node["role"],
                tools=node.get("tools", []),
                task=node.get("task", ""),
            )
            if verbose:
                logger.info(f"Running node: [{node_id}]  role={node['role']}")
                logger.info(f"Tools: {node.get('tools', []) or '(none)'}")

            result = self._run_node(node, context, task_graph["task"])

            # ── Retry once if a non-exit node failed ─────────────────────────
            if node_id != exit_node and self._is_failure(result):
                self._emit("node_retry", node_id=node_id, reason=result[:300])
                if verbose:
                    logger.info(f"Node '{node_id}' failed — retrying with enriched prompt")
                retry_node = {
                    **node,
                    "task": (
                        f"{node.get('task', task_graph['task'])}\n\n"
                        "IMPORTANT: Your previous attempt encountered a problem:\n"
                        f"  {result[:300]}\n\n"
                        "Please try an alternative approach:\n"
                        "- Use different, broader or more specific search terms\n"
                        "- Break a complex query into simpler sub-queries\n"
                        "- If one tool fails, try another available tool\n"
                        "- If no suitable tool succeeds, summarise what you know from general knowledge"
                    ),
                }
                result = self._run_node(retry_node, context, task_graph["task"])

            context[node_id] = result
            self._emit("node_complete", node_id=node_id, result=result)

            if verbose:
                logger.info(f"Result → {result[:200]}{'...' if len(result) > 200 else ''}")

        return context.get(exit_node, "(no result)")

    # ── Node execution ─────────────────────────────────────────────────────────

    def _run_node(self, node: dict, context: dict[str, str], original_task: str) -> str:
        """Build an AG2 agent pair for this node, register its tools, run it."""
        node_id   = node["id"]
        role      = node["role"]
        node_task = node.get("task", original_task)
        tool_ids  = node.get("tools", [])

        # ── System message ────────────────────────────────────────────────────
        system_msg = (
            f"You are {role}, a specialised agent in a multi-agent Kiln workflow.\n"
            f"Your specific task: {node_task}\n"
            "Use the provided tools to complete your task.\n"
            "Be concise and factual. Reply TERMINATE when done."
        )

        # ── Create AG2 agent pair ─────────────────────────────────────────────
        assistant = AssistantAgent(
            name=f"{node_id}_assistant",
            llm_config=self._llm_config,
            system_message=system_msg,
            is_termination_msg=lambda m: "TERMINATE" in (m.get("content") or ""),
        )
        executor = UserProxyAgent(
            name=f"{node_id}_executor",
            human_input_mode="NEVER",
            max_consecutive_auto_reply=8,
            code_execution_config=False,
            is_termination_msg=lambda m: "TERMINATE" in (m.get("content") or ""),
        )

        # ── Strip 'name' from messages before LLM call (Mistral rejects it) ────
        assistant.register_hook(
            "process_all_messages_before_reply",
            lambda messages: [{k: v for k, v in m.items() if k != "name"} for m in messages],
        )

        # ── Register Kiln tools via HTTP bridge ──────────────────────────────
        for tool_id in tool_ids:
            spec = self._tool_cache.get(tool_id)
            if spec is None:
                logger.warning(f"Tool '{tool_id}' not found on Kiln registry — skipping")
                continue
            fn = _make_http_tool(tool_id, spec, self._server_url, node_id=node_id, on_event=self._on_event)
            register_function(
                fn,
                caller=assistant,
                executor=executor,
                name=spec["name"],
                description=spec["description"],
            )

        # ── Build initial message ─────────────────────────────────────────────
        initial_msg = self._build_message(node_task, context)

        # ── Run ───────────────────────────────────────────────────────────────
        chat_result = executor.initiate_chat(
            assistant,
            message=initial_msg,
            silent=self._on_event is not None,  # silent when streaming to UI
            max_turns=10,
        )

        return _extract_result(node_id, chat_result.chat_history)

    # ── Helpers ────────────────────────────────────────────────────────────────

    def _build_message(self, node_task: str, context: dict[str, str]) -> str:
        """
        Build the initial message for a node, injecting upstream results
        as context so downstream agents have full information.
        """
        msg = node_task
        if context:
            upstream = "\n".join(
                f"  [{node_id}]: {result}"
                for node_id, result in context.items()
            )
            msg += f"\n\nContext from upstream agents:\n{upstream}"
        return msg

    def _warm_tool_cache(self, nodes: list[dict]) -> None:
        """Batch-fetch all tool specs needed by this graph from the Kiln registry."""
        needed = {tid for node in nodes for tid in node.get("tools", [])}
        if not needed:
            return
        try:
            resp = requests.get(f"{self._server_url}/tools", timeout=5)
            resp.raise_for_status()
            for tool in resp.json():
                if tool["id"] in needed:
                    self._tool_cache[tool["id"]] = tool
        except requests.RequestException as e:
            logger.warning(f"Could not fetch tools from Kiln registry: {e}")

    def _print_graph(self, task_graph: dict, order: list[str]) -> None:
        """Pretty-print the task graph before execution."""
        nodes = {n["id"]: n for n in task_graph["nodes"]}
        logger.info("Kiln Task Graph")
        logger.info(f"Task: {task_graph['task'][:55]}")
        logger.info(f"Execution order: {' → '.join(order)}")
        logger.info(f"Edges: {task_graph.get('edges', [])}")
        if task_graph.get("missing_tools"):
            logger.info(f"Missing tools:   {task_graph['missing_tools']}")
        for nid in order:
            n = nodes[nid]
            marker = "EXIT" if nid == task_graph["exit_node"] else "    "
            logger.info(f"[{marker}] {nid:20s}  role={n['role']}")
            logger.info(f"        tools={n.get('tools', []) or '(none)'}")
            logger.info(f"        task={n.get('task', '')[:55]}")
