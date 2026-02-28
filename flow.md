# E2 Build Log — Babel Tool Standard

Running log of everything Engineer 2 has built. Updated after each phase.

---

## Phase 1 — Babel Spec Schema ✅

**Goal:** Define the universal tool specification format that every other component depends on.

### Files Built

| File | Purpose |
|------|---------|
| `babel/spec/babel.schema.json` | JSON Schema v7 validator for all `.babel.yaml` files |
| `babel/spec/README.md` | Full spec format documentation for E1 and E3 |
| `babel/spec/samples/weather.babel.yaml` | Reference spec — com.aria.tools.weather (E2 owns) |
| `babel/spec/samples/web_search.babel.yaml` | Reference spec — com.aria.tools.web_search (E3 owns) |
| `babel/spec/samples/gcal_create.babel.yaml` | Reference spec — com.aria.tools.gcal_create (E1 owns) |

### What the Schema Validates

A `.babel.yaml` file must have:
- `babel_version` — string matching `\d+\.\d+`
- `id` — reverse-domain tool ID (e.g. `com.aria.tools.weather`)
- `name`, `description` — strings
- `interface.inputs[]` — typed parameter list (string, integer, float, boolean, enum, array, object)
- `interface.output` — return type descriptor
- `implementation` — `language`, `entry_point`, `function`
- `execution` — timeout, retries, async flag

### Milestone ✓
> 3 hand-written specs all validate against `babel.schema.json`.

---

## Phase 2 — Babel Compiler ✅

**Goal:** Read a Babel spec → output native framework bindings.

### Files Built

| File | Purpose |
|------|---------|
| `babel/__init__.py` | Package root |
| `babel/compiler/__init__.py` | Exports BabelAdapter, AG2Adapter, RawPythonAdapter |
| `babel/compiler/base.py` | Abstract `BabelAdapter` base class |
| `babel/compiler/adapters/__init__.py` | Adapter exports |
| `babel/compiler/adapters/ag2_adapter.py` | Compiles to `dist/ag2/<tool_id>/` |
| `babel/compiler/adapters/raw_python_adapter.py` | Compiles to `dist/raw_python/<tool_id>/` |

### Compiler Architecture

```
BabelAdapter (abstract)
├── load_spec(spec_path) → validates YAML against schema
├── validate_spec(spec_dict) → raises on violation
├── compile_from_file(spec_path, output_dir) → convenience method
├── _babel_type_to_json_schema(param) → converts Babel types to JSON Schema
├── _build_openai_tool_schema(spec) → full OpenAI function schema dict
└── _build_python_signature(spec) → Python def signature string

AG2Adapter extends BabelAdapter
└── compile(spec, impl_path, output_dir)
    → dist/ag2/<tool_id>/tool.py      (importable, has TOOL_FUNCTION + TOOL_SCHEMA)
    → dist/ag2/<tool_id>/schema.json  (OpenAI-compatible)
    → dist/ag2/<tool_id>/meta.json    (metadata cache)

RawPythonAdapter extends BabelAdapter
└── compile(spec, impl_path, output_dir)
    → dist/raw_python/<tool_id>/tool.py
    → dist/raw_python/<tool_id>/schema.json
    → dist/raw_python/<tool_id>/meta.json
```

### Generated tool.py contract

Every compiled `tool.py` exports:
- `TOOL_FUNCTION` — Python callable matching the Babel spec signature
- `TOOL_ID` — full tool ID string
- `TOOL_SCHEMA` — OpenAI-compatible tool schema dict (used by AG2 LLM registration)

The function dynamically loads `impl.py` at import time using `importlib`, applies
retry logic from the spec's `execution.retries`, and returns errors as `{"error": ..., "code": ...}`.

### Milestone ✓
> `babel compile tools/weather/spec.yaml --target ag2` produces a working AG2 tool module.

---

## Phase 3 — Babel Runtime + Local Registry ✅

**Goal:** Build the runtime loader and SQLite registry used by the live system.

### Files Built

| File | Purpose |
|------|---------|
| `babel/registry/__init__.py` | Exports LocalRegistry |
| `babel/registry/local_registry.py` | SQLite-backed tool registry |
| `babel/registry/migrations/001_initial.sql` | DB schema (tools + registry_events tables) |
| `babel/runtime/__init__.py` | Exports BabelRuntime |
| `babel/runtime/babel_runtime.py` | Compile-on-demand + LRU cache |

### LocalRegistry API (consumed by E1 + E3)

```python
registry = LocalRegistry()

# E1 Planner calls this before flagging a gap:
tool_id = registry.query("weather")           # → "com.aria.tools.weather" | None
tool_id = registry.query("com.aria.tools.weather")  # exact match also works

# E3 calls this after Vibe synthesis:
tool_id = registry.publish(spec_dict, impl_path, source="synthesized")

# Admin / CLI:
tools = registry.list()                       # → [{tool_id, name, version, ...}, ...]
row   = registry.get("com.aria.tools.weather") # → full row dict | None
spec  = registry.get_spec("com.aria.tools.weather")  # → parsed spec dict | None
rate  = registry.hit_rate()                   # → float 0.0–1.0
```

### Registry Database Schema

```sql
tools (
    id, tool_id UNIQUE, name, version, description,
    spec_yaml, impl_path, tags, source, created_at, updated_at
)
registry_events (
    id, event_type, tool_id, detail (JSON), created_at
)
```

All `query()` calls log to `registry_events` with type `query_hit` or `query_miss`.
E3's W&B Weave logger can call `registry.get_events()` and `registry.hit_rate()`.

