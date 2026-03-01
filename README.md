# ARIA — Adaptive Runtime Intelligence Architecture

> An AI assistant that doesn't just fail when it lacks a tool — it builds one, in real time, and uses it immediately.

Built in 48 hours at a Mistral hackathon by a team of 4 engineers.

---

## The Core Idea

Every AI assistant today has a fixed set of capabilities. Ask it to do something outside those capabilities and it tells you it can't. ARIA takes a different approach: **when it hits a gap, it synthesizes the missing tool on the fly using Mistral Codestral Vibe, registers it, and completes the request — all within a single conversation turn.**

The user never sees a "I can't do that." They just get an answer.

---

## System Overview

ARIA is a full-stack, voice-first AI system with four deeply integrated layers:

```
                         🎙  USER SPEAKS
                              │
                     ┌────────▼────────┐
                     │   E1 — VOICE    │
                     │  Voxtral  STT   │
                     │  Intent Parser  │
                     │  Mistral Planner│
                     └────────┬────────┘
                              │  task graph
                     ┌────────▼────────┐
                     │  E3 — EXECUTION │ ◄──── E2 Registry: tool lookup
                     │  AG2 GraphFlow  │ ◄──── E2 Runtime:  tool load
                     │  Mistral Vibe   │ ──►── E2 Registry: tool publish (synthesis)
                     │  W&B Weave      │
                     └────────┬────────┘
                              │  SSE event stream
                     ┌────────▼────────┐
                     │  E4 — FRONTEND  │
                     │  React + AG-UI  │
                     │  11Labs TTS     │
                     └─────────────────┘

         ┌─────────────────────────────────────────────┐
         │            E2 — BABEL LAYER                 │
         │                                             │
         │  spec.yaml → Compiler → dist/tool.py        │
         │                         ▲                   │
         │  LocalRegistry (SQLite) ─┘                  │
         │  BabelRuntime (LRU cache)                   │
         │  FastAPI HTTP server (port 8765)            │
         └─────────────────────────────────────────────┘
```

| Engineer | Layer | Key Technologies |
|---|---|---|
| **E1** | Voice + Planning | Voxtral STT, Intent Parser, Mistral Large |
| **E2** | Tool Infrastructure | Babel Spec, Compiler, Registry, Runtime, CLI |
| **E3** | Execution + Synthesis | AG2 GraphFlow, Mistral Vibe, W&B Weave |
| **E4** | Frontend + Voice Output | React, AG-UI, 11Labs TTS |

---

## Table of Contents

