# End-to-End Real Execution + UI Overhaul Design

**Date:** 2026-02-25
**Status:** Approved
**Goal:** Make OpenSwarm run real AI agent swarms end-to-end (not simulation), redesign the dashboard for demo-readiness, and prove generality beyond news pipelines.

## Differentiation from DigitalOcean + OpenClaw

DigitalOcean deploys ONE OpenClaw instance on App Platform — they are a hosting provider.
OpenSwarm is Kubernetes for AI agent fleets — declarative YAML specs, automatic container orchestration, pipeline topology, budget enforcement, reconciliation loops, auto-scaling, real-time dashboard.

| Capability      | DigitalOcean  | OpenSwarm                                 |
| --------------- | ------------- | ----------------------------------------- |
| Deploy agents   | 1 instance    | N instances, declarative                  |
| Scaling         | Manual resize | Auto-scale on queue_depth/utilization     |
| Pipelines       | None          | DAG topology with automatic downstream    |
| Budget control  | None          | Per-swarm budgets with bankruptcy         |
| Monitoring      | Basic logs    | Real-time DAG visualization + metrics     |
| Agent lifecycle | Manual        | Reconciliation loop (like K8s controller) |

## Part 1: Agent Worker Binary

Instead of depending on `openclawai/openclaw:latest` (designed for messaging platforms, not API serving), we build a minimal Go binary:

### `apps/agent-worker/main.go` (~100 lines)

- Reads `SOUL.md` from `/workspace/SOUL.md` → system prompt
- Reads `config.json` from `/workspace/config.json` → Ollama URL, model name
- Exposes `POST /v1/chat/completions` — OpenAI-compatible:
  1. Prepend system prompt from SOUL.md
  2. Forward to Ollama API
  3. Return response with real token usage
- Exposes `GET /healthz` → `{status: "ok", uptime: "2m30s", model: "qwen2.5:7b", role: "summarizer"}`
- Multi-stage Docker build → ~15MB Alpine image

### `Dockerfile.agent`

```dockerfile
FROM golang:1.23-alpine AS builder
WORKDIR /app
COPY apps/agent-worker/ .
RUN go build -o /agent-worker .

FROM alpine:3.19
RUN apk add --no-cache ca-certificates curl
COPY --from=builder /agent-worker /usr/local/bin/agent-worker
EXPOSE 8080
CMD ["agent-worker"]
```

### Pool.go Changes

- Default image: `openswarm-agent:latest` (instead of `openclawai/openclaw:latest`)
- Container port: `8080/tcp` (instead of `18789/tcp`)
- Environment: `OLLAMA_URL`, `MODEL_NAME`, `AGENT_ROLE`

## Part 2: Example Swarms (Generality)

### `examples/hello-swarm/swarm.yaml` (2 agents)

- greeter: takes user input, generates a greeting
- formatter: takes greeting, formats it nicely
- Simplest possible pipeline to test end-to-end

### `examples/news-pipeline/swarm.yaml` (5 agents) — already exists

- fetcher → summarizer → classifier → aggregator → notifier
- Updated with `soul:` fields and `model: qwen2.5:7b`

### `examples/code-review/swarm.yaml` (3 agents)

- analyzer: reads code description, identifies issues
- reviewer: reviews analysis, adds recommendations
- reporter: formats final review report

## Part 3: Dashboard Redesign

### 3a. Dark Theme + Professional Polish

- Tailwind dark mode as default (class strategy)
- Color palette: slate-900 background, cyan-400 active, amber-400 warning, red-400 error, emerald-400 success
- Inter font for UI, JetBrains Mono for metrics/code
- Clean sidebar layout with swarm selector + summary stats

### 3b. Live Pipeline Execution View

React Flow node states during task execution:

- **Idle**: subtle border, dim icon
- **Pending**: amber pulsing ring
- **Running**: green glow + spinner, shows "Processing..." label
- **Completed**: green checkmark badge, token count overlay
- **Failed**: red pulse + error icon

Animated edges: data particles flow along edges when pipeline triggers downstream.
Click node → slide-out panel: agent output, tokens, latency, SOUL.md content.

### 3c. Container Monitoring Tab

New tab showing real Docker containers:

- Table: Container ID, role, status, addr, uptime, health
- Health check indicator (green/amber/red)
- Data source: new `GET /api/v1/swarms/{name}/containers` endpoint

### 3d. Real-Time Execution Log

Terminal-style log viewer showing:

- Task submitted → assigned to agent → executing → completed
- Agent output preview
- Pipeline triggers
- Source: existing SSE events (task_running, task_completed, task_failed)

## Part 4: New API Endpoints

| Method | Path                                           | Purpose                          |
| ------ | ---------------------------------------------- | -------------------------------- |
| GET    | `/api/v1/swarms/{name}/containers`             | List Docker containers for swarm |
| GET    | `/api/v1/swarms/{name}/containers/{id}/health` | Health check specific container  |

## Part 5: End-to-End Flow

```
# 1. Start infrastructure
docker compose up -d

# 2. Pull LLM model
docker compose exec ollama ollama pull qwen2.5:7b

# 3. Build agent worker image
docker build -t openswarm-agent -f Dockerfile.agent .

# 4. Start control plane
cd apps/controlplane && go run ./cmd/openswarm-controller

# 5. Open dashboard
cd apps/web && pnpm dev  # → http://localhost:3000

# 6. Apply a swarm
cd apps/controlplane && go run ./cmd/openswarm apply ../../examples/hello-swarm/swarm.yaml

# 7. See containers spawn in docker ps
docker ps --filter label=managed-by=openswarm

# 8. Submit a task (CLI or dashboard)
go run ./cmd/openswarm tasks hello-swarm submit "Hello world!"

# 9. Watch in dashboard: task flows through pipeline with real LLM output
```

## Success Criteria

1. `docker ps` shows real agent worker containers after `apply`
2. Task submission returns real LLM-generated text (not mock)
3. Pipeline flows: output of agent A becomes input of agent B automatically
4. Dashboard shows live execution in real-time
5. Kill a container → lifecycle manager detects + replaces within 10s
6. Budget tracking works with real token counts
7. Works with multiple example swarms (not just news pipeline)