### BabelRuntime API (consumed by E3)

```python
runtime = BabelRuntime()

tool = runtime.load("com.aria.tools.weather")
# Returns:
# {
#   "name":        "weather",
#   "description": "Get current weather...",
#   "function":    <callable>,
#   "schema":      { "type": "function", "function": { ... } }  # OpenAI format
# }

# E3 registers with AG2:
agent.register_for_execution(name=tool["name"])(tool["function"])
```

LRU cache holds up to 64 compiled tools in memory. Compiled `dist/` artifacts are
reused across process restarts. First compile of any tool takes ~50–200ms;
cache hits are < 5ms.

### Milestone ✓
> `runtime.load("com.aria.tools.weather")` returns working AG2 tool in < 200ms.

---

## Phase 4 — CLI + Pre-Built Tools ✅

**Goal:** 2 E2-owned tools built and tested; Babel CLI demo-ready; seed script working.

### Files Built

| File | Purpose |
|------|---------|
| `babel/cli/__init__.py` | CLI package |
| `babel/cli/__main__.py` | Entry point (`python -m babel.cli`) |
| `babel/cli/babel_cli.py` | Full CLI: compile, validate, publish, registry subcommands |
| `tools/weather/spec.yaml` | com.aria.tools.weather — Babel spec |
| `tools/weather/impl.py` | com.aria.tools.weather — OpenWeatherMap impl + mock fallback |
| `tools/maps_directions/spec.yaml` | com.aria.tools.maps_directions — Babel spec |
| `tools/maps_directions/impl.py` | com.aria.tools.maps_directions — Google Maps impl + mock |
| `babel_seed.py` | Startup script: compile + publish all tools from tools/ |

### CLI Commands

```bash
# Compile a spec to an AG2 tool
python -m babel.cli compile tools/weather/spec.yaml --target ag2

# Validate a spec (no compilation)
python -m babel.cli validate tools/weather/spec.yaml

# Run fixtures + publish to registry
python -m babel.cli publish tools/weather/spec.yaml

# Registry management
python -m babel.cli registry list
python -m babel.cli registry info com.aria.tools.weather
python -m babel.cli registry seed               # publish all tools from tools/
python -m babel.cli registry stats
```

### Pre-Built Tools (E2-owned)

**com.aria.tools.weather**
- API: OpenWeatherMap Current + Forecast
- Inputs: `location` (string), `units` (enum: metric/imperial/standard), `forecast_days` (int 0–5)
- Output: `{temperature, feels_like, conditions, humidity, wind_speed, location_name, forecast[]}`
- Mock fallback when `OPENWEATHERMAP_API_KEY` not set — demo always works

**com.aria.tools.maps_directions**
- API: Google Maps Directions API
- Inputs: `origin` (string), `destination` (string), `mode` (enum: driving/walking/transit/bicycling), `departure_time` (optional ISO 8601)
- Output: `{duration_mins, distance_km, steps[], summary, start_address, end_address}`
- Mock fallback when `GOOGLE_MAPS_API_KEY` not set

### Seed Script

```bash
python babel_seed.py               # seed from tools/ (skips already-registered)
python babel_seed.py --force       # force re-publish all
python babel_seed.py --tools-dir /custom/path
```

The seed script:
1. Discovers all `tools/*/spec.yaml` files
2. Validates each spec
3. Compiles to `dist/ag2/<tool_id>/`
4. Publishes to SQLite registry
5. Warms the BabelRuntime LRU cache
6. Runs a smoke test against `com.aria.tools.weather`

### Milestone ✓
> All E2 tools in registry. CLI demo-ready. Seed script runs end-to-end.

---

## Integration Status

| Integration Point | Status | Notes |
|---|---|---|
| E1 ← `registry.query(name)` | Ready | LocalRegistry.query() returns tool_id or None |
| E3 ← `runtime.load(tool_id)` | Ready | Returns `{name, description, function, schema}` |
| E3 → `registry.publish(spec, impl)` | Ready | Called after Vibe synthesis |
| E3 ← registry_events table | Ready | hit_rate() + get_events() for W&B Weave |
| Compiler output → E3 | Ready | dist/ag2/<tool_id>/tool.py importable |

## Directory Map (E2 owns)

```
babel/
├── __init__.py
├── spec/
│   ├── babel.schema.json          ← JSON Schema validator
│   ├── README.md                  ← spec format docs for E1 + E3
│   └── samples/
│       ├── weather.babel.yaml     ← reference spec
│       ├── web_search.babel.yaml  ← reference spec (E3 impl)
│       └── gcal_create.babel.yaml ← reference spec (E1 impl)
├── compiler/
│   ├── base.py                    ← BabelAdapter abstract base
│   └── adapters/
│       ├── ag2_adapter.py         ← → dist/ag2/<id>/
│       └── raw_python_adapter.py  ← → dist/raw_python/<id>/
├── runtime/
│   └── babel_runtime.py           ← BabelRuntime (load + LRU cache)
├── registry/
│   ├── local_registry.py          ← LocalRegistry (SQLite)
│   └── migrations/
│       └── 001_initial.sql
└── cli/
    └── babel_cli.py               ← Full CLI

tools/
├── weather/
│   ├── spec.yaml                  ← com.aria.tools.weather
│   └── impl.py
└── maps_directions/
    ├── spec.yaml                  ← com.aria.tools.maps_directions
    └── impl.py

babel_seed.py                      ← startup registry seed script
dist/                              ← compiled tool artifacts (gitignored, generated)
babel_registry.db                  ← SQLite registry (generated at runtime)
```
