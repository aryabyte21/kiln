<div align="center">

# OpenSwarm

**Kubernetes-like orchestrator for fleets of OpenClaw AI agent instances**

[![CI JS](https://github.com/aryabyte21/openswarm/actions/workflows/ci-js.yml/badge.svg)](https://github.com/aryabyte21/openswarm/actions/workflows/ci-js.yml)
[![CI Go](https://github.com/aryabyte21/openswarm/actions/workflows/ci-python-go.yml/badge.svg)](https://github.com/aryabyte21/openswarm/actions/workflows/ci-python-go.yml)
[![Go](https://img.shields.io/badge/Go-1.23-00ADD8?logo=go)](https://go.dev/)
[![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue?logo=typescript)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

_NUS CS5224 Cloud Computing — Spring 2026_

[Architecture](#architecture) · [Quick Start](#quick-start) · [Commands](#commands) · [API](#api-routes)

</div>

---

## What is OpenSwarm?

OpenSwarm manages fleets of AI agent instances the way Kubernetes manages containers. You declare a **swarm manifest** in YAML — agent roles, models, scaling policies, topology — and OpenSwarm handles scheduling, inter-agent messaging, cost tracking, and auto-scaling.

```yaml
apiVersion: openswarm/v1alpha1
kind: Swarm
metadata:
  name: news-pipeline
spec:
  agents:
    - name: researcher
      model: claude-sonnet-4-20250514
      replicas: { min: 2, max: 5 }
      skills: [web-search, summarize]
    - name: writer
      model: claude-sonnet-4-20250514
      dependsOn: [researcher]
      skills: [long-form-writing]
    - name: editor
      model: claude-sonnet-4-20250514
      dependsOn: [writer]
      skills: [fact-check, style-guide]
  topology:
    - from: researcher
      to: writer
      subject: swarm.news-pipeline.pipeline.articles
    - from: writer
      to: editor
      subject: swarm.news-pipeline.pipeline.drafts
  budget:
    maxDailyUSD: 10.00
```

Then apply it:

```bash
openswarm apply -f swarm.yaml
openswarm status news-pipeline
openswarm agents news-pipeline
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Next.js Dashboard                     │
│              React Flow graph · SSE updates              │
│                  shadcn/ui · Drizzle ORM                 │
└────────────────────────┬────────────────────────────────┘
                         │ HTTP + SSE
┌────────────────────────▼────────────────────────────────┐
│                   Go Control Plane                       │
│   stdlib net/http · slog · API :9090 · CLI (Cobra)      │
├──────────┬──────────────┬───────────────┬───────────────┤
│  Store   │   Registry   │     Bus       │    Config     │
│  (pgx)   │  (go-redis)  │  (NATS JS)   │  (YAML)      │
└────┬─────┴──────┬───────┴───────┬───────┴───────────────┘
     │            │               │
     ▼            ▼               ▼
 PostgreSQL    Redis 7       NATS JetStream
 TimescaleDB   heartbeats    4 streams:
 + pgvector    + registry    TASKS, PIPELINE,
               + budget      AUDIT, GENOME
```

| Component           | Stack                                       | Location                    |
| ------------------- | ------------------------------------------- | --------------------------- |
| **Control Plane**   | Go 1.23, stdlib `net/http`, `slog`          | `apps/controlplane/`        |
| **Dashboard**       | Next.js 15, React 19, React Flow, shadcn/ui | `apps/web/`                 |
| **OpenClaw Client** | TypeScript WebSocket client                 | `packages/openclaw-client/` |
| **Shared Types**    | TypeScript                                  | `packages/types/`           |
| **Message Bus**     | NATS JetStream (4 streams)                  | via Docker Compose          |
| **State**           | Redis 7 (registry, heartbeats, budget)      | via Docker Compose          |
| **Database**        | PostgreSQL 16 + TimescaleDB + pgvector      | via Docker Compose          |
| **Observability**   | Prometheus + Grafana + OpenTelemetry        | via Docker Compose          |

---

## Quick Start

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- [Go 1.23+](https://go.dev/dl/)
- [Node.js 22+](https://nodejs.org/) and [pnpm](https://pnpm.io/)

### Setup

```bash
# 1. Clone and install
git clone https://github.com/aryabyte21/openswarm.git
cd openswarm
pnpm install

# 2. Start infrastructure (PostgreSQL, Redis, NATS)
docker compose up -d

# 3. Start the control plane
go run ./apps/controlplane/cmd/openswarm-controller

# 4. Start the dashboard (separate terminal)
pnpm dev:web
```

### Access

| Service            | URL                                                         | Description                                 |
| ------------------ | ----------------------------------------------------------- | ------------------------------------------- |
| **Dashboard**      | [localhost:3000/dashboard](http://localhost:3000/dashboard) | Agent graph, tasks, topology                |
| **Control Plane**  | [localhost:9090/healthz](http://localhost:9090/healthz)     | REST API                                    |
| **Drizzle Studio** | `pnpm db:studio`                                            | Database GUI                                |
| **Prometheus**     | [localhost:9191](http://localhost:9191)                     | Metrics (with `--profile observability`)    |
| **Grafana**        | [localhost:3001](http://localhost:3001)                     | Dashboards (with `--profile observability`) |

---

## Commands

### Development

```bash
pnpm dev:web                    # Next.js dashboard on :3000
pnpm dev:controlplane           # Go control plane on :9090
docker compose up -d            # Infrastructure (Postgres, Redis, NATS)
```

### CLI

```bash
# Build the CLI
cd apps/controlplane && go build ./cmd/openswarm

# Usage
./openswarm apply -f swarm.yaml         # Deploy a swarm
./openswarm apply -f policies/          # Apply policies from directory
./openswarm status                      # List all swarms
./openswarm status <name>               # Swarm detail view
./openswarm agents <swarm>              # List live agents
./openswarm tasks submit <swarm> <msg>  # Submit a task
./openswarm tasks <swarm>               # List tasks
./openswarm policy list                 # List policies
./openswarm down <swarm>                # Tear down a swarm
```

### Build & Test

```bash
# Go control plane
cd apps/controlplane && go vet ./... && go test ./...

# TypeScript
pnpm lint && pnpm typecheck && pnpm build

# Full validation
pnpm check
```

### Database

```bash
pnpm db:generate     # Generate Drizzle migration from schema changes
pnpm db:migrate      # Apply migrations
pnpm db:push         # Push schema directly (dev only)
pnpm db:studio       # Open Drizzle Studio GUI
```

---

## API Routes

Control plane serves on `:9090`:

```
GET    /healthz
POST   /api/v1/swarms
GET    /api/v1/swarms
GET    /api/v1/swarms/{name}
DELETE /api/v1/swarms/{name}
GET    /api/v1/swarms/{name}/agents
GET    /api/v1/swarms/{name}/agents/{id}
POST   /api/v1/swarms/{name}/agents/{role}/scale
POST   /api/v1/swarms/{name}/tasks
GET    /api/v1/swarms/{name}/tasks
GET    /api/v1/swarms/{name}/tasks/{id}
GET    /api/v1/swarms/{name}/budget
GET    /api/v1/swarms/{name}/audit
GET    /api/v1/swarms/{name}/events          (SSE stream)
POST   /api/v1/swarms/{name}/genomes/evolve
POST   /api/v1/policies
GET    /api/v1/policies
```

---

## Repository Structure

```
openswarm/
├── apps/
│   ├── controlplane/           # Go control plane
│   │   ├── cmd/
│   │   │   ├── openswarm-controller/  # Server entry point
│   │   │   └── openswarm/             # CLI entry point
│   │   └── internal/
│   │       ├── api/            # HTTP router + handlers
│   │       ├── bus/            # NATS JetStream wrapper
│   │       ├── config/         # YAML manifest parser
│   │       ├── domain/         # Core domain types
│   │       ├── registry/       # Redis agent registry
│   │       └── store/          # PostgreSQL store + migrations
│   │
│   └── web/                    # Next.js 15 dashboard
│       ├── app/                # App Router pages
│       ├── src/
│       │   ├── components/     # React components (shadcn/ui + dashboard)
│       │   ├── db/             # Drizzle ORM schema + client
│       │   ├── hooks/          # React hooks (SSE, mobile, toast)
│       │   └── lib/            # API client, utilities
│       └── drizzle/            # SQL migrations
│
├── packages/
│   ├── openclaw-client/        # TypeScript WebSocket client for OpenClaw
│   ├── types/                  # Shared TypeScript types
│   ├── eslint-config/          # Shared ESLint flat config
│   └── tsconfig/               # Shared TypeScript configs
│
├── examples/
│   ├── news-pipeline/          # 5-agent news pipeline demo
│   └── hello-swarm/            # Minimal swarm example
│
├── infra/
│   └── prometheus/             # Prometheus scrape config
│
├── docs/
│   └── plans/                  # Architecture and scaling design docs
│
├── docker-compose.yml          # PostgreSQL + Redis + NATS + observability
├── CLAUDE.md                   # Claude Code project config
└── .coderabbit.yaml            # AI PR review config
```

---

## Key Design Decisions

| Decision               | Choice                     | Rationale                                                          |
| ---------------------- | -------------------------- | ------------------------------------------------------------------ |
| Control plane language | Go                         | Low latency, small binary, stdlib HTTP is sufficient               |
| Message bus            | NATS JetStream             | Lightweight, built-in persistence, queue groups for load balancing |
| State store            | Redis                      | Sub-ms reads for heartbeats/registry, TTL-based expiry             |
| Database               | PostgreSQL + TimescaleDB   | Single DB for structured + time-series + vector data               |
| Dashboard              | Next.js + React Flow       | SSR for SEO, React Flow for agent DAG visualization                |
| Agent protocol         | OpenClaw Gateway WebSocket | Session management, multi-agent, tool use built-in                 |

---

## Project Timeline

| Week | Dates           | Milestone                                                          |
| ---- | --------------- | ------------------------------------------------------------------ |
| 1    | Feb 24 – Mar 2  | Infrastructure + scaffold, Docker Compose, domain types, CLI       |
| 2    | Mar 3 – Mar 9   | Agent registry, OpenClaw client, dashboard, **preliminary report** |
| 3    | Mar 10 – Mar 16 | Task scheduler, NATS messaging, task execution                     |
| 4    | Mar 17 – Mar 23 | Audit trail, policies, cost tracking                               |
| 5    | Mar 24 – Mar 30 | News pipeline demo (5 agents end-to-end)                           |
| 6    | Mar 31 – Apr 6  | Bankruptcy, HITL, auto-scaling, observability                      |
| 7    | Apr 7 – Apr 13  | Agent Genetics engine                                              |
| 8    | Apr 14 – Apr 19 | Polish, K3s deploy, **final report + demo video**                  |

---

## License

MIT — see [LICENSE](LICENSE)

<div align="center">

**NUS CS5224 Cloud Computing — Spring 2026**

</div>
