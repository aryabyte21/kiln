# OpenSwarm — Real Execution Design

**Date**: 2026-02-25
**Status**: Approved
**Goal**: Replace the entire simulation layer with real OpenClaw orchestration, making OpenSwarm a genuine Kubernetes-like swarm manager for OpenClaw AI agent fleets.

---

## Problem

The current implementation is a 20,000-line simulation. Every "task execution" is `time.Sleep()` + `generateMockOutput()`. No LLM calls, no OpenClaw integration, no real agents. The dashboard renders fabricated data beautifully — pure fiction.

## Architecture

```
User → swarm.yaml (desired state) → Control Plane → OpenClaw instances (actual state)
                                          ↓                    ↓
                                     Reconciliation      Real LLM calls
                                     loop (5s tick)      via Ollama
```

### K8s ↔ OpenSwarm Mapping

| Kubernetes           | OpenSwarm                 | Purpose                               |
| -------------------- | ------------------------- | ------------------------------------- |
| Pod                  | OpenClaw Gateway instance | Smallest deployable unit              |
| Deployment           | Agent spec in swarm.yaml  | Desired replicas + scaling rules      |
| kubelet              | Executor                  | Sends tasks to real OpenClaw via HTTP |
| kube-scheduler       | Scheduler                 | Scores agents, routes tasks           |
| Node Pool            | Instance Pool             | Manages Docker containers             |
| PodSpec              | SOUL.md + model config    | Agent personality + LLM backend       |
| Desired state (YAML) | swarm.yaml                | Declarative specification             |
| Control loop         | Lifecycle reconciliation  | Ensure actual = desired               |
| ResourceQuota        | Budget tracker            | Cost limits                           |
| HPA                  | Genetics + scaler         | Evolve + scale based on real metrics  |

## Components

### 1. Instance Pool (`internal/pool/`)

**NEW package.** Manages OpenClaw Gateway containers via Docker SDK.

- `Spawn(role, soulMD, modelConfig) → Instance` — Create Docker container with OpenClaw image, inject SOUL.md, configure Ollama provider
- `Terminate(id)` — Graceful shutdown + container removal
- `HealthCheck(instance) → bool` — HTTP ping to OpenClaw's health endpoint
- `Available() → []Instance` — List unassigned instances
- `ByRole(swarm, role) → []Instance` — List instances for a role

Each instance is a Docker container running `openclawai/openclaw:latest` with:

- Workspace volume containing SOUL.md and settings.json
- Environment: `OPENCLAW_GATEWAY_TOKEN`, `OPENCLAW_GATEWAY_PORT`
- Connected to the Docker network for access to Ollama

### 2. Lifecycle Manager (`internal/lifecycle/`) — REWRITE

Reconciliation loop running every 5 seconds:

```
for each agentSpec in swarm:
    desired = agentSpec.Replicas.Min (or scaled count)
    actual  = pool.CountByRole(swarm, role)
    if actual < desired: spawn more
    if actual > desired: drain + terminate excess
    for each instance:
        if not healthy: replace (terminate + spawn fresh)
```

Health checks via real HTTP calls to OpenClaw instances.

### 3. Executor (`internal/executor/`) — REWRITE

Real HTTP calls to OpenClaw's OpenAI-compatible API:

```
POST http://<instance-addr>:18789/v1/chat/completions
Authorization: Bearer <token>
Content-Type: application/json

{
  "model": "openclaw",
  "messages": [{"role": "user", "content": "<task input>"}],
  "stream": true
}
```

Response provides:

- `choices[0].message.content` — real output
- `usage.prompt_tokens` — real token count
- `usage.completion_tokens` — real token count
- `usage.total_tokens` — real total

Streaming mode: parse SSE chunks, broadcast to dashboard in real-time.

### 4. Ollama (Shared Model Service)

Single Ollama instance serves all OpenClaw gateways:

- Model: `qwen2.5:7b` (5GB VRAM, fast on M-series Macs)
- Exposes OpenAI-compatible API at `http://ollama:11434/v1`
- All OpenClaw instances' `settings.json` point to it

### 5. Agent Workspaces

Dynamically generated per agent instance:

```
/tmp/openswarm-workspaces/<instance-id>/
├── SOUL.md          # Role-specific instructions (from swarm.yaml `soul` field)
└── settings.json    # Ollama provider config
```

settings.json template:

```json
{
  "models": {
    "providers": {
      "ollama": {
        "baseUrl": "http://ollama:11434/v1",
        "api": "openai-completions",
        "apiKey": "ollama-local"
      }
    }
  },
  "agents": {
    "defaults": {
      "model": { "primary": "ollama/<model>" }
    }
  }
}
```

## What Stays (Already Works)

- PostgreSQL + TimescaleDB + sqlc store
- Redis registry + budget tracking
- NATS JetStream messaging (task routing, pipeline, audit)
- Scheduler (agent scoring, queue-depth-weighted assignment)
- SSE hub → dashboard real-time updates
- Agent Genetics engine (now optimizing REAL fitness data)
- Audit hash-chaining
- Dashboard React Flow graph
- CLI (Cobra)
- swarm.yaml parsing + validation

## What Gets Built/Rewritten

| Package               | Action                                       | Lines Est. |
| --------------------- | -------------------------------------------- | ---------- |
| `internal/pool/`      | NEW — Docker SDK, container lifecycle        | ~400       |
| `internal/executor/`  | REWRITE — Real HTTP client for OpenClaw      | ~300       |
| `internal/lifecycle/` | REWRITE — Reconciliation loop, real health   | ~250       |
| `docker-compose.yml`  | UPDATE — Add Ollama service                  | ~20        |
| `swarm.yaml` schema   | UPDATE — Add `soul` field for inline SOUL.md | ~10        |

## Docker Compose Changes

```yaml
services:
  ollama:
    image: ollama/ollama
    ports: ['11434:11434']
    volumes: [ollama-data:/root/.ollama]
    healthcheck:
      test: ['CMD', 'curl', '-f', 'http://localhost:11434/api/tags']
      interval: 10s
      timeout: 5s
      retries: 5

  # OpenClaw instances are spawned dynamically by the control plane.
  # No hardcoded openclaw-1, openclaw-2, etc.
  # The control plane uses Docker SDK to create/destroy containers.
```

## Model Selection

For MacBook Pro 36GB RAM:

- Default: `qwen2.5:7b` — best quality/speed ratio
- Light: `llama3.2:3b` — fastest, good enough for demos
- Heavy: `qwen2.5:14b` — better quality, still fits in memory

## Success Criteria

1. `openswarm apply swarm.yaml` → real OpenClaw containers spawn
2. Submit a task → real LLM response with real tokens
3. Dashboard shows real output, real latency, real token counts
4. Scale up: increase replicas → new containers appear
5. Failure recovery: kill a container → control plane replaces it
6. News pipeline: 5 real agents, real article processing, real output
