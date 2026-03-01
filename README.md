# Babel

**A self-evolving tool registry for AI agents.**

Babel is a local-first platform where AI agents can discover, execute, and — when a tool doesn't exist yet — synthesize new tools on the fly. No MCP servers, no restarts, no manual wiring. Ask for something, and Babel figures out how to do it.

---

## The Problem

Every AI agent framework (LangChain, AG2, CrewAI, etc.) requires you to pre-define tools before the agent can use them. Need a new tool? Stop the agent, write the code, register it, restart. This creates a bottleneck: agents are only as capable as the tools you've already built.

## The Solution

Babel removes this bottleneck entirely:

1. **You ask** something in natural language via Babel Chat
2. **ARIA** (the planning agent) decomposes your request into a task graph
3. If a required tool **doesn't exist**, ARIA triggers **Vibe** (Mistral's coding agent) to synthesize it — spec, implementation, and tests — in seconds
4. The new tool is **hot-loaded** into the registry. No restart needed.
5. ARIA continues execution with the freshly created tool
6. Optionally, **push the tool** to a remote Babel registry for others to use

```
"What's the weather in Tokyo and convert it to Fahrenheit?"

  ARIA: I need weather_lookup (exists) and temp_converter (missing)
    → Vibe synthesizes temp_converter in ~15 seconds
    → Tool registered, tested, loaded
    → ARIA executes the full plan
    → Answer delivered
```

---

## System Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        User's Machine                           │
│                                                                  │
│  ┌─────────────┐     ┌──────────────────────────────────────┐   │
│  │  Babel Chat  │────▶│          BabelServer (:8765)         │   │
│  │  (React UI)  │◀────│                                      │   │
│  └─────────────┘ SSE │  ┌────────────┐  ┌────────────────┐  │   │
│                      │  │   ARIA     │  │  Tool Registry │  │   │
│                      │  │  Planner   │  │   (SQLite +    │  │   │
│                      │  │  + Graph   │  │    in-memory)  │  │   │
│                      │  │  Executor  │  │                │  │   │
│                      │  └─────┬──────┘  └───────▲────────┘  │   │
│                      │        │                 │            │   │
│                      │        │ missing tool?   │ register   │   │
│                      │        ▼                 │            │   │
│                      │  ┌─────────────────────────────┐     │   │
│                      │  │     Vibe Callback Handler   │     │   │
│                      │  └────────────▲────────────────┘     │   │
│                      └───────────────┼───────────────────────┘   │
│                                      │                           │
│                          POST /vibe/callback                     │
│                          (spec.yaml + impl.py)                   │
│                                      │                           │
│  ┌───────────────────────────────────┴───────────────────────┐   │
│  │              Vibe Tool Service (:8002)                    │   │
│  │                    (Docker)                               │   │
│  │                                                           │   │
│  │   ┌─────────────┐    ┌──────────────────────────────┐    │   │
│  │   │  Synthesis   │───▶│  Mistral Vibe CLI (devstral) │    │   │
│  │   │  Pipeline    │◀───│  Generates spec.yaml +       │    │   │
│  │   │              │    │  impl.py in workspace        │    │   │
│  │   └─────────────┘    └──────────────────────────────┘    │   │
│  └───────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │  Local Registry (disk)                                    │   │
│  │  registry/tools/                                          │   │
│  │    com.aria.tools.weather/1.0.0/spec.yaml + weather.py    │   │
│  │    com.aria.tools.news/1.0.0/spec.yaml + news.py          │   │
│  │    com.aria.tools.<synthesized>/1.0.0/spec.yaml + impl.py │   │
│  └───────────────────────────────────────────────────────────┘   │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
                              │
                    (optional) push to
                              ▼
                 ┌──────────────────────┐
                 │   Remote Babel       │
                 │   Registry (hosted)  │
                 └──────────────────────┘
