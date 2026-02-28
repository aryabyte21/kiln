"""
test_e2.py
----------
Unit tests for Engineer 2 — Babel Tool Standard.

Covers:
  1. Schema validation (good + bad specs)
  2. BabelAdapter shared helpers
  3. AG2Adapter compiler output
  4. RawPythonAdapter compiler output
  5. LocalRegistry (publish, query, list, get, hit_rate, events)
  6. BabelRuntime (load, LRU cache, cache info)
  7. Pre-built tool implementations (weather + maps_directions)
  8. CLI commands (validate, compile, publish, registry list/stats)

Run with:
    python test_e2.py
    python -m pytest test_e2.py -v
"""

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

# Ensure project root is on path
PROJECT_ROOT = Path(__file__).parent
sys.path.insert(0, str(PROJECT_ROOT))

import yaml

# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────

WEATHER_SPEC_PATH = PROJECT_ROOT / "tools" / "weather" / "spec.yaml"
MAPS_SPEC_PATH = PROJECT_ROOT / "tools" / "maps_directions" / "spec.yaml"
SCHEMA_PATH = PROJECT_ROOT / "babel" / "spec" / "babel.schema.json"

SAMPLE_SPECS = list((PROJECT_ROOT / "babel" / "spec" / "samples").glob("*.yaml"))


