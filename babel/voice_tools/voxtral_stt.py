"""Voxtral Mini STT client for Babel.

Handles speech-to-text transcription using Mistral's Voxtral Mini model.
Supports file upload, URL-based, and realtime streaming transcription.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import AsyncIterator

from mistralai import Mistral
from mistralai.models import (
    AudioFormat,
    RealtimeTranscriptionSessionCreated,
    TranscriptionStreamTextDelta,
    TranscriptionStreamDone,
    RealtimeTranscriptionError,
)

BATCH_MODEL = "voxtral-mini-latest"
REALTIME_MODEL = "voxtral-mini-transcribe-realtime-2602"

SUPPORTED_FORMATS = {".mp3", ".wav", ".m4a", ".flac", ".ogg"}


class VoxtralSTT:
    """Speech-to-text using Voxtral Mini via the Mistral API."""

    def __init__(self, api_key: str | None = None):
        self._api_key = api_key or os.environ["MISTRAL_API_KEY"]
        self._client = Mistral(api_key=self._api_key)

    # -- batch transcription --------------------------------------------------

    def transcribe_file(
        self,
        file_path: str | Path,
        language: str | None = "en",
        diarize: bool = False,
    ) -> str:
        """Transcribe a local audio file. Returns the full transcript text."""
        file_path = Path(file_path)
        if file_path.suffix.lower() not in SUPPORTED_FORMATS:
            raise ValueError(
                f"Unsupported format {file_path.suffix}. "
                f"Use one of: {', '.join(sorted(SUPPORTED_FORMATS))}"
            )

        with open(file_path, "rb") as f:
            result = self._client.audio.transcriptions.complete(
                model=BATCH_MODEL,
                file={"content": f, "file_name": file_path.name},
                **({"language": language} if language else {}),
                diarize=diarize,
            )
        return result.text

    def transcribe_url(
        self,
        url: str,
        language: str | None = "en",
        diarize: bool = False,
    ) -> str:
        """Transcribe audio from a remote URL."""
        result = self._client.audio.transcriptions.complete(
            model=BATCH_MODEL,
            file_url=url,
            **({"language": language} if language else {}),
            diarize=diarize,
        )
        return result.text

    # -- realtime streaming ----------------------------------------------------

    async def transcribe_stream(
        self,
        audio_stream: AsyncIterator[bytes],
        sample_rate: int = 16000,
        target_delay_ms: int = 240,
    ) -> AsyncIterator[str]:
        """Stream live audio and yield transcript text deltas.

        Args:
            audio_stream: Async iterator yielding raw PCM s16le audio chunks.
            sample_rate: Sample rate of the audio (default 16000 Hz).
            target_delay_ms: Target streaming latency in ms.

        Yields:
            Transcript text fragments as they arrive.
        """
        audio_format = AudioFormat(encoding="pcm_s16le", sample_rate=sample_rate)

        async for event in self._client.audio.realtime.transcribe_stream(
            audio_stream=audio_stream,
            model=REALTIME_MODEL,
            audio_format=audio_format,
            target_streaming_delay_ms=target_delay_ms,
        ):
            if isinstance(event, TranscriptionStreamTextDelta):
                yield event.text
            elif isinstance(event, RealtimeTranscriptionSessionCreated):
                continue
            elif isinstance(event, TranscriptionStreamDone):
                break
            elif isinstance(event, RealtimeTranscriptionError):
                raise RuntimeError(f"Voxtral realtime error: {event}")