```

---

## Components

### Babel Registry (`babel_registry/`)

The core of the system. A local HTTP service that stores, discovers, and executes tools.

| Endpoint | Description |
|----------|-------------|
| `GET /tools` | List all tools with LLM-ready JSON schemas |
| `GET /tools/{id}` | Get a single tool's spec and schema |
| `POST /tools/register` | Register a new tool (multipart: spec.yaml + impl.py) |
| `POST /tools/{id}/execute` | Execute a tool with arguments |
| `POST /tools/{id}/test` | Run a tool's test fixtures |
| `POST /aria/start` | Submit a request, get a task graph plan |
| `POST /aria/execute/{run_id}` | Execute a planned task graph |
| `GET /aria/stream/{run_id}` | SSE stream of execution events |
| `POST /vibe/synthesize` | Trigger tool synthesis via Vibe |
| `POST /vibe/callback` | Receive synthesized tool from Vibe |

**Storage**: Tools are persisted as `registry/tools/{tool_id}/1.0.0/spec.yaml + impl.py` on disk, with metadata indexed in SQLite for fast queries.

### ARIA Agent (`aria/`)

The planning and execution brain. ARIA takes a natural language request and:

1. **Plans** — Calls Mistral Large to decompose the request into a directed task graph (nodes = subtasks, edges = dependencies)
2. **Detects gaps** — Compares required tools against the registry; flags missing ones
3. **Orchestrates synthesis** — Triggers Vibe to create missing tools, waits for registration
4. **Executes** — Runs the task graph using AG2 multi-agent framework, with topological ordering for correct dependency resolution
5. **Streams** — Pushes real-time events (node_start, tool_call, tool_result, node_complete) via SSE

### Vibe Tool Service (`vibe_tool/`)

A FastAPI wrapper around Mistral's Vibe CLI (coding agent). Runs as a Docker container for isolation.

**Synthesis pipeline**:
1. Receives synthesis request (tool name, description, inputs, outputs)
2. Prepares a workspace with `CONTEXT.md` (Babel spec format, implementation rules, testing requirements)
3. Spawns Vibe CLI subprocess in streaming mode
4. Vibe generates `spec.yaml` + `impl.py`, tests them
5. Artifacts are validated, then POSTed back to BabelServer via webhook
6. BabelServer runs fixture tests, saves to disk, and registers the tool

### Babel Chat (`aria-ui/`)

React frontend providing a chat interface for ARIA. Shows:
- Plan visualization (task graph with nodes and edges)
- Synthesis progress when new tools are being created
- Real-time execution tracking via SSE
- Final results

---

## The Babel Tool Format

Every tool in Babel follows a simple, framework-agnostic pattern:

**`spec.yaml`** — What the tool does:
```yaml
babel_version: "1.0"

tool:
  id: com.aria.tools.weather
  name: weather
  version: 1.0.0
  description: Get current weather for a city
  author: vibe_tool

interface:
  inputs:
    - name: city
      type: string
      description: City name
      required: true
  outputs:
    - name: temperature
      type: float
      description: Temperature in Celsius

testing:
  fixtures:
    - input:
        city: "London"
      expected_output_contains:
        - temperature
```

**`impl.py`** — How it works:
```python
REQUIRED_ENV_VARS = []

def weather(**kwargs) -> dict:
    city = kwargs.get("city", "London")
    # ... actual API call ...
    return {"temperature": 15.2, "condition": "cloudy"}
```

This pattern is framework-agnostic. Babel includes **compilers** that convert specs into AG2, Mistral, LangChain, or Pydantic AI tool definitions automatically.

---

## How It All Connects

```
User: "Analyze the latest arxiv papers on LLMs and email me a summary"

  1. POST /aria/start
     → ARIA fetches available tools from registry
     → Calls Mistral Large with request + tool list
     → Returns task graph:
         [arxiv_fetcher] → [topic_analyzer] → [send_email]
         All tools exist ✓

  2. POST /aria/execute/{run_id}
     → Topological sort: arxiv_fetcher first, then topic_analyzer, then send_email
     → Each node: spawn AG2 agent, call tool via HTTP, collect result
     → Stream events to frontend via SSE

  3. GET /aria/stream/{run_id}
     → node_start: arxiv_fetcher
     → tool_call: arxiv_fetcher(query="LLMs", max_results=10)
     → tool_result: [{title: "...", abstract: "..."}]
     → node_complete: arxiv_fetcher
     → node_start: topic_analyzer (receives arxiv results as context)
     → ...
     → flow_complete: "Here's your summary: ..."
