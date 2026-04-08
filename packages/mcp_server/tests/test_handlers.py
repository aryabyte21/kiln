"""Tests for the pure-function pieces of the MCP server.

The interesting bridge logic is the spec-to-schema translator and the
dynamic tool handler builder. Both are pure: no HTTP, no FastMCP server,
no clients required. The streaming/HTTP transport layer is exercised by
the Puppeteer e2e suite (Phase 4) once it's wired up.
"""

from __future__ import annotations

import asyncio

import pytest

from kiln_mcp.main import _build_mcp_tool_schema, _make_tool_handler


# ── _build_mcp_tool_schema ───────────────────────────────────────────────────


def test_empty_params_yields_empty_schema() -> None:
    schema = _build_mcp_tool_schema({"params": []})
    assert schema == {"type": "object", "properties": {}, "required": []}


def test_single_required_string_param() -> None:
    spec = {
        "params": [
            {"name": "city", "type": "str", "description": "City name", "required": True}
        ]
    }
    schema = _build_mcp_tool_schema(spec)
    assert schema["type"] == "object"
    assert schema["properties"] == {
        "city": {"type": "string", "description": "City name"}
    }
    assert schema["required"] == ["city"]


def test_kiln_type_to_jsonschema_type_mapping() -> None:
    """Every supported Kiln type must map to the right JSON Schema type."""
    spec = {
        "params": [
            {"name": "s", "type": "str"},
            {"name": "i", "type": "int"},
            {"name": "f", "type": "float"},
            {"name": "b", "type": "bool"},
            {"name": "l", "type": "list"},
            {"name": "d", "type": "dict"},
        ]
    }
    schema = _build_mcp_tool_schema(spec)
    assert schema["properties"]["s"]["type"] == "string"
    assert schema["properties"]["i"]["type"] == "integer"
    assert schema["properties"]["f"]["type"] == "number"
    assert schema["properties"]["b"]["type"] == "boolean"
    assert schema["properties"]["l"]["type"] == "array"
    assert schema["properties"]["d"]["type"] == "object"


def test_unknown_type_falls_back_to_string() -> None:
    """An unknown Kiln type must not crash — fall back to string."""
    spec = {"params": [{"name": "weird", "type": "totally_made_up"}]}
    schema = _build_mcp_tool_schema(spec)
    assert schema["properties"]["weird"]["type"] == "string"


def test_enum_param_includes_enum_in_schema() -> None:
    spec = {
        "params": [
            {"name": "size", "type": "str", "enum": ["small", "medium", "large"]}
        ]
    }
    schema = _build_mcp_tool_schema(spec)
    assert schema["properties"]["size"]["enum"] == ["small", "medium", "large"]


def test_default_value_is_propagated() -> None:
    spec = {
        "params": [
            {"name": "units", "type": "str", "default": "celsius"}
        ]
    }
    schema = _build_mcp_tool_schema(spec)
    assert schema["properties"]["units"]["default"] == "celsius"


def test_required_field_defaults_to_true_when_omitted() -> None:
    """When ``required`` is omitted, the param is treated as required.

    This matches the iter-23 prompt_builder convention and pins the
    "missing key = required" contract so a future change can't silently
    flip the default.
    """
    spec = {"params": [{"name": "p1", "type": "str"}]}
    schema = _build_mcp_tool_schema(spec)
    assert "p1" in schema["required"]


def test_optional_field_excluded_from_required_list() -> None:
    spec = {
        "params": [
            {"name": "name", "type": "str", "required": True},
            {"name": "nickname", "type": "str", "required": False},
        ]
    }
    schema = _build_mcp_tool_schema(spec)
    assert "name" in schema["required"]
    assert "nickname" not in schema["required"]


# ── _make_tool_handler ───────────────────────────────────────────────────────


def test_make_tool_handler_returns_named_async_callable() -> None:
    """The dynamically built handler must be an async function with the right name."""
    spec = {
        "name": "weather",
        "description": "Get the weather",
        "params": [{"name": "city", "type": "str", "required": True}],
    }
    handler = _make_tool_handler("com.kiln.tools.weather", spec)

    assert callable(handler)
    assert handler.__name__ == "weather"
    assert handler.__doc__ == "Get the weather"
    assert asyncio.iscoroutinefunction(handler)


def test_make_tool_handler_signature_matches_params() -> None:
    """The built function exposes the param names in its signature.

    FastMCP introspects the signature to generate the JSON schema, so a
    regression here would silently break tool discovery for MCP clients.
    """
    import inspect

    spec = {
        "name": "convert",
        "description": "Currency conversion",
        "params": [
            {"name": "amount", "type": "float", "required": True},
            {"name": "from_currency", "type": "str", "required": True},
            {"name": "to_currency", "type": "str", "required": False, "default": "USD"},
        ],
    }
    handler = _make_tool_handler("com.kiln.tools.convert", spec)
    sig = inspect.signature(handler)

    assert list(sig.parameters.keys()) == ["amount", "from_currency", "to_currency"]
    assert sig.parameters["to_currency"].default == "USD"
