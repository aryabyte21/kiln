"""Quick smoke test for both voice modules: TTS → audio file → STT."""

import os
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

from elevenlabs_tts import ElevenLabsTTS
from voxtral_stt import VoxtralSTT


def main():
    test_text = "Hello, this is Babel. The adaptive runtime intelligence architecture."
    output_dir = Path(__file__).resolve().parents[2] / "tmp"
    output_dir.mkdir(exist_ok=True)
    audio_path = output_dir / "tts_test.mp3"

    # --- TTS test ---
    print("=== ElevenLabs TTS Test ===")
    tts = ElevenLabsTTS()
    print(f"Voice: {tts.voice_id} | Model: {tts.model_id}")
    print(f"Generating speech: \"{test_text}\"")

    tts.synthesize_to_file(test_text, audio_path)
    size_kb = audio_path.stat().st_size / 1024
    print(f"Saved: {audio_path} ({size_kb:.1f} KB)")

    # --- STT test ---
    print("\n=== Voxtral STT Test ===")
    stt = VoxtralSTT()
    print(f"Transcribing: {audio_path}")

    transcript = stt.transcribe_file(audio_path)
    print(f"Transcript: \"{transcript}\"")

    # --- Round-trip check ---
    print("\n=== Round-Trip ===")
    print(f"Original:    \"{test_text}\"")
    print(f"Transcribed: \"{transcript}\"")
    match = test_text.lower().split()
    recovered = transcript.lower().split()
    overlap = len(set(match) & set(recovered)) / len(set(match)) * 100
    print(f"Word overlap: {overlap:.0f}%")
    print("PASS" if overlap > 70 else "FAIL")


if __name__ == "__main__":
    main()
