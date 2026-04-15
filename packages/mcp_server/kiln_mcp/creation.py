from __future__ import annotations

import ast
import logging
import os
import re
from typing import Any

import httpx
import yaml

from kiln_shared.httpx_client import async_client

logger = logging.getLogger(__name__)

REGISTRY_URL = os.environ.get("KILN_REGISTRY_URL", "http://localhost:8766")

TOOL_ID_RE = re.compile(r"^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,}$")
PY_IDENT_RE = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")

_PY_TO_JSON = {
    "str": "string",
    "int": "integer",
    "float": "number",
    "bool": "boolean",
    "list": "array",
    "dict": "object",
}
_JSON_TYPES = set(_PY_TO_JSON.values())
_SUPPORTED_TYPES = set(_PY_TO_JSON.keys()) | _JSON_TYPES


class ToolCreationError(ValueError):
    pass


def _canonical_type(value: str, *, field: str) -> str:
    if value in _JSON_TYPES:
        return value
    if value in _PY_TO_JSON:
        return _PY_TO_JSON[value]
    raise ToolCreationError(
        f"{field}: type must be one of {sorted(_JSON_TYPES)} (or Python aliases "
        f"{sorted(_PY_TO_JSON)}), got {value!r}"
    )


def _validate_params(params: list[dict[str, Any]]) -> list[dict[str, Any]]:
    cleaned: list[dict[str, Any]] = []
    seen: set[str] = set()
    for raw in params:
        if not isinstance(raw, dict):
            raise ToolCreationError(f"each param must be an object, got {type(raw).__name__}")
        name = raw.get("name")
        if not isinstance(name, str) or not PY_IDENT_RE.match(name):
            raise ToolCreationError(f"param name must be a valid python identifier, got {name!r}")
        if name in seen:
            raise ToolCreationError(f"duplicate param name: {name}")
        seen.add(name)

        ptype = _canonical_type(raw.get("type", "string"), field=f"param {name}")

        required = raw.get("required", True)
        if not isinstance(required, bool):
            raise ToolCreationError(
                f"param {name}: required must be a boolean, got {type(required).__name__} "
                f"({required!r}) — strings like 'false' are rejected on purpose"
            )

        entry: dict[str, Any] = {
            "name": name,
            "type": ptype,
            "description": str(raw.get("description", "")),
            "required": required,
        }
        if raw.get("default") is not None:
            entry["default"] = raw["default"]
        if raw.get("enum"):
            if not isinstance(raw["enum"], list) or not all(isinstance(x, str) for x in raw["enum"]):
                raise ToolCreationError(f"param {name}: enum must be a list of strings")
            entry["enum"] = list(raw["enum"])
        cleaned.append(entry)
    return cleaned


def _normalize_output(returns: dict[str, Any] | None) -> dict[str, Any]:
    if returns is None:
        return {"name": "result", "type": "object"}
    out_name = returns.get("name", "result")
    out_type = _canonical_type(returns.get("type", "object"), field="returns")
    entry = {"name": out_name, "type": out_type}
    if returns.get("description"):
        entry["description"] = str(returns["description"])
    return entry


def build_spec_yaml(
    *,
    tool_id: str,
    name: str,
    description: str,
    params: list[dict[str, Any]],
    returns: dict[str, Any] | None,
    dependencies: list[str] | None,
    version: str,
    author: str,
    tags: list[str] | None,
    category: str,
) -> str:
    if not TOOL_ID_RE.match(tool_id):
        raise ToolCreationError(
            f"tool_id must be dotted-lowercase like com.kiln.tools.my_tool, got {tool_id!r}"
        )
    if not PY_IDENT_RE.match(name):
        raise ToolCreationError(f"name must be a valid python identifier, got {name!r}")
    stripped = description.strip()
    if len(stripped) < 10:
        raise ToolCreationError(
            "description must be at least 10 characters; write a clear sentence "
            "so the LLM knows when to call this tool"
        )

    spec = {
        "kiln_version": "1.0",
        "tool": {
            "id": tool_id,
            "name": name,
            "version": version,
            "description": stripped,
            "author": author,
        },
        "interface": {
            "inputs": _validate_params(params),
            "outputs": [_normalize_output(returns)],
        },
        "implementation": {
            "runtime": "python3.10",
            "entrypoint": f"{name}.py",
            "dependencies": list(dependencies or []),
        },
        "metadata": {
            "tags": list(tags or []),
            "category": category,
            "generated_by": "mcp_client",
        },
    }
    return yaml.safe_dump(spec, sort_keys=False)


def validate_impl_defines_function(impl_code: str, function_name: str) -> None:
    if not impl_code.strip():
        raise ToolCreationError("impl_code must not be empty")
    try:
        tree = ast.parse(impl_code)
    except SyntaxError as exc:
        raise ToolCreationError(
            f"impl_code has a Python syntax error: {exc.msg} (line {exc.lineno})"
        ) from exc
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == function_name:
            return
    raise ToolCreationError(
        f"impl_code must define a top-level function named {function_name!r} "
        f"(class methods and nested defs don't count)"
    )


async def submit_to_registry(
    *,
    spec_yaml: str,
    impl_code: str,
    entrypoint: str,
    user_id: str | None,
) -> dict[str, Any]:
    internal_secret = os.environ.get("KILN_INTERNAL_SECRET", "")
    if not internal_secret:
        raise ToolCreationError(
            "KILN_INTERNAL_SECRET not configured on the MCP server; cannot authenticate to the registry"
        )

    headers = {"X-Internal-Secret": internal_secret}
    if user_id:
        headers["X-Kiln-User-ID"] = user_id

    files = {
        "spec_file": ("spec.yaml", spec_yaml.encode("utf-8"), "application/x-yaml"),
        "impl_file": (entrypoint, impl_code.encode("utf-8"), "text/x-python"),
    }

    try:
        async with async_client(timeout=60) as client:
            resp = await client.post(
                f"{REGISTRY_URL}/tools/register",
                files=files,
                headers=headers,
            )
    except httpx.TimeoutException as exc:
        raise ToolCreationError(
            f"registry timed out after 60s while validating the tool "
            f"(fixtures may be too slow): {exc}"
        ) from exc
    except httpx.RequestError as exc:
        raise ToolCreationError(
            f"registry unreachable at {REGISTRY_URL}: {exc}"
        ) from exc

    if resp.status_code >= 400:
        detail: Any
        try:
            detail = resp.json().get("detail", resp.text)
        except Exception:
            detail = resp.text
        raise ToolCreationError(f"registry rejected tool: {detail}")

    try:
        return resp.json()
    except ValueError as exc:
        raise ToolCreationError(
            f"registry returned a non-JSON response (status {resp.status_code}): "
            f"{resp.text[:200]}"
        ) from exc
