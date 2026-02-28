"""Planner Agent — structured intent → task graph.

Second agent in the Babel pipeline. Takes a structured intent object from the
Interpreter and produces an executable task graph with nodes, edges, and gaps.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import yaml
from autogen import ConversableAgent, LLMConfig
from autogen.oai.mistral import MistralLLMConfigEntry

PROMPTS_DIR = Path(__file__).parent / "prompts"

# Pre-built tools that ship with Babel. The Planner uses this list to decide
# which tools are available vs. which are gaps for ARIA to synthesize.
DEFAULT_AVAILABLE_TOOLS = [
    "com.babel.tools.restaurant_search",
    "com.babel.tools.contacts_lookup",
    "com.babel.tools.whatsapp_send",
    "com.babel.tools.gcal_create",
    "com.babel.tools.web_search",
    "com.babel.tools.weather",
    "com.babel.tools.maps_directions",
    "com.babel.tools.email_send",
]


def _load_prompts(agent_name: str) -> dict:
    """Load the full prompt config from the corresponding YAML file."""
    with open(PROMPTS_DIR / f"{agent_name}.yml") as f:
        return yaml.safe_load(f)


class PlannerAgent:
    """Wraps an AG2 ConversableAgent that converts intent into a task graph."""

    def __init__(
        self,
        api_key: str | None = None,
        available_tools: list[str] | None = None,
    ):
        self._api_key = api_key or os.environ["MISTRAL_API_KEY"]
        self._available_tools = available_tools or DEFAULT_AVAILABLE_TOOLS
        self._prompts = _load_prompts("planner")

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
        """
        tools_str = "\n".join(f"  - {t}" for t in self._available_tools)
        message = self._prompts["user_prompt"].format(
            intent_json=json.dumps(intent, indent=2),
            available_tools=tools_str,
        )

        result = self._executor.initiate_chat(
            recipient=self._agent,
            message=message,
            max_turns=1,
        )

        return self._parse_graph(result)

    # -- internals -------------------------------------------------------------

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
                    # Validate expected keys
                    assert "nodes" in graph, "Missing 'nodes' in graph"
                    assert "edges" in graph, "Missing 'edges' in graph"
                    assert "gaps" in graph, "Missing 'gaps' in graph"
                    return graph
                except (json.JSONDecodeError, AssertionError):
                    continue

        raise ValueError(
            "Planner agent did not return a valid task graph. "
            f"Last messages: {chat_result.chat_history[-3:]}"
        )
