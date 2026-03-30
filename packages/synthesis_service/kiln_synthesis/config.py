"""
kiln_synthesis.config
--------------------
Settings via pydantic-settings, loaded from environment variables.

Env var mapping (prefix: KILN_SYNTHESIS_):
  KILN_SYNTHESIS_CALLBACK_URL      → callback_url
  KILN_SYNTHESIS_INTERNAL_SECRET   → internal_secret
  KILN_SYNTHESIS_WORKSPACE_DIR     → workspace_dir
  KILN_SYNTHESIS_LOG_DIR           → log_dir
  KILN_SYNTHESIS_MAX_TURNS         → max_turns
  KILN_SYNTHESIS_MAX_PRICE         → max_price

Special: MISTRAL_API_KEY is read without prefix (shared with Vibe CLI).
"""

from __future__ import annotations

import os

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
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

    @property
    def mistral_api_key(self) -> str:
        """Read MISTRAL_API_KEY directly from env (no prefix — shared with Vibe CLI)."""
        return os.environ.get("MISTRAL_API_KEY", "")


_settings: Settings | None = None


def get_settings() -> Settings:
    global _settings  # noqa: PLW0603
    if _settings is None:
        _settings = Settings()
    return _settings
