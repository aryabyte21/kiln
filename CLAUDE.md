# OpenSwarm — Claude Code Configuration

## Project Overview

OpenSwarm is a Kubernetes-like orchestrator for fleets of OpenClaw AI agent instances. Go control plane + TypeScript SDK + Next.js dashboard. CS5224 (Cloud Computing) project at NUS.

## Architecture

- **Control Plane**: Go 1.23, `apps/controlplane/`, `github.com/openswarm/openswarm` module
- **Dashboard**: Next.js 15 + React 19 + React Flow, `apps/web/`
- **OpenClaw Client**: TypeScript WebSocket client, `packages/openclaw-client/`
- **Shared Types**: `packages/types/`
- **Message Bus**: NATS JetStream
- **State**: Redis 7 (registry, heartbeats, L2 memory, budget)
- **Database**: PostgreSQL 16 + TimescaleDB + pgvector
- **Observability**: Prometheus + Grafana + OpenTelemetry

## Code Conventions

### Go (apps/controlplane/)

- Use stdlib `net/http` with Go 1.22+ pattern matching (no frameworks)
- Use `slog` for structured logging (JSON in prod, text in dev)
- Domain types in `internal/domain/`
- Each subsystem in its own `internal/{name}/` package
- Tests: `go test ./...` from `apps/controlplane/`
- Format: `gofmt`
- Vet: `go vet ./...`
- Error handling: wrap with `fmt.Errorf("context: %w", err)`, never swallow errors
- Context propagation: pass `context.Context` as first param

### TypeScript (apps/web/, packages/)

- Strict TypeScript, no `any`
- pnpm workspace, Nx orchestration
- React: functional components, hooks only
- Next.js App Router (not Pages)
- Imports: use `@cs5224/types` for shared types

### SQL (apps/controlplane/internal/store/migrations/)

- Sequential numbered migration files: `001_*.up.sql`, `002_*.up.sql`
- Use TimescaleDB hypertables for time-series data
- Use pgvector for embedding storage

## Key Files

- `apps/controlplane/cmd/openswarm-controller/main.go` — Control plane entry point
- `apps/controlplane/cmd/openswarm/main.go` — CLI entry point
- `apps/controlplane/internal/domain/` — All domain types
- `apps/controlplane/internal/api/server.go` — HTTP router + handlers
- `docker-compose.yml` — Local dev stack (TimescaleDB, Redis, NATS)
- `examples/news-pipeline/swarm.yaml` — Reference swarm manifest
- `.claude/plans/merry-giggling-zebra.md` — Master implementation plan

## Context7 Library IDs (for documentation lookups)

When you need docs for any of these technologies, use the Context7 MCP `query-docs` tool with these library IDs:

| Technology      | Library ID                           | Notes                                            |
| --------------- | ------------------------------------ | ------------------------------------------------ |
| OpenClaw        | `/openclaw/openclaw`                 | WebSocket protocol, sessions, tools, multi-agent |
| OpenClaw (full) | `/llmstxt/openclaw_ai_llms-full_txt` | Complete docs (35K+ snippets)                    |
| NATS Go         | `/nats-io/nats.go`                   | JetStream, queue groups, request-reply           |
| NATS Docs       | `/nats-io/nats.docs`                 | General NATS architecture and patterns           |
| React Flow      | `/xyflow/web`                        | Custom nodes/edges, animations, layout           |
| Next.js         | `/vercel/next.js`                    | App Router, SSR, API routes                      |
| Next.js (full)  | `/llmstxt/nextjs_llms-full_txt`      | Complete docs (40K+ snippets)                    |
| pgx (Go PG)     | `/jackc/pgx`                         | PostgreSQL driver for Go                         |
| go-redis        | `/redis/go-redis`                    | Redis client for Go                              |
| Cobra CLI       | `/spf13/cobra`                       | CLI framework for Go                             |

