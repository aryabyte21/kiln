"""
agents/pydantic_agent.py
-------------------------
Pydantic-AI agent loading tools from Babel registry.

Flow:
  BabelRuntime.load() → callable → Agent(tools=[...]) → run_sync()
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv
load_dotenv(ROOT.parent / ".env")

from pydantic_ai import Agent
from pydantic_ai.models.mistral import MistralModel
from pydantic_ai.providers.mistral import MistralProvider

from babel_registry.registry.local_registry import LocalRegistry
from babel_registry.runtime.babel_runtime import BabelRuntime


def build_agent() -> Agent:
    registry = LocalRegistry()
    runtime = BabelRuntime(registry=registry, dist_dir=ROOT / "dist")

    weather_tool = runtime.load("com.aria.tools.weather")
    maps_tool = runtime.load("com.aria.tools.maps_directions")

    model = MistralModel(
        "mistral-large-latest",
        provider=MistralProvider(api_key=os.getenv("MISTRAL_API_KEY")),
    )

    agent = Agent(
        model=model,
        tools=[weather_tool["function"], maps_tool["function"]],
        system_prompt="You are ARIA. Use tools to answer questions about weather and directions.",
    )
    return agent


if __name__ == "__main__":
    print("\n[Pydantic-AI Agent]")
    agent = build_agent()
    result = agent.run_sync(
        "What is the weather in Singapore and how long to drive from Changi Airport to Marina Bay Sands?"
    )
    print(result.output)
