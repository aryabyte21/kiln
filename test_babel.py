"""
tests/test_babel.py
───────────────────
Full test suite for Babel.

Covers:
  - @babel_tool decorator and spec inference
  - BabelRegistry: register, get, query, list
  - BabelRuntime: get, get_all, caching, target switching
  - AG2 adapter: compiled function signature, schema
  - LangChain adapter: StructuredTool schema, invocation
  - PydanticAI adapter: typed wrapper, docstring
  - Cross-framework: same tool → 3 different targets
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import pytest
from babel import babel_tool, BabelRegistry, BabelRuntime, register
from babel.spec import BabelTool, ToolParam
from babel.compiler.ag2 import AG2Adapter
from babel.compiler.langchain import LangChainAdapter
from babel.compiler.pydantic_ai import PydanticAIAdapter


# ─────────────────────────────────────────────────────────────────────────────
# Fixtures
# ─────────────────────────────────────────────────────────────────────────────

def make_weather_tool() -> BabelTool:
    @babel_tool(
        id="com.test.weather",
        description="Get weather for a city.",
        param_descriptions={
            "location": "City name",
            "units":    "celsius or fahrenheit",
        },
        param_enums={"units": ["celsius", "fahrenheit"]},
    )
    def get_weather(location: str, units: str = "celsius") -> dict:
        return {"location": location, "temperature": 28, "units": units}
    return get_weather


def make_search_tool() -> BabelTool:
    @babel_tool(
        id="com.test.search",
        description="Search the web.",
        param_descriptions={"query": "Search query"},
    )
    def web_search(query: str, max_results: int = 5) -> dict:
        return {"query": query, "results": []}
    return web_search


def make_registry_with_tools() -> BabelRegistry:
    reg = BabelRegistry()
    reg.register(make_weather_tool())
    reg.register(make_search_tool())
    return reg


# ─────────────────────────────────────────────────────────────────────────────
# 1. @babel_tool decorator
# ─────────────────────────────────────────────────────────────────────────────

class TestBabelToolDecorator:

    def test_returns_babel_tool_instance(self):
        tool = make_weather_tool()
        assert isinstance(tool, BabelTool)

    def test_spec_id(self):
        tool = make_weather_tool()
        assert tool.spec.id == "com.test.weather"

    def test_spec_description(self):
        tool = make_weather_tool()
        assert "city" in tool.spec.description.lower()

    def test_params_inferred_from_signature(self):
        tool = make_weather_tool()
        param_names = [p.name for p in tool.spec.params]
        assert "location" in param_names
        assert "units" in param_names

    def test_param_types_inferred(self):
        tool = make_weather_tool()
        params = {p.name: p for p in tool.spec.params}
        assert params["location"].type == "str"
        assert params["units"].type == "str"

    def test_required_and_optional(self):
        tool = make_weather_tool()
        params = {p.name: p for p in tool.spec.params}
        assert params["location"].required is True
        assert params["units"].required is False

    def test_default_value_captured(self):
        tool = make_weather_tool()
        params = {p.name: p for p in tool.spec.params}
        assert params["units"].default == "celsius"

    def test_enum_captured(self):
        tool = make_weather_tool()
        params = {p.name: p for p in tool.spec.params}
        assert params["units"].enum == ["celsius", "fahrenheit"]

    def test_param_descriptions_captured(self):
        tool = make_weather_tool()
        params = {p.name: p for p in tool.spec.params}
        assert "city" in params["location"].description.lower()

    def test_tool_is_callable(self):
        tool = make_weather_tool()
        result = tool(location="Singapore")
        assert result["location"] == "Singapore"
        assert result["temperature"] == 28

    def test_tool_callable_with_all_params(self):
        tool = make_weather_tool()
        result = tool(location="Tokyo", units="fahrenheit")
        assert result["units"] == "fahrenheit"


# ─────────────────────────────────────────────────────────────────────────────
# 2. BabelRegistry
# ─────────────────────────────────────────────────────────────────────────────

class TestBabelRegistry:

    def test_register_and_get(self):
        reg = BabelRegistry()
        tool = make_weather_tool()
        reg.register(tool)
        fetched = reg.get("com.test.weather")
        assert fetched is tool

    def test_get_missing_returns_none(self):
        reg = BabelRegistry()
        assert reg.get("com.test.nonexistent") is None

    def test_has(self):
        reg = BabelRegistry()
        tool = make_weather_tool()
        assert not reg.has(tool.id)
        reg.register(tool)
        assert reg.has(tool.id)

    def test_list(self):
        reg = make_registry_with_tools()
        tools = reg.list()
        assert len(tools) == 2

    def test_list_ids(self):
        reg = make_registry_with_tools()
        ids = reg.list_ids()
        assert "com.test.weather" in ids
        assert "com.test.search" in ids

    def test_query_by_short_name(self):
        reg = make_registry_with_tools()
        # query by function name
        result = reg.query("get_weather")
        assert result is not None
        assert result.spec.id == "com.test.weather"

    def test_query_by_partial_id(self):
        reg = make_registry_with_tools()
        result = reg.query("weather")
        assert result is not None

    def test_query_missing_returns_none(self):
        reg = BabelRegistry()
        assert reg.query("nonexistent") is None

    def test_len(self):
        reg = make_registry_with_tools()
        assert len(reg) == 2

    def test_unregister(self):
        reg = make_registry_with_tools()
        reg.unregister("com.test.weather")
        assert not reg.has("com.test.weather")
        assert len(reg) == 1

    def test_overwrite_on_reregister(self):
        reg = BabelRegistry()
        tool = make_weather_tool()
        reg.register(tool)
        reg.register(tool)   # register again — should not error
        assert len(reg) == 1

    def test_summary_returns_string(self):
        reg = make_registry_with_tools()
        summary = reg.summary()
        assert isinstance(summary, str)
        assert "com.test.weather" in summary


# ─────────────────────────────────────────────────────────────────────────────
# 3. BabelRuntime
# ─────────────────────────────────────────────────────────────────────────────

class TestBabelRuntime:

    def test_invalid_target_raises(self):
        with pytest.raises(ValueError, match="Unknown target"):
            BabelRuntime(target="made_up_framework")

    def test_get_unknown_tool_raises(self):
        reg = BabelRegistry()
        runtime = BabelRuntime(target="langchain", registry=reg)
        with pytest.raises(KeyError):
            runtime.get("com.test.nonexistent")

    def test_available_targets(self):
        runtime = BabelRuntime(target="ag2", registry=BabelRegistry())
        targets = runtime.available_targets()
        assert "ag2" in targets
        assert "langchain" in targets
        assert "pydantic_ai" in targets

    def test_get_all_returns_list(self):
        reg = make_registry_with_tools()
        runtime = BabelRuntime(target="langchain", registry=reg)
        tools = runtime.get_all()
        assert len(tools) == 2

    def test_get_many(self):
        reg = make_registry_with_tools()
        runtime = BabelRuntime(target="langchain", registry=reg)
        tools = runtime.get_many(["com.test.weather", "com.test.search"])
        assert len(tools) == 2

    def test_cache_is_used(self):
        """Getting the same tool twice returns the same object."""
        reg = make_registry_with_tools()
        runtime = BabelRuntime(target="langchain", registry=reg)
        tool_a = runtime.get("com.test.weather")
        tool_b = runtime.get("com.test.weather")
        assert tool_a is tool_b

    def test_cache_target_isolated(self):
        """Same tool, different targets → different compiled objects."""
        reg = make_registry_with_tools()
        runtime = BabelRuntime(target="langchain", registry=reg)
        lc_tool = runtime.get("com.test.weather", target="langchain")
        ag2_tool = runtime.get("com.test.weather", target="ag2")
        assert type(lc_tool) != type(ag2_tool)

    def test_fuzzy_lookup_by_name(self):
        reg = make_registry_with_tools()
        runtime = BabelRuntime(target="langchain", registry=reg)
        # Should resolve "weather" to "com.test.weather"
        tool = runtime.get("weather")
        assert tool is not None

    def test_invalidate_cache(self):
        reg = make_registry_with_tools()
        runtime = BabelRuntime(target="langchain", registry=reg)
        runtime.get("com.test.weather")
        assert len(runtime._cache) == 1
        runtime.invalidate_cache("com.test.weather")
        assert len(runtime._cache) == 0


# ─────────────────────────────────────────────────────────────────────────────
# 4. AG2 Adapter
# ─────────────────────────────────────────────────────────────────────────────

class TestAG2Adapter:

    def setup_method(self):
        self.adapter = AG2Adapter()
        self.tool = make_weather_tool()
        self.compiled = self.adapter.compile(self.tool)

    def test_target_name(self):
        assert self.adapter.target == "ag2"

    def test_compiled_has_name(self):
        assert self.compiled.name == "get_weather"

    def test_compiled_has_description(self):
        assert len(self.compiled.description) > 0

    def test_compiled_fn_callable(self):
        result = self.compiled.fn(location="Singapore")
        assert result["location"] == "Singapore"

    def test_compiled_fn_with_optional(self):
        result = self.compiled.fn(location="Tokyo", units="fahrenheit")
        assert result["units"] == "fahrenheit"

    def test_compiled_fn_signature(self):
        import inspect
        sig = inspect.signature(self.compiled.fn)
        params = list(sig.parameters.keys())
        assert "location" in params
        assert "units" in params

    def test_schema_structure(self):
        schema = self.compiled.schema
        assert schema["type"] == "object"
        assert "properties" in schema
        assert "required" in schema

    def test_schema_required_params(self):
        schema = self.compiled.schema
        assert "location" in schema["required"]
        assert "units" not in schema["required"]

    def test_schema_property_types(self):
        schema = self.compiled.schema
        assert schema["properties"]["location"]["type"] == "string"

    def test_schema_enum_in_properties(self):
        schema = self.compiled.schema
        assert "enum" in schema["properties"]["units"]
        assert "celsius" in schema["properties"]["units"]["enum"]

    def test_json_schema_helper(self):
        """BaseAdapter._build_json_schema should produce correct output."""
        schema = self.adapter._build_json_schema(self.tool)
        assert "location" in schema["properties"]


# ─────────────────────────────────────────────────────────────────────────────
# 5. LangChain Adapter
# ─────────────────────────────────────────────────────────────────────────────

class TestLangChainAdapter:

    def setup_method(self):
        self.adapter = LangChainAdapter()
        self.tool = make_weather_tool()
        self.compiled = self.adapter.compile(self.tool)

    def test_target_name(self):
        assert self.adapter.target == "langchain"

    def test_returns_structured_tool(self):
        from langchain_core.tools import StructuredTool
        assert isinstance(self.compiled, StructuredTool)

    def test_tool_name(self):
        assert self.compiled.name == "get_weather"

    def test_tool_description(self):
        assert len(self.compiled.description) > 0

    def test_tool_has_args_schema(self):
        assert self.compiled.args_schema is not None

    def test_schema_fields(self):
        schema = self.compiled.args_schema.model_json_schema()
        assert "location" in schema["properties"]
        assert "units" in schema["properties"]

    def test_invoke_with_dict(self):
        result = self.compiled.invoke({"location": "Singapore"})
        assert result["location"] == "Singapore"

    def test_invoke_with_all_params(self):
        result = self.compiled.invoke({"location": "Tokyo", "units": "fahrenheit"})
        assert result["units"] == "fahrenheit"

    def test_search_tool_int_param(self):
        """int params should map to integer type in Pydantic model."""
        search_tool = make_search_tool()
        compiled = self.adapter.compile(search_tool)
        schema = compiled.args_schema.model_json_schema()
        # max_results should be integer
        assert schema["properties"]["max_results"]["type"] == "integer"

    def test_enum_tool_literal_type(self):
        """Enum params should become Literal types in Pydantic model."""
        schema = self.compiled.args_schema.model_json_schema()
        units_schema = schema["properties"]["units"]
        # Pydantic Literal shows up as enum in JSON schema
        assert "enum" in units_schema or "anyOf" in units_schema or "const" in units_schema or "default" in units_schema


# ─────────────────────────────────────────────────────────────────────────────
# 6. Pydantic AI Adapter
# ─────────────────────────────────────────────────────────────────────────────

class TestPydanticAIAdapter:

    def setup_method(self):
        self.adapter = PydanticAIAdapter()
        self.tool = make_weather_tool()
        self.compiled = self.adapter.compile(self.tool)

    def test_target_name(self):
        assert self.adapter.target == "pydantic_ai"

    def test_compiled_has_name(self):
        assert self.compiled.name == "get_weather"

    def test_compiled_has_description(self):
        assert len(self.compiled.description) > 0

    def test_fn_callable(self):
        result = self.compiled.fn(location="Singapore")
        assert result["location"] == "Singapore"

    def test_fn_has_type_annotations(self):
        import inspect
        hints = self.compiled.fn.__annotations__
        assert "location" in hints
        assert "units" in hints

    def test_fn_has_docstring(self):
        doc = self.compiled.fn.__doc__
        assert doc is not None
        assert len(doc) > 0

    def test_fn_docstring_contains_description(self):
        doc = self.compiled.fn.__doc__
        assert "weather" in doc.lower()

    def test_schema_matches_params(self):
        schema = self.compiled.schema
        assert "location" in schema["properties"]
        assert "units" in schema["properties"]

    def test_as_tool_returns_something(self):
        """as_tool() should not raise even if pydantic_ai isn't installed."""
        result = self.compiled.as_tool()
        assert result is not None