**Usage**: Before implementing any feature touching these technologies, query the relevant docs:

```
mcp__plugin_context7_context7__query-docs(libraryId="/nats-io/nats.go", query="JetStream pull subscriber with queue groups")
```

## NATS Subject Hierarchy

```
swarm.{name}.agent.register
swarm.{name}.agent.heartbeat
swarm.{name}.agent.deregister
swarm.{name}.task.submit
swarm.{name}.task.assign.{agentId}
swarm.{name}.task.result.{taskId}
swarm.{name}.pipeline.{subject}
swarm.{name}.budget.alert
swarm.{name}.budget.exceeded
swarm.{name}.audit.event
swarm.{name}.genome.fitness
swarm.{name}.genome.evolved
```

## Redis Key Schema

```
osw:registry:{agentId}           → HASH
osw:heartbeat:{agentId}          → HASH (TTL 30s)
osw:tasks:pending:{swarm}:{role} → SORTED SET
osw:tasks:active:{agentId}       → LIST
osw:memory:l2:{swarm}:{key}      → STRING (TTL)
osw:budget:{swarm}               → HASH
osw:lock:{resource}              → STRING (TTL)
```

## API Routes (Control Plane :9090)

```
GET  /healthz
POST /api/v1/swarms
GET  /api/v1/swarms
GET  /api/v1/swarms/{name}
DELETE /api/v1/swarms/{name}
GET  /api/v1/swarms/{name}/agents
GET  /api/v1/swarms/{name}/agents/{id}
POST /api/v1/swarms/{name}/agents/{role}/scale
POST /api/v1/swarms/{name}/tasks
GET  /api/v1/swarms/{name}/tasks
GET  /api/v1/swarms/{name}/tasks/{id}
GET  /api/v1/swarms/{name}/budget
GET  /api/v1/swarms/{name}/audit
GET  /api/v1/swarms/{name}/audit/verify
GET  /api/v1/swarms/{name}/genomes
POST /api/v1/swarms/{name}/genomes/evolve
GET  /api/v1/swarms/{name}/genomes/{id}
POST /api/v1/policies
GET  /api/v1/policies
GET  /api/v1/policies/{name}
GET  /api/v1/swarms/{name}/events          # SSE stream
```

## Build & Test

```bash
# Go control plane
cd apps/controlplane && go vet ./... && go test ./...
go build ./cmd/openswarm-controller
go build ./cmd/openswarm

# Full stack
docker compose up -d
docker compose --profile observability up -d  # with Prometheus + Grafana

# Frontend
pnpm --filter @cs5224/web dev

# Nx
pnpm nx run-many --target=build
pnpm nx run-many --target=test
```

## Git Conventions

- Branch: `feature/<name>`, `fix/<name>`, `chore/<name>`
- Commits: conventional commits (`feat:`, `fix:`, `chore:`, `docs:`, `ci:`)
- PR: always to `main`, squash merge
- Never commit `.env`, credentials, or API keys

## Week-by-Week Milestones

| Week | Dates           | Goal                                                                 |
| ---- | --------------- | -------------------------------------------------------------------- |
| 1    | Feb 24 – Mar 2  | Infrastructure + scaffold, Docker Compose, domain types, CLI         |
| 2    | Mar 3 – Mar 9   | Agent registry, OpenClaw client, dashboard nodes, preliminary report |
| 3    | Mar 10 – Mar 16 | Task scheduler, NATS messaging, task execution                       |
| 4    | Mar 17 – Mar 23 | Audit trail, policies, cost tracking                                 |
| 5    | Mar 24 – Mar 30 | News pipeline demo (5 agents end-to-end)                             |
| 6    | Mar 31 – Apr 6  | Bankruptcy, HITL, auto-scaling, observability                        |
| 7    | Apr 7 – Apr 13  | Agent Genetics engine                                                |
| 8    | Apr 14 – Apr 19 | Polish, K3s deploy, final report, demo video                         |
