"""Planner Agent — structured intent → task graph.

Second agent in the Babel pipeline. Takes a structured intent object from the
Interpreter and produces an executable task graph with nodes, edges, and gaps.

The Planner loads tool descriptions from the Babel Registry (or from on-disk
spec files as fallback) so it can intelligently match existing tools to plan
steps. When a step requires a tool that doesn't exist, the Planner writes a
detailed synthesis prompt — this description is passed downstream to ARIA /
vibe_tool so a vibe-coding LLM can generate the missing tool.
"""

from __future__ import annotations

import json
import logging
import os
import uuid
from pathlib import Path

import yaml
from autogen import ConversableAgent, LLMConfig
from autogen.oai.mistral import MistralLLMConfigEntry

logger = logging.getLogger(__name__)

PROMPTS_DIR = Path(__file__).parent / "prompts"
TOOLS_DIR = Path(__file__).resolve().parent.parent.parent / "tools"


def _load_prompts(agent_name: str) -> dict:
    """Load the full prompt config from the corresponding YAML file."""
    with open(PROMPTS_DIR / f"{agent_name}.yml") as f:
        return yaml.safe_load(f)


def _load_tool_catalog_from_disk() -> list[dict]:
    """Scan the tools/ directory and build a catalog from spec.yaml files.

    Returns a list of dicts with keys: tool_id, name, description,
    inputs (list of {name, type, description}), output_fields (list of {name, type}).
    """
    catalog: list[dict] = []
    if not TOOLS_DIR.is_dir():
        return catalog

    for spec_path in sorted(TOOLS_DIR.glob("*/spec.yaml")):
        try:
            with open(spec_path) as f:
                spec = yaml.safe_load(f)
            catalog.append(_spec_to_catalog_entry(spec))
        except Exception as exc:
            logger.warning("Failed to load tool spec %s: %s", spec_path, exc)
    return catalog


def _spec_to_catalog_entry(spec: dict) -> dict:
    """Convert a parsed Babel spec dict into a compact catalog entry."""
    interface = spec.get("interface", {})
    inputs = [
        {
            "name": inp["name"],
            "type": inp["type"],
            "description": inp.get("description", ""),
            "required": inp.get("required", False),
        }
        for inp in interface.get("inputs", [])
    ]
    output_fields = [
        {"name": f["name"], "type": f["type"]}
        for f in interface.get("output", {}).get("fields", [])
    ]
    return {
        "tool_id": spec["id"],
        "name": spec.get("name", ""),
        "description": spec.get("description", ""),
        "inputs": inputs,
        "output_fields": output_fields,
    }


def _format_tool_catalog(catalog: list[dict]) -> str:
    """Format the tool catalog into a human-readable string for the LLM prompt."""
    if not catalog:
        return "  (no tools available)"
    lines: list[str] = []
    for tool in catalog:
        lines.append(f"  - **{tool['tool_id']}** — {tool['description']}")
        if tool["inputs"]:
            input_parts = []
            for inp in tool["inputs"]:
                req = " (required)" if inp.get("required") else ""
                input_parts.append(f"{inp['name']}: {inp['type']}{req}")
            lines.append(f"    Inputs: {', '.join(input_parts)}")
        if tool["output_fields"]:
            out_parts = [f"{f['name']}: {f['type']}" for f in tool["output_fields"]]
            lines.append(f"    Outputs: {', '.join(out_parts)}")
    return "\n".join(lines)