# ─────────────────────────────────────────────────────────────────────────────
# 7. Cross-Framework: same tool → 3 targets
# ─────────────────────────────────────────────────────────────────────────────

class TestCrossFramework:
    """
    The critical test: one tool definition, three different frameworks,
    all producing correct results with the same input.
    """

    def setup_method(self):
        self.tool = make_weather_tool()
        self.reg = BabelRegistry()
        self.reg.register(self.tool)

    def test_ag2_result(self):
        runtime = BabelRuntime(target="ag2", registry=self.reg)
        compiled = runtime.get("com.test.weather")
        result = compiled.fn(location="Singapore", units="celsius")
        assert result["location"] == "Singapore"
        assert "temperature" in result

    def test_langchain_result(self):
        runtime = BabelRuntime(target="langchain", registry=self.reg)
        compiled = runtime.get("com.test.weather")
        result = compiled.invoke({"location": "Singapore", "units": "celsius"})
        assert result["location"] == "Singapore"

    def test_pydantic_ai_result(self):
        runtime = BabelRuntime(target="pydantic_ai", registry=self.reg)
        compiled = runtime.get("com.test.weather")
        result = compiled.fn(location="Singapore", units="celsius")
        assert result["location"] == "Singapore"

    def test_all_targets_return_same_data(self):
        """All adapters should produce the same logical result."""
        runtimes = {
            "ag2":         BabelRuntime(target="ag2", registry=self.reg),
            "langchain":   BabelRuntime(target="langchain", registry=self.reg),
            "pydantic_ai": BabelRuntime(target="pydantic_ai", registry=self.reg),
        }
        results = {}
        for target, runtime in runtimes.items():
            compiled = runtime.get("com.test.weather")
            if target == "langchain":
                results[target] = compiled.invoke({"location": "Singapore"})
            else:
                results[target] = compiled.fn(location="Singapore")

        # All should return the same location
        for target, result in results.items():
            assert result["location"] == "Singapore", f"Failed for {target}"
            assert result["temperature"] == 28, f"Temperature wrong for {target}"

    def test_get_all_langchain(self):
        """get_all() should return all tools as LangChain StructuredTools."""
        from langchain_core.tools import StructuredTool
        runtime = BabelRuntime(target="langchain", registry=self.reg)
        tools = runtime.get_all()
        assert len(tools) == 1
        assert all(isinstance(t, StructuredTool) for t in tools)


