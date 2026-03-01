"""
vibe_tool.app.config
--------------------
Settings via pydantic-settings, loaded from environment variables.
"""

from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Mistral API key — Vibe CLI reads MISTRAL_API_KEY from env automatically
    mistral_api_key: str = ""

    # Vibe CLI limits
    max_turns: int = 30
    max_price: float = 1.00

    # ARIA callback
    aria_webhook_url: str = "http://localhost:8765/vibe/callback"

    # Workspace base directory
    workspace_dir: str = "/tmp/vibe_workspace"

    # Log directory — mount this volume for external access
    log_dir: str = str(Path(__file__).resolve().parent.parent / "logs")

    model_config = {"env_prefix": "VIBE_"}


_settings: Settings | None = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings
