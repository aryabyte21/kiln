"""
babel.compiler.base
-------------------
Abstract base class for all Babel compiler adapters.

Each adapter takes a validated Babel spec dict + the implementation file path,
and compiles them into target-specific artifacts under dist/.
"""

from __future__ import annotations

import json
import yaml
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any

import jsonschema

# Path to the Babel JSON Schema (relative to this file)
_SCHEMA_PATH = Path(__file__).parent.parent / "spec" / "babel.schema.json"


class BabelAdapter(ABC):
    """Abstract base class for Babel compilation targets."""

    def __init__(self, schema_path: Path = _SCHEMA_PATH) -> None:
        with open(schema_path) as f:
            self._schema = json.load(f)

    # ------------------------------------------------------------------
    # Public helpers
    # ------------------------------------------------------------------

    def load_spec(self, spec_path: Path) -> dict[str, Any]:
        """Load a .babel.yaml file, validate it, and return the spec dict.

        Raises:
            FileNotFoundError: if spec_path does not exist.
            yaml.YAMLError: if the file is not valid YAML.
            jsonschema.ValidationError: if the spec fails schema validation.
        """
        with open(spec_path) as f:
            spec = yaml.safe_load(f)
        self.validate_spec(spec)
        return spec

    def validate_spec(self, spec: dict[str, Any]) -> None:
        """Validate a spec dict against the Babel JSON Schema.

        Raises:
            jsonschema.ValidationError: on first schema violation found.
        """
        jsonschema.validate(instance=spec, schema=self._schema)

    def compile_from_file(self, spec_path: Path, output_dir: Path) -> Path:
        """Convenience: load spec from file, resolve impl_path, compile.

        Args:
            spec_path:  Path to the .babel.yaml spec file.
            output_dir: Root dist/ directory. Output goes under
                        output_dir/<target>/<tool_id>/

        Returns:
            Path to the compiled output directory.
        """
        spec = self.load_spec(spec_path)
        impl_path = spec_path.parent / spec["implementation"]["entry_point"]
        return self.compile(spec, impl_path, output_dir)

    # ------------------------------------------------------------------
    # Abstract interface
    # ------------------------------------------------------------------

    @abstractmethod
    def compile(
        self,
        spec: dict[str, Any],
        impl_path: Path,
        output_dir: Path,
    ) -> Path:
        """Compile a validated Babel spec into target-specific artifacts.

        Args:
            spec:       Validated Babel spec dict (already passed validate_spec).
            impl_path:  Absolute path to the implementation .py file.
            output_dir: Root dist/ directory.

        Returns:
            Path to the directory containing compiled artifacts.
        """

    @property
    @abstractmethod
    def target_name(self) -> str:
        """Identifier string for this target (e.g. 'ag2', 'raw_python')."""

    # ------------------------------------------------------------------
    # Shared helpers for subclasses
    # ------------------------------------------------------------------

    @staticmethod
    def _babel_type_to_json_schema(param: dict[str, Any]) -> dict[str, Any]:
        """Convert a Babel parameter descriptor to a JSON Schema property dict."""
        type_map = {
            "string": "string",
            "integer": "integer",
            "float": "number",
            "boolean": "boolean",
            "array": "array",
            "object": "object",
            "enum": "string",  # enum is string-constrained
        }
        result: dict[str, Any] = {"type": type_map[param["type"]]}
        if "description" in param:
            result["description"] = param["description"]
        if param["type"] == "enum" and "values" in param:
            result["enum"] = param["values"]
        if param["type"] == "array" and "items" in param:
            items = param["items"]
            if isinstance(items, str):
                result["items"] = {"type": type_map.get(items, "string")}
            elif isinstance(items, dict):
                result["items"] = BabelAdapter._babel_type_to_json_schema(items)
        return result

    @staticmethod
    def _build_openai_tool_schema(spec: dict[str, Any]) -> dict[str, Any]:
        """Build an OpenAI-compatible tool schema dict from a Babel spec.

        This format is understood by AG2 / LiteLLM for LLM-side tool registration.
        """
        properties: dict[str, Any] = {}
        required: list[str] = []

        for param in spec["interface"]["inputs"]:
            properties[param["name"]] = BabelAdapter._babel_type_to_json_schema(param)
            if param.get("required", True) and "default" not in param:
                required.append(param["name"])

        return {
            "type": "function",
            "function": {
                "name": spec["id"].split(".")[-1],  # last segment as short name
                "description": spec["description"],
                "parameters": {
                    "type": "object",
                    "properties": properties,
                    "required": required,
                },
            },
        }

    @staticmethod
    def _build_python_signature(spec: dict[str, Any]) -> str:
        """Build a Python function signature string from a Babel spec."""
        py_type_map = {
            "string": "str",
            "integer": "int",
            "float": "float",
            "boolean": "bool",
            "enum": "str",
            "array": "list",
            "object": "dict",
        }
        args = []
        for param in spec["interface"]["inputs"]:
            py_type = py_type_map.get(param["type"], "Any")
            if "default" in param:
                default = param["default"]
                if isinstance(default, str):
                    default_str = f'"{default}"'
                else:
                    default_str = repr(default)
                args.append(f'{param["name"]}: {py_type} = {default_str}')
            elif not param.get("required", True):
                args.append(f'{param["name"]}: {py_type} = None')
            else:
                args.append(f'{param["name"]}: {py_type}')

        fn_name = spec["id"].split(".")[-1]
        return f"def {fn_name}({', '.join(args)}) -> dict:"
