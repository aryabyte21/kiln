"""
kiln_synthesis.config
--------------------
Settings via pydantic-settings, loaded from environment variables.

Env var mapping (prefix: KILN_SYNTHESIS_):
  KILN_SYNTHESIS_CALLBACK_URL      → callback_url
  KILN_SYNTHESIS_INTERNAL_SECRET   → internal_secret
  KILN_SYNTHESIS_WORKSPACE_DIR     → workspace_dir
  KILN_SYNTHESIS_LOG_DIR           → log_dir
  KILN_SYNTHESIS_OPENCODE_MODEL    → opencode_model
  KILN_SYNTHESIS_OPENCODE_TIMEOUT  → opencode_timeout

Provider API keys (e.g. OPENAI_API_KEY) are read by OpenCode from its own config.
"""

from __future__ import annotations

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # OpenCode model identifier (provider/model format)
    opencode_model: str = "mistral/codestral-latest"

    # Timeout in seconds for the entire OpenCode process (cost/runaway guard)
    opencode_timeout: int = 600

    # Kiln registry callback URL for tool registration after synthesis
    callback_url: str = "http://host.docker.internal:8766/synthesis/callback"

    # Service-to-service auth secret (sent as X-Internal-Secret header on callbacks)
    internal_secret: str = ""

    # Workspace base directory for OpenCode CLI
    workspace_dir: str = "/tmp/opencode_workspace"

    # Log directory — mount this volume for external access
    log_dir: str = "/app/logs"

    model_config = {"env_prefix": "KILN_SYNTHESIS_"}


_settings: Settings | None = None


def get_settings() -> Settings:
    global _settings  # noqa: PLW0603
    if _settings is None:
        _settings = Settings()
    return _settings