1. [E1 — Voice & Planning](#e1--voice--planning)
2. [E2 — Babel Tool Standard](#e2--babel-tool-standard)
3. [E3 — Execution & Vibe Synthesis](#e3--execution--vibe-synthesis)
4. [E4 — Frontend & Voice Output](#e4--frontend--voice-output)
5. [End-to-End Flows](#end-to-end-flows)
6. [Pre-built Tools](#pre-built-tools)
7. [Quickstart](#quickstart)
8. [Directory Structure](#directory-structure)
9. [What We're Aiming For](#what-were-aiming-for)

---

## E1 — Voice & Planning

E1 is the front door of ARIA. It converts speech to a structured task plan that the rest of the system can execute.

### Pipeline

```
Microphone → Voxtral STT → text
                            │
                    Intent Parser
                            │
               Mistral Large (JSON mode)
                            │
                       Task Graph
```

### Mistral Planner (`aria/planner.py`)

The planner receives a natural language request and produces a directed acyclic task graph. It queries the Babel registry to check which tools already exist, and flags any gaps for synthesis.

**Output schema:**
```json
{
  "nodes": [
    {
      "id": "weather_node",
      "role": "WeatherAgent",
      "agent_type": "finder",
      "tools": ["com.aria.tools.weather"],
      "instructions": "Get current weather for Singapore"
    }
  ],
  "edges": [
    { "from": "weather_node", "to": "directions_node" }
  ],
  "exit_node": "directions_node",
  "missing_tools": []
}
```

**Agent types the planner can assign:**

| Type | Role |
|---|---|
| `finder` | Searches for or fetches information |
| `executor` | Calls a specific tool and returns a result |
| `communicator` | Formats and combines outputs |
| `resolver` | Handles ambiguity or conflict between results |
| `validator` | Pauses for human approval on sensitive actions |
| `synthesizer` | Generates the final user-facing answer |

**Gap detection:** if a required tool isn't in the registry, the planner adds it to `missing_tools`. E3 picks this up and triggers Vibe synthesis before execution continues.

---

## E2 — Babel Tool Standard

E2 is the infrastructure layer. Every tool in ARIA — whether hand-written or synthesized on the fly — must be a valid Babel tool. Babel provides the spec format, compiler, registry, and runtime that the rest of the system depends on.

### The Spec

Every tool is described by a `.yaml` file. This is the single source of truth — it drives validation, code generation, LLM descriptions, and registry storage.

```yaml
babel_version: "1.0"
id: com.aria.tools.weather
name: Weather Tool
description: >
  Get current weather and short-range forecast for any location
  using OpenWeatherMap.

interface:
  inputs:
    - name: location
      type: string
      description: City name, "City, Country", or "lat,lon"
      required: true
    - name: units
      type: enum
      values: [metric, imperial, standard]
      default: metric
    - name: forecast_days
      type: integer
      description: 0 = current only, max 5
      default: 0

  output:
    type: object
    fields:
      - { name: temperature,    type: float  }
      - { name: feels_like,     type: float  }
      - { name: conditions,     type: string }
      - { name: humidity,       type: integer }
      - { name: wind_speed,     type: float  }
      - { name: location_name,  type: string }

implementation:
  language: python
  entry_point: impl.py
  function: run
  dependencies: [requests]

targets: [ag2, raw_python]

testing:
  fixtures:
    - description: Basic fetch
      input: { location: Singapore }
      expect_keys: [temperature, conditions, humidity]

execution:
  timeout: 10
  retries: 2

metadata:
  author: ARIA Team — E2
  version: 1.0.0
  tags: [weather, real-time]
  api_keys_required: [OPENWEATHERMAP_API_KEY]
```

Every `impl.py` follows a simple contract:

```python
def run(**kwargs) -> dict:
    # Accept all interface.inputs as kwargs
    # Return dict matching output spec on success
    # Return {"error": "...", "code": 500} on failure
    ...
```

### Compiler

The compiler takes a validated spec + implementation file and generates a target-specific, importable Python module under `dist/`.

```
BabelAdapter (abstract base)
├── AG2Adapter        → dist/ag2/<tool_id>/tool.py
├── RawPythonAdapter  → dist/raw_python/<tool_id>/tool.py
├── PydanticAdapter   → dist/pydantic/<tool_id>/tool.py
└── LangChainAdapter  → dist/langchain/<tool_id>/tool.py
```

Every generated `tool.py` exports a consistent interface regardless of target:

```python
TOOL_ID       # "com.aria.tools.weather"
TOOL_FUNCTION # callable — the wrapped impl.py function
TOOL_SCHEMA   # OpenAI-compatible {"type": "function", "function": {...}}
TOOL_OBJECT   # Framework-native binding (StructuredTool, pydantic_ai.Tool, or None)
```

The wrapper automatically applies retry logic, exception catching, and dynamic import of `impl.py`. Adding a new framework target means writing one new adapter class — nothing else changes.

### Registry

A SQLite-backed tool store. All tools — pre-built and synthesized — live here. The file is auto-created at `babel_registry.db` on first run.

```python
registry = LocalRegistry()

registry.query("weather")          # → "com.aria.tools.weather" | None
registry.publish(spec, impl_path, source="synthesized")
registry.list()                    # All tools as list of dicts
registry.get("com.aria.tools.weather")
registry.hit_rate()                # Float 0.0–1.0 (for W&B Weave)
registry.get_events(limit=100)     # query_hit / query_miss / publish events
```

### Runtime

`BabelRuntime` is the single entry point for loading executable tools. It compiles on first access, then caches in an LRU (max 64 entries by default).

```python
runtime = BabelRuntime(registry=registry, dist_dir=Path("dist"))

tool = runtime.load("com.aria.tools.weather")
# or a specific framework:
tool = runtime.load("com.aria.tools.weather", target="pydantic")
tool = runtime.load("com.aria.tools.weather", target="langchain")
```

Returned tool dict:
```python
{
    "name":        "weather",
    "description": "Get current weather ...",
    "function":    <callable>,
    "schema":      { "type": "function", ... },   # OpenAI format
    "tool_id":     "com.aria.tools.weather",
    "tool_object": <StructuredTool | pydantic_ai.Tool | None>,
}
```

Loading flow: LRU hit (~1ms) → disk artifact hit (~5ms) → compile + cache (~100ms).

### HTTP Server

A FastAPI server at port `8765` exposes the registry and orchestration endpoints to the rest of the system.

```
GET  /tools                           List all registered tools
GET  /tools/{tool_id}/schema          OpenAI-compatible schema
POST /tools/{tool_id}/execute         Invoke a tool
POST /aria/start                      Submit a user request → plan + start execution
POST /aria/execute/{run_id}           Run a task graph
GET  /aria/stream/{run_id}            SSE stream of execution events
POST /vibe/synthesize                 Proxy: trigger Vibe synthesis
POST /vibe/callback                   Receive synthesized tool, auto-compile + register
```

### CLI

```bash
python -m babel_registry.cli validate  tools/weather/spec.yaml
python -m babel_registry.cli compile   tools/weather/spec.yaml --target ag2
python -m babel_registry.cli publish   tools/weather/spec.yaml
python -m babel_registry.cli registry  list | info <id> | stats | seed

python babel_seed.py          # Compile + publish all tools/ at startup
python babel_seed.py --force  # Force re-publish everything
```

---

## E3 — Execution & Vibe Synthesis

E3 takes the task graph from E1 and executes it as a multi-agent workflow. When tools are missing, it invokes Mistral Vibe to synthesize them live.

### AG2 GraphFlow (`aria/graph_flow.py`)

`ARIAGraphFlow` is the execution engine. It topologically sorts the task graph (Kahn's algorithm), resolves dependencies, and runs each node as an independent AG2 agent pair.

```python
flow = ARIAGraphFlow(babel_server_url="http://localhost:8765")
final_answer = flow.run(task_graph, verbose=True)
```

**Per-node execution:**
1. Fetch tool schemas from Babel HTTP server
2. Create `AssistantAgent` (Mistral LLM) + `UserProxyAgent` (executor) pair
3. Dynamically generate Python function stubs from schema (so AG2's `inspect` works)
4. Register tools via `register_function()`
5. Agent invokes tool → result captured
6. Emit SSE event to frontend
7. Pass result as context to downstream nodes

**Parallelism:** nodes without mutual dependencies run concurrently. Downstream nodes receive upstream results injected into their system prompt.

### Mistral Vibe Synthesis (`vibe_tool/`)

A separate FastAPI service (port `8002`) that generates new tools from natural language descriptions using Mistral Codestral Vibe.

```
POST /synthesize
  { "tool_name": "crypto_price",
    "capability": "Get the current Bitcoin price in USD",
    "callback_url": "http://localhost:8765/vibe/callback" }
  → { "job_id": "abc123" }

GET /synthesize/{job_id}/events   ← SSE stream of synthesis progress
```

**Synthesis pipeline:**
1. Create an isolated workspace directory
2. Spawn Mistral Vibe CLI subprocess with capability description
3. Vibe generates `spec.yaml` and `impl.py`
4. Stream code tokens to frontend as `CODE_DELTA` SSE events
5. Run test fixtures from the generated spec
6. On success: POST webhook to BabelServer with spec + impl
7. BabelServer compiles and registers the new tool

### W&B Weave Observability

Every synthesis job is traced in W&B Weave:
- Vibe iterations count
- Test fixture results (pass/fail)
- Time-to-synthesis
- Registry hit rate over time (sourced from `registry_events` table)
- Full execution traces per user request

---

## E4 — Frontend & Voice Output

E4 is the user-facing surface: a React app that visualizes the live execution graph, streams code synthesis, and speaks the final answer.

### Layout

```
┌──────────────────────────────────────────────────┐
│  🎤  [voice input bar]                           │
├─────────────────────────┬────────────────────────┤
│                         │                        │
│   TASK GRAPH            │   VIBE SYNTHESIS       │
│   (live DAG vis)        │   (code streaming)     │
│                         │                        │
│   ┌──────┐  ┌──────┐   │   def run(**kwargs):   │
│   │ node │→ │ node │   │     import requests    │
│   └──────┘  └──────┘   │     ...               │
│                         │   ✓ Tests passed       │
├─────────────────────────┴────────────────────────┤
│  AGENT LOG STRIP                                 │
│  "WeatherAgent fetched 28.5°C for Singapore..."  │
└──────────────────────────────────────────────────┘
```

### AG-UI Event Contract (E3 → E4)

The frontend is driven entirely by a server-sent event stream:

| Event | Payload | Effect |
|---|---|---|
| `GRAPH_BUILT` | `{nodes, edges}` | Render initial DAG |
| `NODE_START` | `{node_id, role, tools}` | Animate node → running |
| `NODE_COMPLETE` | `{node_id, result}` | Mark node done |
| `TOOL_CALL` | `{node_id, tool, args}` | Log tool invocation |
| `TOOL_RESULT` | `{node_id, tool, result}` | Show tool output |
| `VIBE_START` | `{tool_name}` | Open synthesis panel |
| `CODE_DELTA` | `{token}` | Stream code character by character |
| `TEST_FAIL` | `{error}` | Show red indicator |
| `TEST_PASS` | `{}` | Show green checkmark |
| `BABEL_PUBLISH` | `{tool_id}` | Add "Generated" node to graph |
| `FLOW_COMPLETE` | `{answer}` | Trigger 11Labs TTS |

### Voice I/O

- **Input:** Web Audio API → microphone → POST to E1's STT endpoint
- **Output:** Final answer text → 11Labs TTS API → audio playback

---

## End-to-End Flows

### Happy Path: Tool Found in Registry

```
User: "What's the weather in Singapore?"

E1: Voxtral STT → intent object
    ARIAPlanner.plan() → Mistral queries registry
    registry.query("weather") → "com.aria.tools.weather" ✓
    Returns task graph with one node: WeatherAgent

E3: ARIAGraphFlow.run(task_graph)
    Fetch tool schema from BabelServer
    Create AG2 agent pair
    Agent calls weather tool → {temperature: 28.5, conditions: "light rain", ...}
    Emit: GRAPH_BUILT, NODE_START, TOOL_CALL, TOOL_RESULT, NODE_COMPLETE, FLOW_COMPLETE

E4: Renders live graph
    Shows tool call + result in agent log
    "28.5°C, light rain in Singapore" → 11Labs → spoken to user
```

### Synthesis Path: Tool Gap Detected

```
User: "What's the current price of Bitcoin?"

E1: registry.query("crypto") → None  ← GAP
    Planner returns missing_tools: [{id: "com.aria.tools.crypto_price", ...}]

E3: Detects gap, POSTs to Vibe service:
    { tool_name: "crypto_price", capability: "Get current Bitcoin price in USD" }

Vibe: Generates spec.yaml + impl.py using Mistral Codestral
    Streams CODE_DELTA events → E4 shows live code generation
    Runs test fixtures → all pass
    POSTs webhook to BabelServer

E2: Receives webhook
    AG2Adapter.compile(spec, impl_path) → dist/ag2/com.aria.tools.crypto_price/tool.py
    LocalRegistry.publish() → registered in DB
    Emits BABEL_PUBLISH event

E3: Resumes execution
    runtime.load("com.aria.tools.crypto_price") ← new tool ready
    Calls tool → {price: 67420.50, currency: "USD", ...}

E4: New node appears on graph labeled "Generated"
    Final answer spoken: "Bitcoin is currently $67,420."
```

---

## Pre-built Tools

Four production-ready tools ship with ARIA. All have mock fallbacks so the demo works without any API keys.

### Weather (`com.aria.tools.weather`)
- **API:** OpenWeatherMap Current Weather + Forecast
- **Inputs:** `location` (required), `units` (metric/imperial/standard), `forecast_days` (0–5)
- **Mock:** Returns realistic Singapore data if `OPENWEATHERMAP_API_KEY` is unset

### Maps Directions (`com.aria.tools.maps_directions`)
- **API:** Google Maps Directions API
- **Inputs:** `origin`, `destination` (both required), `mode` (driving/walking/transit/bicycling), `departure_time`
- **Mock:** Returns realistic Singapore route data if `GOOGLE_MAPS_API_KEY` is unset

### Unit Converter (`com.aria.tools.unit_converter`)
- **No external API** — pure computation
- **Inputs:** `value`, `from_unit`, `to_unit`
- Supports: km ↔ miles, kg ↔ lbs, °C ↔ °F, and more

### Currency Conversion (`com.aria.tools.currency_conversion`)
- **Inputs:** `amount`, `from_currency`, `to_currency` (e.g. `USD`, `SGD`, `EUR`)
- Live exchange rates with graceful fallback

---

## Quickstart

### Prerequisites

```bash
pip install pyyaml jsonschema fastapi uvicorn autogen pydantic-ai \
            langchain-mistralai mistralai requests
```

### Environment Variables

```bash
export MISTRAL_API_KEY=your_key           # Required for agent runs
export OPENWEATHERMAP_API_KEY=your_key    # Optional (mock fallback works)
export GOOGLE_MAPS_API_KEY=your_key       # Optional (mock fallback works)
```

### Start the System

```bash
# Terminal 1 — Seed registry and start Babel server
python babel_seed.py
python -m babel_registry.server          # http://localhost:8765

# Terminal 2 — Start Vibe synthesis service
cd vibe_tool && python app/main.py       # http://localhost:8002

# Terminal 3 — Start React frontend
cd aria-ui && npm install && npm run dev # http://localhost:5173
```

### Run Agent Demos (without the UI)

```bash
# Pydantic-AI + Mistral
python babel_agent.py

# AG2 / AutoGen
python agents/ag2_agent.py

# LangChain
python agents/langchain_agent.py

# All three frameworks, same query
python agents/run_all_agents.py
```

### Run Tests

```bash
python -m pytest test_e2.py -v           # Babel layer tests
python test_adapters.py                  # Compiler adapter tests
python test_tool_explorer.py             # Registry + runtime tests
```

---

## Directory Structure

```
aria/
├── planner.py               # E1: Mistral Large task graph planner
└── graph_flow.py            # E3: AG2 GraphFlow executor

babel_registry/              # E2: Core Babel package
├── spec/
│   ├── babel.schema.json    # JSON Schema v7 validator for all specs
│   └── samples/             # 3 reference spec files
├── compiler/
│   ├── base.py              # BabelAdapter abstract base
│   └── adapters/            # ag2, raw_python, pydantic, langchain
├── registry/
│   ├── local_registry.py    # SQLite-backed tool store
│   └── migrations/
├── runtime/
│   └── babel_runtime.py     # Compile-on-demand + LRU cache
├── cli/
│   └── babel_cli.py         # compile / validate / publish / registry *
└── server/
    └── tool_server.py       # FastAPI (port 8765)

vibe_tool/                   # E3: Vibe synthesis microservice
└── app/
    ├── main.py              # FastAPI app (port 8002)
    ├── routes/
    │   └── synthesize.py    # POST /synthesize endpoint
    ├── synthesis/
    │   ├── pipeline.py      # Orchestration logic
    │   └── vibe_runner.py   # Mistral Vibe CLI wrapper
    └── jobs/
        └── job_store.py     # In-memory job tracking + SSE queues

aria-ui/                     # E4: React frontend
└── src/
    ├── App.tsx              # Main app + reducer-based state
    ├── components/
    │   ├── GraphView.tsx    # SVG DAG visualizer
    │   ├── NodeCard.tsx     # Individual task node
    │   ├── SynthesisStream.tsx  # Live code generation panel
    │   └── AgentLog.tsx     # Bottom narrative log strip
    └── types/               # AG-UI event type definitions

tools/                       # Pre-built tool implementations
├── weather/          spec.yaml + impl.py
├── maps_directions/  spec.yaml + impl.py
├── unit_converter/   spec.yaml + impl.py
└── currency_conversion/ spec.yaml + impl.py

agents/                      # Multi-framework demos
├── ag2_agent.py
├── pydantic_agent.py
├── langchain_agent.py
└── run_all_agents.py

dist/                        # Compiled tool artifacts (gitignored)
babel_registry.db            # SQLite registry (gitignored, auto-generated)
babel_seed.py                # Startup: compile + publish all tools
babel_agent.py               # Top-level Pydantic-AI demo
```

---

## What We're Aiming For

### Hackathon Demo Goals (Complete)

- [x] Voice input → structured intent → task graph planning
- [x] Babel Tool Standard v1.0: spec, schema, compiler (4 targets), registry, runtime
- [x] 4 pre-built tools with mock fallbacks (demo always works)
- [x] Multi-framework support: AG2, Pydantic-AI, LangChain — same tool spec, all frameworks
- [x] Vibe synthesis: detect gap → generate spec + impl → register → use, in one request
- [x] FastAPI server bridging all components
- [x] React frontend with live graph visualization and code streaming
- [x] 11Labs voice output
- [x] W&B Weave observability (hit rate, event traces, synthesis logs)

### Near-Term

- **Babel Hub** — a shared registry where synthesized tools persist across sessions and users. A tool built for one user's request becomes available to everyone.
- **Tool versioning** — semver-aware registry with upgrade/rollback, so Vibe can improve a tool without breaking existing callers.
- **Sandboxed execution** — run synthesized tool code in isolated environments (Docker / E2B) with resource limits before promoting to the registry.
- **Quality gates** — automated test fixture running, type checking, and LLM-based code review before any Vibe-synthesized tool can be published.

### Long-Term Vision

**ARIA as an operating system for AI agents.** Today ARIA synthesizes tools for itself. Tomorrow, any agent — regardless of framework — should be able to ask ARIA for a capability by name and receive a compiled, tested binding instantly.

The Babel spec becomes the universal tool interface layer — like HTTP for web services, but for AI capabilities. An ecosystem of tools described in a common format, compiled to any target, discoverable by any agent.

- **Federated registries** — organizations publish curated Babel tool registries with trust tiers: internal tools, verified third-party tools, user-synthesized tools.
- **Continuous improvement** — the system tracks which tools fail or underperform, synthesizes patches, runs regression tests, and promotes improved versions without human intervention.
- **Cross-language support** — Babel spec v2 with `language: javascript`, `language: bash`, enabling non-Python synthesis.
- **Tool economy** — developers publish Babel-compatible tools; usage-based attribution tracks which tools get called and by whom.

The core bet: the bottleneck in AI capability isn't model intelligence — it's tooling infrastructure. ARIA is an attempt to make that infrastructure self-extending.

---

## Team

| | Focus |
|---|---|
| **E1** | Voice pipeline (Voxtral), intent parsing, Mistral Large planner, graph validation |
| **E2** | Babel Tool Standard — spec, compiler, registry, runtime, CLI, pre-built tools, HTTP server |
| **E3** | AG2 GraphFlow execution, Mistral Vibe synthesis pipeline, W&B Weave observability |
| **E4** | React frontend, AG-UI event stream, 11Labs TTS integration |

Built in 48 hours.
