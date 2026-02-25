# P0 Design: OpenSwarm Fleet Management for Autonomous AI Agents

**Date**: 2026-02-25
**Status**: Approved
**Author**: OpenSwarm Team

## Core Identity

OpenSwarm is **Kubernetes for AI agents** — not n8n, not LangGraph, not a workflow orchestrator.

Each OpenClaw Gateway instance is a self-contained autonomous agent with:
sessions, memory, cron scheduling, skills, tools, messaging channels, sub-agent spawning,
and a full WebSocket-based control UI.

OpenSwarm doesn't tell agents what to think. It manages their **lifecycle, configuration,
budget, health, and evolution** — the same way Kubernetes manages containers without caring
what the containers run.

## What OpenSwarm Manages

| Concern       | What OpenSwarm Does                             | What OpenClaw Does                        |
| ------------- | ----------------------------------------------- | ----------------------------------------- |
| Lifecycle     | Spawn, kill, scale, crash-recover containers    | Run the agent runtime inside              |
| Configuration | Generate SOUL.md, openclaw.json, install skills | Load config, run the agent loop           |
| Communication | Wire NATS subjects between gateways             | Use sessions_send / sessions_spawn within |
| Budget        | Track tokens, enforce hard stops across fleet   | Report usage per request                  |
| Health        | Poll health endpoints, restart unhealthy agents | Expose health status                      |
| Evolution     | Mutate configs, test variants, promote fittest  | Execute with whatever config it's given   |
| Security      | Enforce tool allowlists, egress rules, policies | Sandbox execution, respect tool config    |
| Observability | Aggregate metrics, audit trail, alerting        | Expose per-agent metrics                  |

## Three User Layers

### Layer 1: CLI (The Engineer)

```bash
# Fleet management
openswarm apply customer-support.yaml     # Deploy fleet — one YAML, entire fleet
openswarm ps                              # Quick status — one line per swarm
openswarm status customer-support         # Detailed fleet status
openswarm down customer-support           # Tear down fleet

# Agent interaction
openswarm agents customer-support         # List agents in fleet
openswarm chat customer-support/triage    # Interactive session with agent
openswarm send customer-support/triage "New ticket: billing issue"  # One-shot message
openswarm logs customer-support/triage    # Tail agent activity
```

Every command listed in `--help` MUST work. No stubs. If it's not implemented, it doesn't
exist in the CLI. Add commands back as features land.

### Layer 2: Dashboard (The Observer)

Fleet command center — monitoring + interaction, not a visual workflow editor.

- **Fleet Overview**: Cards per swarm — agent count, health %, budget burn, uptime
- **Agent List**: Name, role, status, model, cost, health (like `kubectl get pods`)
- **Agent Detail**: Click → chat, sessions, memory status, cron jobs, WebUI link
- **Deploy Page**: YAML editor + example templates + Deploy button + live progress
- **Settings**: LLM provider config, platform-wide defaults

### Layer 3: Messaging (The End User)

The swarm appears as a bot in Slack/Discord/WhatsApp. Users interact with agents through
natural conversation. Individual agents addressable via `@agent-name` mentions.

**Priority**: P1 — complex OAuth flows, defer until core fleet management works.

## YAML Configuration Design

### Principles

1. **Defaults cascade** — define once at `spec.defaults`, override per-agent
2. **Config passthrough** — `config` block maps directly to openclaw.json fields
3. **Skills from ClawHub** — `clawhub://skill-name` syntax for marketplace skills
4. **Cron per-agent** — each agent can have scheduled jobs
5. **One file = complete fleet state** — everything needed to reproduce the fleet

### Schema

```yaml
apiVersion: openswarm/v1alpha1
kind: Swarm
metadata:
  name: customer-support
  labels:
    team: support
    env: production

spec:
  defaults:
    model: groq/meta-llama/llama-4-scout-17b-16e-instruct
    config: # → openclaw.json passthrough
      temperature: 0.7
      maxTokens: 4096
      contextWindow: 131072

  budget:
    total: '$10.00'
    perTask: '$0.50' # Max per-session spend
    alertAt: 80 # Alert at 80% budget
    hardStop: 100 # Kill at 100%

  agents:
    - name: triage
      replicas: { min: 1, max: 3 }
      soul: |
        You are a triage agent. Classify incoming messages and route
        them to the appropriate specialist.
      skills: # Installed into agent workspace
        - clawhub://customer-routing
        - ./skills/classify # Local workspace skill
      tools: # Tool allowlist (deny everything else)
        - sessions_send
        - sessions_list
        - memory_search
      cron: # OpenClaw cron jobs for this agent
        - name: morning-check
          schedule: '0 8 * * *'
          task: 'Review overnight messages and prioritize queue'
      config: # Per-agent overrides
        temperature: 0.5

    - name: resolver
      replicas: { min: 2, max: 5 }
      soul: |
        You are a resolver. Handle complaints with empathy.
      skills:
        - clawhub://order-lookup
      config:
        maxTokens: 8192
        temperature: 0.3

    - name: notifier
      replicas: { min: 1, max: 1 }
      model: groq/llama-3.3-70b-versatile # Override: bigger model
      soul: |
        You deliver resolved case summaries to the team.

  topology: # Inter-agent NATS communication
    - from: triage
      to: resolver
      subject: route.resolve
    - from: resolver
      to: notifier
      subject: route.notify

  policy: production-safety # Reference a Policy manifest
```

