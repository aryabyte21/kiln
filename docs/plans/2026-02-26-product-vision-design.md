# OpenSwarm Product Vision — Dashboard & Swarm Controls

**Date**: 2026-02-26
**Status**: Approved (auto-approved per brainstorming flow)

## Core Concept: "ArgoCD for AI Agents"

OpenSwarm is an operational dashboard and orchestration layer for OpenClaw agent fleets.
Like ArgoCD shows desired vs actual state for K8s, OpenSwarm shows desired vs actual for agent fleets.

**Not N8N** — topology is defined in YAML. Dashboard is for observing and controlling.

## Use Cases

1. **Content Pipeline**: Fetcher → Summarizer → Classifier → Aggregator → Notifier
2. **Customer Support**: Triage → Resolver(×N) → Notifier (scale on queue depth)
3. **Multi-Model QA**: Same input → multiple models → Comparator → Output
4. **Research & Synthesis**: Researcher(×N) → Synthesizer → Writer

## Communication Model

```
User → HTTP → Control Plane → NATS → Scheduler → Executor → OpenClaw Gateway HTTP
Result → DB + SSE broadcast → Dashboard
If topology → NATS pipeline → next agent
```

NATS (not OpenClaw sessions_send) because: observability, decoupling, persistence, topology enforcement.

## Dashboard Features

### 1. Swarm Command Bar (P0)

Header area with lifecycle controls:

- **Start** (POST /api/v1/swarms — re-apply spec)
- **Stop** (DELETE /api/v1/swarms/{name} — graceful teardown)
- **Sync** (POST /api/v1/swarms — reconcile desired vs actual)
- **Scale** (per-role slider → POST /api/v1/swarms/{name}/agents/{role}/scale)
- **Delete** (DELETE with confirmation)

Sync status display:

- ✅ Synced — all desired agents running
- ⚠️ OutOfSync — agents pending spawn/termination
- ❌ Degraded — failures, budget exceeded, offline agents
- 🔄 Syncing — lifecycle manager reconciling

### 2. Agent Detail Drawer (P0)

Click React Flow node → slide-out drawer showing:

- Health score, task count, token usage, cost, latency P50/P95
- SOUL.md preview
- Tools and skills list
- Policy name
- Genome generation and fitness
- Actions: View Tasks, Edit Soul, Scale, Restart

### 3. Audit Trail Panel (P0)

New dashboard tab with:

- Searchable audit log (filter by agent, action, time range)
- Hash chain verification status (green check or red X)
- Verify Chain button → calls /api/v1/swarms/{name}/audit/verify
- Export button (JSON)

### 4. Pipeline Trace View (P1)

Task detail that shows full pipeline flow:

- Visual chain: Agent A → Agent B → Agent C
- Per-hop metrics: tokens, cost, latency
- Uses metadata.upstream + metadata.origTask fields

### 5. Skills Display (P2 — Stretch)

Show installed skills per agent (from spec). Link to clawhub.ai for browsing.
No custom ClawHub API integration in v1.

## New API Endpoints Needed

```
POST   /api/v1/swarms/{name}/stop     — Graceful teardown (keep DB record)
POST   /api/v1/swarms/{name}/start    — Re-apply spec, spawn agents
POST   /api/v1/swarms/{name}/sync     — Reconcile desired vs actual state
GET    /api/v1/swarms/{name}/status    — Sync status (synced/out-of-sync/degraded)
```

Existing endpoints already support:

- Deploy (POST /api/v1/swarms/deploy)
- Delete (DELETE /api/v1/swarms/{name})
- Scale (POST /api/v1/swarms/{name}/agents/{role}/scale)
- Audit (GET /api/v1/swarms/{name}/audit, GET .../audit/verify)
- Tasks (GET /api/v1/swarms/{name}/tasks)
- Budget (GET /api/v1/swarms/{name}/budget)

## New Dashboard Pages/Components

```
components/dashboard/
  swarm-command-bar.tsx    — Lifecycle controls (start/stop/sync/scale/delete)
  sync-status-badge.tsx    — ArgoCD-style sync indicator
  agent-detail-drawer.tsx  — Slide-out agent details
  audit-panel.tsx          — Audit trail tab content
  pipeline-trace.tsx       — Visual pipeline flow
  scale-dialog.tsx         — Per-role replica slider dialog
```

## Implementation Priority

P0 (must-have for demo):

1. Swarm command bar with start/stop/sync
2. Sync status indicator
3. Agent detail drawer
4. Audit trail panel
5. Backend: /stop, /start, /sync, /status endpoints

P1 (nice-to-have): 6. Pipeline trace view 7. Per-role scale slider dialog 8. Budget burn rate chart

P2 (stretch): 9. Skills display per agent 10. Genome evolution trigger from UI
