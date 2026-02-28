"""ElevenLabs TTS client for Babel.

Handles text-to-speech synthesis using the ElevenLabs API.
Supports blocking generation, streaming playback, and async streaming.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Iterator

from elevenlabs.client import ElevenLabs, AsyncElevenLabs
from elevenlabs import VoiceSettings, play, stream as play_stream

# Default voice: George (conversational, natural)
DEFAULT_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb"
DEFAULT_MODEL = "eleven_multilingual_v2"
DEFAULT_OUTPUT_FORMAT = "mp3_44100_128"

# Preset voices for quick access
VOICES = {
    "george": "JBFqnCBsd6RMkjVDRZzb",
    "rachel": "21m00Tcm4TlvDq8ikWAM",
    "adam": "pNInz6obpgDQGcFmaJgB",
    "bella": "EXAVITQu4vr4xnSDxMaL",
    "brian": "nPczCjzI2devNBz1zQrb",
    "charlotte": "XB0fDUnXU5powFXDhCwa",
    "daniel": "onwK4e9ZLuTAKqWW03F9",
}


class ElevenLabsTTS:
    """Text-to-speech using the ElevenLabs API."""

    def __init__(
        self,
        api_key: str | None = None,
        voice_id: str | None = None,
        model_id: str = DEFAULT_MODEL,
    ):
        self._api_key = api_key or os.environ["ELEVENLABS_API_KEY"]
        self._client = ElevenLabs(api_key=self._api_key)
        self._async_client = AsyncElevenLabs(api_key=self._api_key)
        self.voice_id = voice_id or DEFAULT_VOICE_ID
        self.model_id = model_id

    # -- blocking generation ---------------------------------------------------

    def synthesize(
        self,
        text: str,
        voice_id: str | None = None,
        stability: float = 0.71,
        similarity_boost: float = 0.5,
    ) -> bytes:
        """Generate speech and return raw audio bytes (MP3)."""
        audio_iter = self._client.text_to_speech.convert(
            text=text,
            voice_id=voice_id or self.voice_id,
            model_id=self.model_id,
            output_format=DEFAULT_OUTPUT_FORMAT,
            voice_settings=VoiceSettings(
                stability=stability,
                similarity_boost=similarity_boost,
            ),
        )
        return b"".join(audio_iter)

    def synthesize_to_file(
        self,
        text: str,
        output_path: str | Path,
        voice_id: str | None = None,
    ) -> Path:
        """Generate speech and save to a file."""
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        audio = self.synthesize(text, voice_id=voice_id)
        output_path.write_bytes(audio)
        return output_path

    def speak(self, text: str, voice_id: str | None = None) -> None:
        """Generate speech and play it locally (blocking)."""
        audio = self.synthesize(text, voice_id=voice_id)
        play(audio)

    # -- streaming -------------------------------------------------------------

    def stream(
        self,
        text: str,
        voice_id: str | None = None,
    ) -> Iterator[bytes]:
        """Stream speech audio chunks. Use for low-latency playback or piping."""
        return self._client.text_to_speech.stream(
            text=text,
            voice_id=voice_id or self.voice_id,
            model_id=self.model_id,
            output_format=DEFAULT_OUTPUT_FORMAT,
        )

    def stream_and_play(self, text: str, voice_id: str | None = None) -> None:
        """Stream speech and play in real-time (low latency)."""
        audio_stream = self.stream(text, voice_id=voice_id)
        play_stream(audio_stream)

    # -- async streaming -------------------------------------------------------

    async def astream(
        self,
        text: str,
        voice_id: str | None = None,
    ):
        """Async stream speech audio chunks."""
        return self._async_client.text_to_speech.stream(
            text=text,
            voice_id=voice_id or self.voice_id,
            model_id=self.model_id,
            output_format=DEFAULT_OUTPUT_FORMAT,
        )

    # -- utility ---------------------------------------------------------------

    def list_voices(self) -> list[dict]:
        """List available voices from the ElevenLabs account."""
        response = self._client.voices.search()
        return [
            {"name": v.name, "voice_id": v.voice_id}
            for v in response.voices
        ]