### Config Merge Rules

1. `spec.defaults.model` → used if agent doesn't specify `model`
2. `spec.defaults.config` → deep-merged with agent's `config` (agent wins on conflict)
3. `soul` → always per-agent (no inheritance — the soul IS the agent)
4. `skills` → per-agent only (different agents need different capabilities)
5. `tools` → per-agent allowlist; if omitted, all tools allowed

## P0 Implementation Scope

### P0-1: YAML Defaults + Config Passthrough

**Goal**: One YAML declares complete fleet state. `spec.defaults` eliminates repetition.

Changes:

- `config/config.go`: Parse `spec.defaults`, deep-merge with per-agent config
- `domain/swarm.go`: Add `DefaultsSpec` with model + config map
- `pool/pool.go`: Use merged config when generating openclaw.json
  - `temperature`, `maxTokens`, `contextWindow` → model config
  - `tools` → tool allowlist in gateway config
  - `skills` → install into workspace before container start
  - `cron` → write to cron/jobs.json in workspace

### P0-2: CLI Polish

**Goal**: Every command works or doesn't exist.

Keep (working):

- `apply`, `status`, `agents`, `down`, `version`

Implement:

- `ps` — one-line-per-swarm quick status
- `chat <swarm>/<role>` — interactive REPL using /v1/chat/completions proxy
- `send <swarm>/<role> <message>` — one-shot message, print response
- `tasks list <swarm>` — show recorded interactions

Remove from --help (add back when implemented):

- `logs` (needs audit trail — P1)
- `scale` (needs auto-scaling — P2)
- `budget` (needs cost tracking wired — P1)
- `genome *` (needs genetics engine — P2)

### P0-3: Dashboard Deploy Page

**Goal**: Non-technical users can deploy swarms from the browser.

New page: `/dashboard/deploy`

- YAML editor with syntax highlighting (CodeMirror or Monaco)
- Example template dropdown (hello-swarm, customer-support, news-pipeline)
- Validate button (calls config parser on backend)
- Deploy button → POST /api/v1/swarms → SSE progress updates
- After deploy → redirect to swarm detail

### P0-4: Inter-Agent Communication Bridge

**Goal**: Agents in the same swarm can send messages to each other via NATS.

When topology declares `from: triage → to: resolver`:

1. OpenSwarm installs a bridge skill in triage's workspace
2. The bridge skill exposes a `swarm_send` tool to the agent
3. When triage calls `swarm_send(to: "resolver", message: "...")`:
   - Bridge skill publishes to NATS subject `swarm.{name}.route.resolve`
   - OpenSwarm subscriber picks it up
   - Forwards to resolver's OpenClaw gateway via /v1/chat/completions or sessions_send
4. Response flows back through NATS

This is the minimum viable inter-agent communication. Not a DAG executor —
just a message bus that agents can use when they decide to.

## Security Design

### Defense in Depth

| Layer     | Control                                                   | Implementation                   |
| --------- | --------------------------------------------------------- | -------------------------------- |
| Container | Docker isolation, read-only root FS, dropped capabilities | pool.go container config         |
| Network   | Egress allowlist per agent                                | Docker network policy / iptables |
| Tools     | Per-agent allowlist/denylist from YAML                    | openclaw.json tool config        |
| Budget    | Per-swarm hard stop, per-session blast radius             | Redis budget tracker             |
| Execution | OpenClaw sandbox mode for exec/system.run                 | openclaw.json sandbox config     |
| Audit     | Hash-chained event log, tamper detection                  | TimescaleDB (P1)                 |
| Scanning  | URL/file scanning via VirusTotal API                      | OpenClaw skill (P2)              |

### Policy Enforcement Flow

```
YAML policy spec
      ↓
Control plane parses + validates
      ↓
Per-agent: tool allowlist → openclaw.json
Per-agent: egress rules → Docker network config
Per-swarm: budget limits → Redis
Per-swarm: blast radius → session cost tracking
      ↓
Runtime enforcement:
  - OpenClaw respects tool config (denies unlisted tools)
  - Budget tracker rejects requests over hard stop
  - Audit trail records every action for verification
```

## What's NOT P0

| Feature                            | Priority | Why Deferred                                 |
| ---------------------------------- | -------- | -------------------------------------------- |
| Messaging channels (Slack/Discord) | P1       | Complex OAuth, needs setup UI                |
| Audit trail (hash-chained)         | P1       | Important for report, not for basic function |
| Cost tracking per-session          | P1       | Needs token counting wired through           |
| Auto-scaling                       | P2       | Needs metrics pipeline                       |
| Agent Genetics                     | P2       | Academic novelty, build after core works     |
| VirusTotal integration             | P2       | Security hardening layer                     |
| Kubernetes (K3s) deploy            | P3       | Final week polish                            |

## Success Criteria

P0 is done when:

1. `openswarm apply customer-support.yaml` deploys 3+ agents with different configs
2. Each agent has its SOUL.md, correct model, skills installed, tools restricted
3. `openswarm chat customer-support/triage` opens an interactive session
4. Dashboard shows fleet health, and agents can be chatted with
5. Dashboard deploy page lets someone paste YAML and deploy without CLI
6. Budget tracker rejects requests when hard stop is hit
7. No stub commands in CLI — every listed command works