def load_impl(path: Path):
    """Dynamically import an impl.py and return the module."""
    spec = importlib.util.spec_from_file_location("_test_impl", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# ──────────────────────────────────────────────────────────────────────────────
# 1. Schema Validation
# ──────────────────────────────────────────────────────────────────────────────

class TestSchemaValidation(unittest.TestCase):

    def setUp(self):
        from babel_registry.compiler.adapters.ag2_adapter import AG2Adapter
        self.adapter = AG2Adapter()

    def _load(self, path):
        with open(path) as f:
            return yaml.safe_load(f)

    def test_weather_spec_valid(self):
        spec = self._load(WEATHER_SPEC_PATH)
        self.adapter.validate_spec(spec)  # must not raise

    def test_maps_spec_valid(self):
        spec = self._load(MAPS_SPEC_PATH)
        self.adapter.validate_spec(spec)

    def test_all_sample_specs_valid(self):
        self.assertGreaterEqual(len(SAMPLE_SPECS), 3, "Expected at least 3 sample specs")
        for path in SAMPLE_SPECS:
            with self.subTest(spec=path.name):
                spec = self._load(path)
                self.adapter.validate_spec(spec)

    def test_missing_required_field_raises(self):
        import jsonschema
        bad = {
            "babel_version": "1.0",
            "id": "com.aria.tools.bad",
            # missing: name, description, interface, implementation, execution
        }
        with self.assertRaises(jsonschema.ValidationError):
            self.adapter.validate_spec(bad)

    def test_invalid_id_format_raises(self):
        import jsonschema
        with open(WEATHER_SPEC_PATH) as f:
            spec = yaml.safe_load(f)
        spec["id"] = "BAD ID WITH SPACES"
        with self.assertRaises(jsonschema.ValidationError):
            self.adapter.validate_spec(spec)

    def test_invalid_babel_version_raises(self):
        import jsonschema
        with open(WEATHER_SPEC_PATH) as f:
            spec = yaml.safe_load(f)
        spec["babel_version"] = "not-a-version"
        with self.assertRaises(jsonschema.ValidationError):
            self.adapter.validate_spec(spec)

    def test_invalid_type_in_inputs_raises(self):
        import jsonschema
        with open(WEATHER_SPEC_PATH) as f:
            spec = yaml.safe_load(f)
        spec["interface"]["inputs"][0]["type"] = "unknown_type"
        with self.assertRaises(jsonschema.ValidationError):
            self.adapter.validate_spec(spec)


# ──────────────────────────────────────────────────────────────────────────────
# 2. BabelAdapter Shared Helpers
# ──────────────────────────────────────────────────────────────────────────────

class TestBabelAdapterHelpers(unittest.TestCase):

    def setUp(self):
        from babel_registry.compiler.adapters.ag2_adapter import AG2Adapter
        self.adapter = AG2Adapter()

    def test_babel_type_to_json_schema_string(self):
        from babel_registry.compiler.base import BabelAdapter
        result = BabelAdapter._babel_type_to_json_schema({"name": "x", "type": "string", "description": "a str"})
        self.assertEqual(result["type"], "string")
        self.assertEqual(result["description"], "a str")

    def test_babel_type_to_json_schema_enum(self):
        from babel_registry.compiler.base import BabelAdapter
        result = BabelAdapter._babel_type_to_json_schema({
            "name": "units", "type": "enum", "values": ["metric", "imperial"]
        })
        self.assertEqual(result["type"], "string")
        self.assertIn("enum", result)
        self.assertIn("metric", result["enum"])

    def test_babel_type_to_json_schema_float(self):
        from babel_registry.compiler.base import BabelAdapter
        result = BabelAdapter._babel_type_to_json_schema({"name": "temp", "type": "float"})
        self.assertEqual(result["type"], "number")

    def test_build_openai_tool_schema_structure(self):
        from babel_registry.compiler.base import BabelAdapter
        with open(WEATHER_SPEC_PATH) as f:
            spec = yaml.safe_load(f)
        schema = BabelAdapter._build_openai_tool_schema(spec)
        self.assertEqual(schema["type"], "function")
        self.assertIn("function", schema)
        fn = schema["function"]
        self.assertIn("name", fn)
        self.assertIn("description", fn)
        self.assertIn("parameters", fn)
        self.assertIn("location", fn["parameters"]["properties"])
        self.assertIn("location", fn["parameters"]["required"])

    def test_build_python_signature_required_param(self):
        from babel_registry.compiler.base import BabelAdapter
        with open(WEATHER_SPEC_PATH) as f:
            spec = yaml.safe_load(f)
        sig = BabelAdapter._build_python_signature(spec)
        self.assertIn("location: str", sig)
        self.assertIn("def weather(", sig)

    def test_build_python_signature_default_param(self):
        from babel_registry.compiler.base import BabelAdapter
        with open(WEATHER_SPEC_PATH) as f:
            spec = yaml.safe_load(f)
        sig = BabelAdapter._build_python_signature(spec)
        # units has default "metric"
        self.assertIn('"metric"', sig)


# ──────────────────────────────────────────────────────────────────────────────
# 3. AG2Adapter Compiler
# ──────────────────────────────────────────────────────────────────────────────

class TestAG2Adapter(unittest.TestCase):

    def setUp(self):
        from babel_registry.compiler.adapters.ag2_adapter import AG2Adapter
        self.adapter = AG2Adapter()
        self.tmp = tempfile.mkdtemp()
        self.dist_dir = Path(self.tmp) / "dist"

    def test_compile_from_file_creates_output_dir(self):
        out_dir = self.adapter.compile_from_file(WEATHER_SPEC_PATH, self.dist_dir)
        self.assertTrue(out_dir.exists())
        self.assertTrue(out_dir.is_dir())

    def test_compile_output_files_exist(self):
        out_dir = self.adapter.compile_from_file(WEATHER_SPEC_PATH, self.dist_dir)
        self.assertTrue((out_dir / "tool.py").exists())
        self.assertTrue((out_dir / "schema.json").exists())
        self.assertTrue((out_dir / "meta.json").exists())

    def test_compiled_schema_json_valid(self):
        out_dir = self.adapter.compile_from_file(WEATHER_SPEC_PATH, self.dist_dir)
        schema = json.loads((out_dir / "schema.json").read_text())
        self.assertEqual(schema["type"], "function")
        self.assertIn("function", schema)

    def test_compiled_tool_py_has_exports(self):
        out_dir = self.adapter.compile_from_file(WEATHER_SPEC_PATH, self.dist_dir)
        tool_py = (out_dir / "tool.py").read_text()
        self.assertIn("TOOL_FUNCTION", tool_py)
        self.assertIn("TOOL_SCHEMA", tool_py)
        self.assertIn("TOOL_ID", tool_py)

    def test_compiled_tool_is_importable(self):
        out_dir = self.adapter.compile_from_file(WEATHER_SPEC_PATH, self.dist_dir)
        tool_py = out_dir / "tool.py"
        spec = importlib.util.spec_from_file_location("_compiled_weather", tool_py)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        self.assertTrue(callable(mod.TOOL_FUNCTION))
        self.assertIsInstance(mod.TOOL_SCHEMA, dict)
        self.assertEqual(mod.TOOL_ID, "com.aria.tools.weather")

    def test_compiled_tool_callable_returns_dict(self):
        out_dir = self.adapter.compile_from_file(WEATHER_SPEC_PATH, self.dist_dir)
        tool_py = out_dir / "tool.py"
        spec = importlib.util.spec_from_file_location("_compiled_weather2", tool_py)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        result = mod.TOOL_FUNCTION(location="Singapore")
        self.assertIsInstance(result, dict)
        self.assertIn("temperature", result)

    def test_compile_maps_directions(self):
        out_dir = self.adapter.compile_from_file(MAPS_SPEC_PATH, self.dist_dir)
        self.assertTrue((out_dir / "tool.py").exists())
        tool_py = out_dir / "tool.py"
        spec = importlib.util.spec_from_file_location("_compiled_maps", tool_py)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        result = mod.TOOL_FUNCTION(origin="A", destination="B")
        self.assertIn("duration_mins", result)

    def test_output_placed_in_ag2_subdir(self):
        out_dir = self.adapter.compile_from_file(WEATHER_SPEC_PATH, self.dist_dir)
        self.assertIn("ag2", str(out_dir))
        self.assertIn("com.aria.tools.weather", str(out_dir))


# ──────────────────────────────────────────────────────────────────────────────
# 4. RawPythonAdapter Compiler
# ──────────────────────────────────────────────────────────────────────────────

class TestRawPythonAdapter(unittest.TestCase):

    def setUp(self):
        from babel_registry.compiler.adapters.raw_python_adapter import RawPythonAdapter
        self.adapter = RawPythonAdapter()
        self.tmp = tempfile.mkdtemp()
        self.dist_dir = Path(self.tmp) / "dist"

    def test_compile_creates_output(self):
        out_dir = self.adapter.compile_from_file(WEATHER_SPEC_PATH, self.dist_dir)
        self.assertTrue((out_dir / "tool.py").exists())
        self.assertTrue((out_dir / "schema.json").exists())

    def test_output_in_raw_python_subdir(self):
        out_dir = self.adapter.compile_from_file(WEATHER_SPEC_PATH, self.dist_dir)
        self.assertIn("raw_python", str(out_dir))

    def test_compiled_tool_callable(self):
        out_dir = self.adapter.compile_from_file(WEATHER_SPEC_PATH, self.dist_dir)
        tool_py = out_dir / "tool.py"
        spec = importlib.util.spec_from_file_location("_raw_weather", tool_py)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        result = mod.TOOL_FUNCTION(location="London")
        self.assertIsInstance(result, dict)
        self.assertIn("temperature", result)

    def test_target_name(self):
        self.assertEqual(self.adapter.target_name, "raw_python")


# ──────────────────────────────────────────────────────────────────────────────
# 5. LocalRegistry
# ──────────────────────────────────────────────────────────────────────────────

class TestLocalRegistry(unittest.TestCase):

    def setUp(self):
        from babel_registry.registry.local_registry import LocalRegistry
        self.tmp = tempfile.mkdtemp()
        self.db_path = Path(self.tmp) / "test_registry.db"
        self.registry = LocalRegistry(db_path=self.db_path)

        with open(WEATHER_SPEC_PATH) as f:
            self.weather_spec = yaml.safe_load(f)
        self.weather_impl = str(PROJECT_ROOT / "tools" / "weather" / "impl.py")

    def tearDown(self):
        self.registry.close()

    def test_db_file_created(self):
        self.assertTrue(self.db_path.exists())

    def test_publish_returns_tool_id(self):
        tool_id = self.registry.publish(self.weather_spec, self.weather_impl)
        self.assertEqual(tool_id, "com.aria.tools.weather")

    def test_query_exact_tool_id_hit(self):
        self.registry.publish(self.weather_spec, self.weather_impl)
        result = self.registry.query("com.aria.tools.weather")
        self.assertEqual(result, "com.aria.tools.weather")

    def test_query_short_name_hit(self):
        self.registry.publish(self.weather_spec, self.weather_impl)
        result = self.registry.query("weather")
        self.assertEqual(result, "com.aria.tools.weather")

    def test_query_miss_returns_none(self):
        result = self.registry.query("com.aria.tools.nonexistent")
        self.assertIsNone(result)

    def test_list_returns_published_tools(self):
        self.registry.publish(self.weather_spec, self.weather_impl)
        tools = self.registry.list()
        self.assertEqual(len(tools), 1)
        self.assertEqual(tools[0]["tool_id"], "com.aria.tools.weather")

    def test_list_empty_on_fresh_registry(self):
        tools = self.registry.list()
        self.assertEqual(tools, [])

    def test_get_returns_full_row(self):
        self.registry.publish(self.weather_spec, self.weather_impl)
        row = self.registry.get("com.aria.tools.weather")
        self.assertIsNotNone(row)
        self.assertEqual(row["tool_id"], "com.aria.tools.weather")
        self.assertIn("spec_yaml", row)
        self.assertIn("impl_path", row)

    def test_get_nonexistent_returns_none(self):
        result = self.registry.get("com.aria.tools.ghost")
        self.assertIsNone(result)

    def test_get_spec_returns_parsed_dict(self):
        self.registry.publish(self.weather_spec, self.weather_impl)
        spec = self.registry.get_spec("com.aria.tools.weather")
        self.assertIsInstance(spec, dict)
        self.assertEqual(spec["id"], "com.aria.tools.weather")

    def test_publish_upserts_on_duplicate(self):
        self.registry.publish(self.weather_spec, self.weather_impl)
        self.registry.publish(self.weather_spec, self.weather_impl)
        self.assertEqual(self.registry.count(), 1)  # not 2

    def test_count_increments(self):
        self.assertEqual(self.registry.count(), 0)
        self.registry.publish(self.weather_spec, self.weather_impl)
        self.assertEqual(self.registry.count(), 1)

        with open(MAPS_SPEC_PATH) as f:
            maps_spec = yaml.safe_load(f)
        maps_impl = str(PROJECT_ROOT / "tools" / "maps_directions" / "impl.py")
        self.registry.publish(maps_spec, maps_impl)
        self.assertEqual(self.registry.count(), 2)

    def test_source_label_stored(self):
        self.registry.publish(self.weather_spec, self.weather_impl, source="synthesized")
        row = self.registry.get("com.aria.tools.weather")
        self.assertEqual(row["source"], "synthesized")

    def test_query_hit_logs_event(self):
        self.registry.publish(self.weather_spec, self.weather_impl)
        self.registry.query("weather")
        events = self.registry.get_events()
        types = [e["event_type"] for e in events]
        self.assertIn("query_hit", types)

    def test_query_miss_logs_event(self):
        self.registry.query("nonexistent")
        events = self.registry.get_events()
        types = [e["event_type"] for e in events]
        self.assertIn("query_miss", types)

    def test_hit_rate_zero_on_all_misses(self):
        self.registry.query("nonexistent")
        self.registry.query("another")
        self.assertEqual(self.registry.hit_rate(), 0.0)

    def test_hit_rate_one_on_all_hits(self):
        self.registry.publish(self.weather_spec, self.weather_impl)
        self.registry.query("weather")
        self.registry.query("weather")
        self.assertEqual(self.registry.hit_rate(), 1.0)

    def test_hit_rate_mixed(self):
        self.registry.publish(self.weather_spec, self.weather_impl)
        self.registry.query("weather")   # hit
        self.registry.query("missing")   # miss
        rate = self.registry.hit_rate()
        self.assertAlmostEqual(rate, 0.5)


# ──────────────────────────────────────────────────────────────────────────────
# 6. BabelRuntime
# ──────────────────────────────────────────────────────────────────────────────

class TestBabelRuntime(unittest.TestCase):

    def setUp(self):
        from babel_registry.registry.local_registry import LocalRegistry
        from babel_registry.runtime.babel_runtime import BabelRuntime

        self.tmp = tempfile.mkdtemp()
        db_path = Path(self.tmp) / "runtime_test.db"
        dist_dir = Path(self.tmp) / "dist"

        self.registry = LocalRegistry(db_path=db_path)
        self.runtime = BabelRuntime(registry=self.registry, dist_dir=dist_dir)

        # Publish weather tool
        with open(WEATHER_SPEC_PATH) as f:
            spec = yaml.safe_load(f)
        impl = str(PROJECT_ROOT / "tools" / "weather" / "impl.py")
        self.registry.publish(spec, impl)

    def tearDown(self):
        self.registry.close()

    def test_load_returns_dict(self):
        tool = self.runtime.load("com.aria.tools.weather")
        self.assertIsInstance(tool, dict)

    def test_load_has_required_keys(self):
        tool = self.runtime.load("com.aria.tools.weather")
        for key in ("name", "description", "function", "schema"):
            self.assertIn(key, tool, f"Missing key: {key}")

    def test_load_function_is_callable(self):
        tool = self.runtime.load("com.aria.tools.weather")
        self.assertTrue(callable(tool["function"]))

    def test_load_function_returns_dict(self):
        tool = self.runtime.load("com.aria.tools.weather")
        result = tool["function"](location="Singapore")
        self.assertIsInstance(result, dict)
        self.assertIn("temperature", result)

    def test_load_schema_is_openai_format(self):
        tool = self.runtime.load("com.aria.tools.weather")
        schema = tool["schema"]
        self.assertEqual(schema["type"], "function")
        self.assertIn("function", schema)

    def test_load_unknown_tool_raises_key_error(self):
        with self.assertRaises(KeyError):
            self.runtime.load("com.aria.tools.does_not_exist")

    def test_second_load_uses_cache(self):
        self.runtime.load("com.aria.tools.weather")
        info_before = self.runtime.cache_info()
        self.runtime.load("com.aria.tools.weather")
        info_after = self.runtime.cache_info()
        # Cache size should stay the same (not grow) on repeated load of same tool
        self.assertEqual(info_before["size"], info_after["size"])

    def test_cache_info_structure(self):
        info = self.runtime.cache_info()
        self.assertIn("size", info)
        self.assertIn("max_size", info)
        self.assertIn("cached_tools", info)

    def test_invalidate_removes_from_cache(self):
        self.runtime.load("com.aria.tools.weather")
        self.assertIn("com.aria.tools.weather", self.runtime.cache_info()["cached_tools"])
        self.runtime.invalidate("com.aria.tools.weather")
        self.assertNotIn("com.aria.tools.weather", self.runtime.cache_info()["cached_tools"])

    def test_precompile_all_returns_list(self):
        result = self.runtime.precompile_all()
        self.assertIsInstance(result, list)


# ──────────────────────────────────────────────────────────────────────────────
# 7. Pre-Built Tool Implementations
# ──────────────────────────────────────────────────────────────────────────────

class TestWeatherImpl(unittest.TestCase):

    def setUp(self):
        self.mod = load_impl(PROJECT_ROOT / "tools" / "weather" / "impl.py")

    def test_returns_dict(self):
        result = self.mod.run(location="Singapore")
        self.assertIsInstance(result, dict)

    def test_has_temperature(self):
        result = self.mod.run(location="Singapore")
        self.assertIn("temperature", result)
        self.assertIsInstance(result["temperature"], (int, float))

    def test_has_conditions(self):
        result = self.mod.run(location="Singapore")
        self.assertIn("conditions", result)
        self.assertIsInstance(result["conditions"], str)

    def test_has_location_name(self):
        result = self.mod.run(location="Tokyo")
        self.assertIn("location_name", result)

    def test_forecast_empty_by_default(self):
        result = self.mod.run(location="Paris")
        self.assertEqual(result.get("forecast", []), [])

    def test_forecast_populated_when_requested(self):
        result = self.mod.run(location="London", forecast_days=3)
        self.assertIn("forecast", result)
        self.assertEqual(len(result["forecast"]), 3)

    def test_imperial_units(self):
        result = self.mod.run(location="New York", units="imperial")
        self.assertIn("temperature", result)

    def test_mock_flag_present_without_api_key(self):
        result = self.mod.run(location="Singapore")
        # If no API key set, mock flag should be True
        import os
        if not os.getenv("OPENWEATHERMAP_API_KEY"):
            self.assertTrue(result.get("_mock", False))


class TestMapsDirectionsImpl(unittest.TestCase):

    def setUp(self):
        self.mod = load_impl(PROJECT_ROOT / "tools" / "maps_directions" / "impl.py")

    def test_returns_dict(self):
        result = self.mod.run(origin="A", destination="B")
        self.assertIsInstance(result, dict)

    def test_has_duration_mins(self):
        result = self.mod.run(origin="Changi Airport", destination="Marina Bay Sands")
        self.assertIn("duration_mins", result)
        self.assertIsInstance(result["duration_mins"], (int, float))

    def test_has_distance_km(self):
        result = self.mod.run(origin="A", destination="B")
        self.assertIn("distance_km", result)

    def test_has_steps(self):
        result = self.mod.run(origin="A", destination="B")
        self.assertIn("steps", result)
        self.assertIsInstance(result["steps"], list)
        self.assertGreater(len(result["steps"]), 0)

    def test_driving_mode(self):
        result = self.mod.run(origin="A", destination="B", mode="driving")
        self.assertIn("duration_mins", result)

    def test_walking_mode(self):
        result = self.mod.run(origin="A", destination="B", mode="walking")
        self.assertIn("duration_mins", result)

    def test_mock_flag_present_without_api_key(self):
        import os
        if not os.getenv("GOOGLE_MAPS_API_KEY"):
            result = self.mod.run(origin="A", destination="B")
            self.assertTrue(result.get("_mock", False))


# ──────────────────────────────────────────────────────────────────────────────
# 8. CLI Commands
# ──────────────────────────────────────────────────────────────────────────────

class TestCLI(unittest.TestCase):

    def _run(self, *args):
        """Run babel CLI as subprocess and return (returncode, stdout, stderr)."""
        result = subprocess.run(
            [sys.executable, "-m", "babel_registry.cli", *args],
            cwd=str(PROJECT_ROOT),
            capture_output=True,
            text=True,
        )
        return result.returncode, result.stdout, result.stderr

    def test_validate_weather_spec_passes(self):
        rc, out, err = self._run("validate", "tools/weather/spec.yaml")
        self.assertEqual(rc, 0, f"Expected exit 0, got:\n{err}")
        self.assertIn("✓", out)

    def test_validate_maps_spec_passes(self):
        rc, out, err = self._run("validate", "tools/maps_directions/spec.yaml")
        self.assertEqual(rc, 0)

    def test_validate_nonexistent_file_fails(self):
        rc, out, err = self._run("validate", "nonexistent.yaml")
        self.assertNotEqual(rc, 0)

    def test_compile_ag2_target(self):
        with tempfile.TemporaryDirectory() as tmp:
            rc, out, err = self._run(
                "compile", "tools/weather/spec.yaml",
                "--target", "ag2",
                "--output", tmp,
            )
            self.assertEqual(rc, 0, f"Compile failed:\n{err}")
            self.assertIn("✓", out)
            compiled = Path(tmp) / "ag2" / "com.aria.tools.weather" / "tool.py"
            self.assertTrue(compiled.exists())

    def test_compile_raw_python_target(self):
        with tempfile.TemporaryDirectory() as tmp:
            rc, out, err = self._run(
                "compile", "tools/weather/spec.yaml",
                "--target", "raw_python",
                "--output", tmp,
            )
            self.assertEqual(rc, 0)
            compiled = Path(tmp) / "raw_python" / "com.aria.tools.weather" / "tool.py"
            self.assertTrue(compiled.exists())

    def test_compile_invalid_target_fails(self):
        rc, out, err = self._run("compile", "tools/weather/spec.yaml", "--target", "langchain")
        self.assertNotEqual(rc, 0)

    def test_registry_stats_runs(self):
        rc, out, err = self._run("registry", "stats")
        self.assertEqual(rc, 0)
        self.assertIn("Total tools", out)

    def test_registry_list_runs(self):
        rc, out, err = self._run("registry", "list")
        # Should exit 0 whether empty or populated
        self.assertEqual(rc, 0)

    def test_help_flag(self):
        rc, out, err = self._run("--help")
        self.assertEqual(rc, 0)
        self.assertIn("compile", out)
        self.assertIn("validate", out)
        self.assertIn("publish", out)
        self.assertIn("registry", out)


# ──────────────────────────────────────────────────────────────────────────────
# Runner
# ──────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    loader = unittest.TestLoader()
    suite = unittest.TestSuite()

    test_classes = [
        TestSchemaValidation,
        TestBabelAdapterHelpers,
        TestAG2Adapter,
        TestRawPythonAdapter,
        TestLocalRegistry,
        TestBabelRuntime,
        TestWeatherImpl,
        TestMapsDirectionsImpl,
        TestCLI,
    ]

    for cls in test_classes:
        suite.addTests(loader.loadTestsFromTestCase(cls))

    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    sys.exit(0 if result.wasSuccessful() else 1)
