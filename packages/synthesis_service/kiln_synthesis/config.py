"""
kiln_synthesis.config
--------------------
Settings via pydantic-settings, loaded from environment variables.
"""

from __future__ import annotations

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Mistral API key — also read by Vibe CLI from MISTRAL_API_KEY directly
    mistral_api_key: str = ""

    # Vibe CLI limits
    max_turns: int = 50
    max_price: float = 2.00

    # Kiln registry callback URL for tool registration after synthesis
    callback_url: str = "http://host.docker.internal:8766/synthesis/callback"

    # Service-to-service auth secret (sent as X-Internal-Secret header on callbacks)
    internal_secret: str = ""

    # Workspace base directory for Vibe CLI
    workspace_dir: str = "/tmp/vibe_workspace"

    # Log directory — mount this volume for external access
    log_dir: str = "/app/logs"

    model_config = {"env_prefix": "KILN_SYNTHESIS_"}


_settings: Settings | None = None


def get_settings() -> Settings:
    global _settings  # noqa: PLW0603
    if _settings is None:
        _settings = Settings()
    return _settings
