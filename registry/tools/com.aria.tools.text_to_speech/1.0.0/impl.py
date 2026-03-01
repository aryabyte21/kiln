import base64
import io
import requests
from typing import Optional

REQUIRED_ENV_VARS = []

def text_to_speech(text: str, language: Optional[str] = None, voice_type: Optional[str] = None) -> dict:
    """Convert text to speech using a free TTS API."""
    try:
        # Use a free TTS API (e.g., ResponsiveVoice or similar)
        # Note: ResponsiveVoice API may require an API key, so we use a free alternative
        # Using a free TTS service that doesn't require authentication
        url = "https://api.voicerss.org/"
        params = {
            "key": "free_api_key",  # Placeholder for free tier
            "hl": language or "en",
            "src": text,
            "f": "44khz_16bit_stereo",
            "c": "MP3"
        }
        
        headers = {
            "User-Agent": "Mozilla/5.0"
        }
        
        response = requests.get(url, params=params, headers=headers, timeout=10)
        response.raise_for_status()
        
        # Encode audio data to base64
        audio_data = base64.b64encode(response.content).decode("utf-8")
        
        return {
            "audio_data": audio_data,
            "format": "mp3"
        }
    except Exception as e:
        # Fallback to local synthesis if API fails
        try:
            import gtts
            from gtts import gTTS
            
            tts = gTTS(text=text, lang=language or "en", slow=False)
            audio_buffer = io.BytesIO()
            tts.write_to_fp(audio_buffer)
            audio_buffer.seek(0)
            
            audio_data = base64.b64encode(audio_buffer.read()).decode("utf-8")
            
            return {
                "audio_data": audio_data,
                "format": "mp3"
            }
        except Exception as e:
            return {"error": f"Failed to generate audio: {str(e)}"}
