"""
vibe_tool.app.config
--------------------
Settings via pydantic-settings, loaded from environment variables.
"""

from __future__ import annotations

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Mistral API key — Vibe CLI reads MISTRAL_API_KEY from env automatically
    mistral_api_key: str = ""

    # Vibe CLI limits
    max_turns: int = 50
    max_price: float = 2.00

    # ARIA callback — default uses host.docker.internal for Docker;
    # override with VIBE_ARIA_WEBHOOK_URL=http://localhost:8765/vibe/callback for local dev
    aria_webhook_url: str = "http://host.docker.internal:8765/vibe/callback"

    # Workspace base directory
    workspace_dir: str = "/tmp/vibe_workspace"

    # Log directory — mount this volume for external access
    log_dir: str = "/app/logs"

    model_config = {"env_prefix": "VIBE_"}


_settings: Settings | None = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings
