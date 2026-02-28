# Babel — Adaptive Runtime Intelligence Architecture

> Voice-driven agentic OS that plans workflows, builds missing tools at runtime, and grows smarter with every request.

Built for the Mistral Worldwide Hackathon 2026 (Singapore).

## Project Overview

Babel is an end-to-end agentic system. User speaks a complex request → Babel understands intent (Voxtral STT), plans a task graph (Mistral Large), identifies tool gaps, synthesizes missing tools via Mistral Vibe, executes the graph (AG2), streams everything live (AG-UI), and responds in voice (11 Labs TTS).

**ARIA** is the Toolsmith agent — the one that identifies tool gaps, synthesizes missing tools via Vibe, and resolves them. **Babel Registry** is where tools are stored, versioned, and served from. Think "npm for agent tools."

## Core Agent Architecture

The system runs 4 agents in a linear pipeline:

```
Interpreter → Planner → ARIA (Toolsmith) → Executor
                              ↕
                        Babel Registry
```

### 1. Interpreter Agent
- Input: raw voice/text
- Uses Voxtral Mini (STT) + Mistral Large (intent parsing)
- Output: structured intent object — goal, entities, constraints, dependencies
- Never passes raw transcript downstream

### 2. Planner Agent
- Input: structured intent
- Uses Mistral Large with constrained JSON output
- Builds a task graph: nodes (with agent archetype + required tool), edges (dependencies), gaps (tools not yet available)
- Agent archetypes: `finder`, `executor`, `communicator`, `scheduler`, `resolver`, `validator`
- Output: `{ nodes, edges, gaps }` JSON

### 3. ARIA Agent (Toolsmith)
- Input: task graph with tool requirements
- For each required tool:
  - Query Babel Registry → **hit**: load compiled tool
  - **Miss**: invoke Mistral Vibe synthesis loop
    - Fetch API docs → generate Babel spec + implementation → run test fixtures → fix errors → validate → compile for AG2 → publish to Babel Registry
- Output: fully-resolved graph with all tools loaded and ready

### 4. Executor Agent
- Input: resolved graph (all tools ready)
- Runs via AG2 GraphFlow — parallel where dependencies allow, sequential where they don't
- Streams AG-UI events to frontend in real-time
- Synthesizes final natural language response
- Outputs voice via 11 Labs TTS

## Directory Structure

```
babel/
├── CLAUDE.md
├── LICENSE
├── requirements.txt
├── babel/
│   ├── main.py                        # Entry point
│   ├── agents/
│   │   ├── interpreter.py             # Agent 1: voice/text → structured intent
│   │   ├── planner.py                 # Agent 2: intent → task graph
│   │   ├── aria.py                     # Agent 3 (ARIA): resolve tools (registry + synthesis)
│   │   └── executor.py                # Agent 4: run graph, stream events, respond
│   ├── voice/
│   │   ├── voxtral_stt.py             # Voxtral Mini STT client
│   │   └── elevenlabs_tts.py          # 11 Labs TTS client
│   ├── synthesis/
│   │   ├── vibe_wrapper.py            # Mistral Vibe subprocess (generate + test loop)
│   │   ├── synthesis_prompt.py        # Prompt templates for tool generation
│   │   └── api_docs_store/            # Pre-fetched API docs for common services
│   ├── streaming/
│   │   ├── agui_emitter.py            # AG-UI event emitter
│   │   └── event_types.py             # Custom event type definitions
│   └── response/
│       └── response_synthesizer.py    # Natural language summary from graph results
├── aria/                              # ARIA — the toolsmith agent
│   ├── aria_agent.py                  # ARIA toolsmith logic (resolve, synthesize, register)
│   ├── vibe_synthesis.py              # Mistral Vibe integration for tool generation
│   └── tool_resolver.py              # Registry lookup + gap detection
├── registry/                          # Babel Registry — tool storage & standard
│   ├── spec/
│   │   └── babel.schema.json          # JSON Schema for Babel tool specs
│   ├── compiler/
│   │   ├── __init__.py
│   │   ├── base.py                    # Abstract compiler adapter
│   │   ├── adapters/
│   │   │   ├── ag2_adapter.py         # Compile spec → AG2 register_function
│   │   │   └── raw_python_adapter.py  # Compile spec → standalone Python
│   │   └── validator.py               # Spec validation before compile
│   ├── runtime/
│   │   ├── __init__.py
│   │   └── babel_runtime.py           # Load, compile, cache tools
│   ├── store/
│   │   ├── __init__.py
│   │   ├── local_registry.py          # SQLite-backed tool registry
│   │   └── migrations/
│   │       └── 001_initial.sql
│   └── cli/
│       └── babel_cli.py               # CLI: compile, install, publish, generate, registry
├── tools/                             # Pre-built tools (each has spec.yaml + implementation.py)
│   ├── com.babel.tools.restaurant_search/
│   ├── com.babel.tools.contacts_lookup/
│   ├── com.babel.tools.whatsapp_send/
│   ├── com.babel.tools.gcal_create/
│   ├── com.babel.tools.web_search/
│   ├── com.babel.tools.weather/
│   ├── com.babel.tools.maps_directions/
│   └── com.babel.tools.email_send/
├── frontend/
│   ├── package.json
│   └── src/
│       ├── App.jsx
│       ├── components/
│       │   ├── TaskGraph.jsx          # Graph visualization (nodes, edges, status)
│       │   ├── SynthesisStream.jsx    # Live code streaming from Vibe
│       │   └── AgentLog.jsx           # Agent reasoning log
│       └── hooks/
│           └── useAGUIStream.js       # AG-UI SSE connection hook
└── observability/
    ├── weave_logger.py                # W&B Weave instrumentation
    └── wandb_dashboard.py             # Dashboard config
```

## Naming Conventions

- **Babel** = the overall system/project AND the tool registry (`registry/` directory)
- **ARIA** = the Toolsmith agent — resolves tools, synthesizes missing ones (`aria/` directory)
- **Babel tool spec** = the YAML format for framework-agnostic tool definitions
- Tool IDs: `com.babel.tools.<name>`
- Agent archetypes (used by Planner): `finder`, `executor`, `communicator`, `scheduler`, `resolver`, `validator`
- Core agents (the 4-agent pipeline): `interpreter`, `planner`, `aria` (toolsmith), `executor`

## Tech Stack

| Layer | Technology |
|---|---|
| Language | Python 3.10+ (backend), React/JS (frontend) |
| STT | Voxtral Mini (Mistral API) |
| LLM | Mistral Large (planning, intent parsing), Mistral Vibe (tool synthesis) |
| Orchestration | AG2 + GraphFlow |
| Streaming | AG-UI protocol (SSE) |
| Frontend | React + custom graph visualization |
| TTS | 11 Labs |
| Observability | W&B Weave |
| Registry DB | SQLite |

## Key Patterns

### Babel Tool Spec (YAML)
Every tool is defined as a `.babel.yaml` spec with: metadata, typed inputs/outputs, implementation details, compilation targets, and test fixtures. The spec is the source of truth — framework bindings are generated from it.

### Babel Runtime
```python
from registry.runtime import BabelRuntime

runtime = BabelRuntime(target="ag2")
tool = runtime.load("com.babel.tools.weather@1.0.0")  # compile + cache
```

### ARIA Synthesis Loop
Tool gap found → ARIA queries Babel Registry → miss → invoke Mistral Vibe → generate spec + implementation → run test fixtures → fix errors → validate → compile for AG2 → publish to Babel Registry. Only returns when tests pass.

### AG-UI Events
All agent activity streams as typed events: `GRAPH_BUILT`, `NODE_START`, `TOOL_CALL`, `ARIA_SYNTHESIS_START`, `CODE_DELTA`, `BABEL_REGISTRY_QUERY`, `BABEL_REGISTRY_MISS`, `BABEL_PUBLISH`, `GRAPH_COMPLETE`, etc.

## Environment Variables

```
MISTRAL_API_KEY
ELEVENLABS_API_KEY
WANDB_API_KEY
GOOGLE_PLACES_API_KEY
GOOGLE_CALENDAR_API_KEY
SERPER_API_KEY
```

## Commands

```bash
# Backend
python babel/main.py

# Frontend
cd frontend && npm run dev

# Babel Registry CLI
python registry/cli/babel_cli.py compile tools/weather.babel.yaml --target ag2
python registry/cli/babel_cli.py publish tools/weather.babel.yaml
python registry/cli/babel_cli.py registry list
python registry/cli/babel_cli.py generate "A tool that searches LinkedIn profiles"

# Seed registry with pre-built tools
python registry/cli/babel_cli.py registry seed

# Test (text mode)
python babel/test_request.py --request "Book a table for two..."
```

## Development Guidelines

- Each pre-built tool must have a complete Babel spec, verified implementation, passing test fixtures, and be published to Babel Registry
- Planner output is always a JSON graph with `nodes`, `edges`, and `gaps` arrays
- Interpreter always outputs structured JSON intent — never raw transcript
- ARIA must pass all test fixtures before registering a tool — no one-shot generation
- AG-UI events stream to frontend in real-time; the agent's reasoning IS the UI
- Pre-built tools cover common demo scenarios so the system works even if synthesis fails
- The 4-agent pipeline is strictly linear: Interpreter → Planner → ARIA → Executor