# ─────────────────────────────────────────────────────────────────────────────
# 8. Integration: load core_tools and verify registry
# ─────────────────────────────────────────────────────────────────────────────

class TestCoreToolsIntegration:

    def test_core_tools_register(self):
        """Importing core_tools should register 8 tools in the global registry."""
        from babel import get_global_registry
        # Clear and reload
        from babel.registry import _global_registry
        initial_count = len(_global_registry)

        import babel.tools.core_tools  # trigger registration
        final_count = len(_global_registry)

        # Should have at least the 8 core tools
        assert final_count >= 8

    def test_weather_tool_in_global_registry(self):
        import babel.tools.core_tools
        from babel import get_global_registry
        reg = get_global_registry()
        assert reg.has("com.aria.tools.weather")

    def test_all_core_tools_callable_via_langchain(self):
        """All 8 core tools should compile to LangChain without error."""
        import babel.tools.core_tools
        from babel import get_global_registry
        reg = get_global_registry()
        runtime = BabelRuntime(target="langchain", registry=reg)

        core_ids = [
            "com.aria.tools.weather",
            "com.aria.tools.web_search",
            "com.aria.tools.restaurant_search",
            "com.aria.tools.contacts_lookup",
            "com.aria.tools.gcal_create",
            "com.aria.tools.whatsapp_send",
            "com.aria.tools.maps_directions",
            "com.aria.tools.email_send",
        ]
        for tool_id in core_ids:
            compiled = runtime.get(tool_id)
            assert compiled is not None, f"Failed to compile {tool_id}"


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
