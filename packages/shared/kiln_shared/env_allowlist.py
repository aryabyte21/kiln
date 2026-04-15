"""Curated list of environment variable names Kiln tools may declare.

A tool's ``implementation.required_env_vars`` entries must all be members of
this set. This prevents a malicious tool from declaring `AWS_SECRET_ACCESS_KEY`
or similarly sensitive names and fishing for them in users' saved env vars.

Adding a provider is a one-line change in this file, reviewed like any other
registry-side code change — it is not something a tool author can request via
the MCP.
"""

from __future__ import annotations

import re

PROVIDER_ENV_ALLOWLIST: frozenset[str] = frozenset({
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "MISTRAL_API_KEY",
    "GEMINI_API_KEY",
    "GROQ_API_KEY",
    "COHERE_API_KEY",
    "HUGGINGFACE_API_KEY",
    "REPLICATE_API_TOKEN",
    "STRIPE_SECRET_KEY",
    "SERPAPI_API_KEY",
    "TAVILY_API_KEY",
    "BRAVE_API_KEY",
    "GITHUB_TOKEN",
    "SLACK_BOT_TOKEN",
    "NOTION_API_KEY",
    "LINEAR_API_KEY",
    "ELEVENLABS_API_KEY",
    "RESEND_API_KEY",
    "SENDGRID_API_KEY",
})

ENV_VAR_NAME_RE = re.compile(r"^[A-Z][A-Z0-9_]*$")


class DisallowedEnvVarError(ValueError):
    """Raised when a declared env var is not in ``PROVIDER_ENV_ALLOWLIST``."""


def validate_env_var_name(name: str) -> None:
    """Reject names that aren't upper-snake or aren't on the allowlist.

    Raises ``DisallowedEnvVarError`` with a message listing the supported names
    so the caller can surface it to the user directly.
    """
    if not isinstance(name, str) or not ENV_VAR_NAME_RE.match(name):
        raise DisallowedEnvVarError(
            f"env var name must match ^[A-Z][A-Z0-9_]*$, got {name!r}"
        )
    if name not in PROVIDER_ENV_ALLOWLIST:
        raise DisallowedEnvVarError(
            f"{name!r} is not in the Kiln provider allowlist. "
            f"Supported: {sorted(PROVIDER_ENV_ALLOWLIST)}"
        )