class PlannerAgent:
    """Wraps an AG2 ConversableAgent that converts intent into a task graph.

    The Planner loads tool descriptions from the Babel Registry (if provided)
    or falls back to reading spec.yaml files from the tools/ directory. This
    gives the LLM rich context about each tool's purpose, inputs, and outputs
    so it can make informed decisions about tool selection and gap identification.
    """

    def __init__(
        self,
        api_key: str | None = None,
        registry=None,
    ):
        """
        Args:
            api_key:  Mistral API key. Falls back to MISTRAL_API_KEY env var.
            registry: Optional LocalRegistry instance. If provided, the Planner
                      loads tool descriptions from the registry. Otherwise it
                      reads spec.yaml files from the tools/ directory on disk.
        """
        self._api_key = api_key or os.environ["MISTRAL_API_KEY"]
        self._registry = registry
        self._prompts = _load_prompts("planner")
        self._tool_catalog = self._build_tool_catalog()

        # Mistral Large is the best Mistral model for complex planning and
        # structured JSON generation — it handles multi-step reasoning,
        # dependency analysis, and constrained output well.
        self._llm_config = LLMConfig(
            MistralLLMConfigEntry(
                model="mistral-large-latest",
                api_key=self._api_key,
            )
        )

        self._agent = ConversableAgent(
            name="planner",
            system_message=self._prompts["system_prompt"],
            llm_config=self._llm_config,
            human_input_mode="NEVER",
        )

        self._executor = ConversableAgent(
            name="planner_tool_executor",
            human_input_mode="NEVER",
            llm_config=False,
        )

    # -- public API ------------------------------------------------------------

    def run(self, intent: dict) -> dict:
        """Convert a structured intent into a task graph.

        Args:
            intent: Structured intent dict from the Interpreter agent,
                    with keys: goal, entities, constraints, dependencies.

        Returns:
            Task graph dict with keys: nodes, edges, gaps.
            Each gap contains a detailed synthesis_prompt suitable for
            a vibe-coding LLM to generate the missing tool.
        """
        catalog_str = _format_tool_catalog(self._tool_catalog)
        tool_ids = [t["tool_id"] for t in self._tool_catalog]

        message = self._prompts["user_prompt"].format(
            intent_json=json.dumps(intent, indent=2),
            tool_catalog=catalog_str,
            tool_id_list=json.dumps(tool_ids),
        )

        result = self._executor.initiate_chat(
            recipient=self._agent,
            message=message,
            max_turns=1,
        )

        return self._parse_graph(result)

    # -- internals -------------------------------------------------------------

    def _build_tool_catalog(self) -> list[dict]:
        """Build tool catalog from registry or disk."""
        if self._registry is not None:
            return self._catalog_from_registry()
        return _load_tool_catalog_from_disk()

    def _catalog_from_registry(self) -> list[dict]:
        """Load tool catalog from a LocalRegistry instance."""
        catalog: list[dict] = []
        for row in self._registry.list():
            spec = self._registry.get_spec(row["tool_id"])
            if spec:
                catalog.append(_spec_to_catalog_entry(spec))
            else:
                # Fallback: use the summary info from list()
                catalog.append({
                    "tool_id": row["tool_id"],
                    "name": row["name"],
                    "description": row.get("description", ""),
                    "inputs": [],
                    "output_fields": [],
                })
        return catalog

    @staticmethod
    def _parse_graph(chat_result) -> dict:
        """Extract the JSON task graph from the agent's last message."""
        for msg in reversed(chat_result.chat_history):
            if msg.get("role") == "assistant" or msg.get("name") == "planner":
                content = msg.get("content", "")
                if not content:
                    continue
                text = content.strip()
                if text.startswith("```"):
                    text = text.split("\n", 1)[-1]
                    text = text.rsplit("```", 1)[0]
                try:
                    graph = json.loads(text.strip())
                    assert "nodes" in graph, "Missing 'nodes' in graph"
                    assert "edges" in graph, "Missing 'edges' in graph"
                    assert "gaps" in graph, "Missing 'gaps' in graph"
                    for gap in graph["gaps"]:
                        gap["uuid"] = str(uuid.uuid4())
                    return graph
                except (json.JSONDecodeError, AssertionError):
                    continue

        raise ValueError(
            "Planner agent did not return a valid task graph. "
            f"Last messages: {chat_result.chat_history[-3:]}"
        )
