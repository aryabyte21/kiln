"""Interpreter Agent — voice/text → structured intent.

First agent in the Babel pipeline. Takes raw voice audio or text input,
transcribes audio via Voxtral STT, then uses Mistral Large to extract
a structured intent object with goal, entities, constraints, and dependencies.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Annotated

import yaml
from autogen import ConversableAgent, LLMConfig, register_function
from autogen.oai.mistral import MistralLLMConfigEntry

from babel.voice_tools import VoxtralSTT

AUDIO_EXTENSIONS = {".mp3", ".wav", ".m4a", ".flac", ".ogg"}

PROMPTS_DIR = Path(__file__).parent / "prompts"


def _load_prompts(agent_name: str) -> dict:
    """Load the full prompt config from the corresponding YAML file."""
    with open(PROMPTS_DIR / f"{agent_name}.yml") as f:
        return yaml.safe_load(f)


class InterpreterAgent:
    """Wraps an AG2 ConversableAgent that extracts structured intent from input."""

    def __init__(self, api_key: str | None = None):
        self._api_key = api_key or os.environ["MISTRAL_API_KEY"]
        self._stt = VoxtralSTT(api_key=self._api_key)

        self._prompts = _load_prompts("interpreter")

        self._llm_config = LLMConfig(
            MistralLLMConfigEntry(
                model="mistral-large-latest",
                api_key=self._api_key,
            )
        )

        self._agent = ConversableAgent(
            name="interpreter",
            system_message=self._prompts["system_prompt"],
            llm_config=self._llm_config,
            human_input_mode="NEVER",
        )

        self._executor = ConversableAgent(
            name="interpreter_tool_executor",
            human_input_mode="NEVER",
            llm_config=False,
        )

        # AG2 requires plain functions (not bound methods) for tool registration.
        # Capture stt instance in a closure.
        stt = self._stt

        def transcribe_audio(
            file_path: Annotated[str, "Absolute path to the audio file"],
        ) -> str:
            """Transcribe an audio file using Voxtral STT."""
            return stt.transcribe_file(file_path)

        register_function(
            transcribe_audio,
            caller=self._agent,
            executor=self._executor,
            name="transcribe_audio",
            description=(
                "Transcribe an audio file to text. "
                "Input: absolute path to an audio file (.mp3, .wav, .m4a, .flac, .ogg). "
                "Returns the transcript string."
            ),
        )

    # -- public API ------------------------------------------------------------

    def run(self, user_input: str) -> dict:
        """Process text or an audio file path and return a structured intent.

        Args:
            user_input: Either plain text request or a path to an audio file.

        Returns:
            Parsed intent dict with keys: goal, entities, constraints, dependencies.
        """
        path = Path(user_input.strip())
        if path.suffix.lower() in AUDIO_EXTENSIONS and path.exists():
            transcript = self._stt.transcribe_file(path)
            message = self._prompts["user_prompt_audio"].format(transcript=transcript)
        else:
            message = self._prompts["user_prompt"].format(user_input=user_input)

        result = self._executor.initiate_chat(
            recipient=self._agent,
            message=message,
            max_turns=1,
        )

        return self._parse_intent(result)

    # -- internals -------------------------------------------------------------

    @staticmethod
    def _parse_intent(chat_result) -> dict:
        """Extract the JSON intent from the agent's last message."""
        for msg in reversed(chat_result.chat_history):
            if msg.get("role") == "assistant" or msg.get("name") == "interpreter":
                content = msg.get("content", "")
                if not content:
                    continue
                # Strip markdown fences if the model wraps them anyway
                text = content.strip()
                if text.startswith("```"):
                    text = text.split("\n", 1)[-1]
                    text = text.rsplit("```", 1)[0]
                try:
                    return json.loads(text.strip())
                except json.JSONDecodeError:
                    continue

        raise ValueError(
            "Interpreter agent did not return valid JSON intent. "
            f"Last messages: {chat_result.chat_history[-3:]}"
        )
