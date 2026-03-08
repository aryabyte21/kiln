import base64
import os
import tempfile
from typing import Optional

REQUIRED_ENV_VARS = [
    {"name": "ELEVENLABS_API_KEY", "description": "ElevenLabs API key for text-to-speech synthesis"}
]

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

DEFAULT_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb"  # George
DEFAULT_MODEL = "eleven_multilingual_v2"


def text_to_speech(text: str, language: Optional[str] = None, voice_type: Optional[str] = None) -> dict:
    """Convert text to speech using ElevenLabs API."""
    try:
        from elevenlabs.client import ElevenLabs
        from elevenlabs import VoiceSettings

        api_key = os.environ["ELEVENLABS_API_KEY"]
        client = ElevenLabs(api_key=api_key)

        # Map voice_type to a preset voice ID
        voice_id = VOICES.get((voice_type or "").lower(), DEFAULT_VOICE_ID)

        audio_iter = client.text_to_speech.convert(
            text=text,
            voice_id=voice_id,
            model_id=DEFAULT_MODEL,
            output_format="mp3_44100_128",
            voice_settings=VoiceSettings(
                stability=0.71,
                similarity_boost=0.5,
            ),
        )
        audio_bytes = b"".join(audio_iter)

        # Save to temp file for UI playback via /audio endpoint
        tmp = tempfile.NamedTemporaryFile(suffix=".mp3", delete=False)
        tmp.write(audio_bytes)
        tmp.close()

        # Also provide base64 for other consumers
        audio_data = base64.b64encode(audio_bytes).decode("utf-8")

        return {
            "audio_data": audio_data,
            "format": "mp3",
            "file_path": tmp.name
        }
    except Exception as e:
        return {"error": f"Failed to generate audio: {str(e)}"}
