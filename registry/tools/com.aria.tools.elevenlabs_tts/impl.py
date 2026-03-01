"""
impl.py — ElevenLabs Text-to-Speech Babel tool
───────────────────────────────────────────────
Calls the ElevenLabs /v1/text-to-speech endpoint and saves
the resulting audio to a local file.
"""

import os
import requests


ELEVENLABS_API_KEY = "sk_3088c01b1db43c4ae7bdf4c69b35cbe63cc0c1bd795e5daf"
BASE_URL = "https://api.elevenlabs.io/v1/text-to-speech"


def elevenlabs_tts(
    text: str,
    voice_id: str = "JBFqnCBsd6RMkjVDRZzb",
    output_path: str = "output_audio.mp3",
    model_id: str = "eleven_monolingual_v1",
) -> dict:
    url = f"{BASE_URL}/{voice_id}"

    headers = {
        "xi-api-key": ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
    }

    payload = {
        "text": text,
        "model_id": model_id,
        "voice_settings": {
            "stability": 0.5,
            "similarity_boost": 0.75,
        },
    }

    try:
        response = requests.post(url, headers=headers, json=payload, timeout=30)

        if response.status_code != 200:
            return {
                "file_path": "",
                "characters_used": 0,
                "success": False,
                "error": f"ElevenLabs API error {response.status_code}: {response.text}",
            }

        abs_path = os.path.abspath(output_path)
        with open(abs_path, "wb") as f:
            f.write(response.content)

        return {
            "file_path": abs_path,
            "characters_used": len(text),
            "success": True,
            "error": "",
        }

    except Exception as e:
        return {
            "file_path": "",
            "characters_used": 0,
            "success": False,
            "error": str(e),
        }