```

**When a tool is missing:**

```
User: "Get Bitcoin price and predict next week's trend"

  1. POST /aria/start
     → Tools needed: crypto_price (exists), price_predictor (MISSING)
     → Response includes missing_tools: ["price_predictor"]

  2. BabelServer triggers synthesis:
     → POST to Vibe Tool: synthesize "price_predictor"
     → Vibe CLI generates spec.yaml + impl.py
     → Tests pass inside container
     → POST /vibe/callback with artifacts
     → BabelServer validates, saves, registers

  3. Tool appears in registry (~15-30 seconds)
     → ARIA re-plans with full tool set
     → Execution proceeds normally
```

---

## Security Model

- **Vibe runs in Docker** — Synthesized code executes in an isolated container, not on the host
- **Tools are tested before registration** — Fixture tests must pass before a tool enters the registry
- **Env vars are declared explicitly** — Each tool declares its `REQUIRED_ENV_VARS`; missing vars are flagged before execution
- **Local-first** — Everything runs on the user's machine. No data leaves unless you explicitly push to a remote registry
- **API keys stay local** — Keys in `.env` are passed to Docker via environment variables, never embedded in code

---

## Getting Started

### Prerequisites

- Python 3.12+
- Docker & Docker Compose
- Node.js 18+ (for the UI)
- A Mistral API key

### 1. Clone and set up

```bash
git clone <repo-url> babel_project
cd babel_project
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 2. Configure environment

```bash
# Create .env with your API keys
cat > .env << 'EOF'
MISTRAL_API_KEY=your_mistral_key_here
EOF
```

### 3. Start the Vibe Tool (Docker)

```bash
docker compose build vibe_tool
docker compose up vibe_tool -d
```

### 4. Start BabelServer

```bash
python run_server.py
# Server starts on http://localhost:8765
```

### 5. Start the UI

```bash
cd aria-ui
npm install
npm run dev
# UI starts on http://localhost:5173
```

### 6. Use it

Open `http://localhost:5173` and start asking questions. ARIA will plan, synthesize missing tools, and execute — all automatically.

---

## Project Structure

```
babel_project/
├── babel_registry/          # Core registry + HTTP server
│   ├── server.py            # FastAPI endpoints (port 8765)
│   ├── registry.py          # In-memory tool registry
│   ├── sqlite_registry.py   # SQLite-backed persistence
│   ├── loader.py            # Load tools from spec.yaml + impl.py
│   ├── spec.py              # BabelTool spec model
│   └── compiler/            # Framework adapters (ag2, langchain, etc.)
├── aria/                    # ARIA planning + execution agent
│   ├── planner.py           # Task graph generation (Mistral Large)
│   └── graph_flow.py        # Multi-agent graph executor (AG2)
├── vibe_tool/               # Vibe CLI wrapper service
│   ├── Dockerfile           # Container definition
│   ├── app/
│   │   ├── main.py          # FastAPI app (port 8002)
│   │   ├── synthesis/       # Pipeline, runner, prompt builder
│   │   └── jobs/            # Job tracking + SSE streaming
│   └── vibe_config.toml     # Vibe CLI configuration
├── aria-ui/                 # React chat frontend
│   └── src/App.tsx          # Main UI component
├── registry/tools/          # Persisted tools (spec.yaml + impl.py)
├── docker-compose.yml       # Vibe Tool service definition
├── run_server.py            # BabelServer entry point
└── .env                     # API keys (git-ignored)
```

---

## Local vs Remote Registry

| | Local Registry | Remote Registry |
|---|---|---|
| **Where** | `registry/tools/` on your machine | Hosted Babel service |
| **Who** | Just you | Shared across users |
| **Tools** | Hand-written + synthesized | Curated, versioned |
| **Push** | Automatic on synthesis | Opt-in per tool |
| **Pull** | N/A | On-demand download |

When Vibe synthesizes a new tool, it lives in your local registry by default. If it's useful, you can push it to the remote Babel registry for others to discover and use.

---

## Framework Support

Babel tools are framework-agnostic by design. The `compiler/` module converts Babel specs to:

| Framework | Compiler | Output |
|-----------|----------|--------|
| AG2 (AutoGen) | `ag2.py` | Function tool with schema |
| Mistral | `mistral.py` | Mistral tool format |
| LangChain | `langchain.py` | `@tool` decorated function |
| Pydantic AI | `pydantic_ai.py` | Pydantic tool model |

This means any tool in the registry — whether hand-written or synthesized — works with any supported framework without modification.
