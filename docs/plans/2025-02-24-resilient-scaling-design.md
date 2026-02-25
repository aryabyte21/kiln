# OpenSwarm — Resilient Scaling Architecture (500+ Agents)

**Date**: 2025-02-24
**Status**: Draft
**Scope**: Scaling the control plane, inter-agent communication, SaaS model, and new features

---

## 1. Problem Statement

The initial plan targets 5-10 OpenClaw agents for demo. The user requires architecture that scales to 500-600 concurrent OpenClaw instances with resilient up/down scaling, high-speed inter-agent communication, and a SaaS-ready deployment model.

---

## 2. Scaling Architecture

### 2.1 Control Plane Horizontal Scaling

**Current**: Single Go binary handling all requests.

**Target**: Multiple control plane replicas behind a load balancer, with shared state in Redis and PostgreSQL.

```
                    ┌─────────────┐
                    │   Ingress    │
                    │  (L7 / LB)  │
                    └──────┬──────┘
              ┌────────────┼────────────┐
              ▼            ▼            ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │  CP - 1  │ │  CP - 2  │ │  CP - 3  │
        └────┬─────┘ └────┬─────┘ └────┬─────┘
             │             │             │
    ┌────────┴─────────────┴─────────────┴────────┐
    │                Shared State                   │
    │  Redis (registry, heartbeats, budget, locks) │
    │  PostgreSQL (swarms, tasks, audit, genomes)  │
    │  NATS (message bus, JetStream persistence)   │
    └──────────────────────────────────────────────┘
```

**Key design decisions**:

- **Stateless control plane**: All state lives in Redis/PostgreSQL/NATS. Any CP replica can handle any request.
- **Leader election for schedulers**: Use Redis distributed lock (`osw:lock:scheduler:{swarm}`) so only one CP runs the scheduler loop per swarm. Lock TTL = 10s, refresh every 3s. On leader failure, another CP acquires within 10s.
- **SSE fan-out via Redis Pub/Sub**: All CP replicas subscribe to `osw:events:{swarm}` Redis channel. Any CP that processes a state change publishes the event. All SSE clients connected to any CP receive it.

### 2.2 Agent Pool Partitioning

At 500+ agents, a flat registry becomes a bottleneck. Use **consistent hashing by agent role** to partition work.

**Partition scheme**:

```
Swarm: news-pipeline (500 agents)
├── fetcher pool     (200 agents) → NATS consumer group "fetcher"
├── summarizer pool  (150 agents) → NATS consumer group "summarizer"
├── classifier pool  (100 agents) → NATS consumer group "classifier"
├── aggregator pool  (30 agents)  → NATS consumer group "aggregator"
└── notifier pool    (20 agents)  → NATS consumer group "notifier"
```

Each pool operates independently:

- **Own NATS queue group**: Messages load-balance across pool members automatically
- **Own Redis sorted set**: `osw:tasks:pending:{swarm}:{role}` — no cross-pool contention
- **Own scaling policy**: Each role scales independently based on its metrics

### 2.3 NATS JetStream Configuration for Scale

**Streams** (3-node NATS cluster for HA):

```
TASKS stream:
  subjects: swarm.*.task.>
  retention: Interest
  max_age: 24h
  replicas: 3              # Raft consensus across cluster
  max_consumers: -1        # Unlimited consumers

PIPELINE stream:
  subjects: swarm.*.pipeline.>
  retention: WorkQueue      # Each message consumed once
  max_age: 1h
  replicas: 3
  discard: old              # Drop oldest when full

AUDIT stream:
  subjects: swarm.*.audit.>
  retention: WorkQueue
  max_age: 30d
  replicas: 3
  storage: file             # Persist to disk
```

**Consumer patterns for 500+ agents**:

```go
// Each agent role gets a durable pull consumer with queue group
consumer, _ := js.CreateOrUpdateConsumer(ctx, "PIPELINE", jetstream.ConsumerConfig{
    Durable:       "summarizer-workers",
    FilterSubject: "swarm.news-pipeline.pipeline.articles.raw",
    AckPolicy:     jetstream.AckExplicitPolicy,
    MaxDeliver:    3,                    // Retry failed messages 3x
    AckWait:       30 * time.Second,     // Must ack within 30s
    MaxAckPending: 100,                  // Backpressure: max 100 unacked
    MaxWaiting:    50,                   // Max pending pull requests
})

// Workers pull in batches for throughput
msgs, _ := consumer.Fetch(10, jetstream.FetchMaxWait(5*time.Second))
```

### 2.4 Redis Architecture for Scale

**Single Redis → Redis with hash tags** (start here, upgrade to Cluster if needed):

```
# Co-locate all data for a swarm using hash tags
osw:{news-pipeline}:registry:{agentId}
osw:{news-pipeline}:heartbeat:{agentId}
osw:{news-pipeline}:tasks:pending:fetcher
osw:{news-pipeline}:budget
osw:{news-pipeline}:memory:l2:{key}

# This ensures all keys for one swarm hit the same Redis slot
# Enables MULTI/EXEC transactions within a swarm
```

**Connection pooling**: go-redis with `PoolSize: 50`, `MinIdleConns: 10` per CP replica.

**Pipeline batching for heartbeats**: At 500 agents sending heartbeats every 5s = 100 heartbeats/sec. Use Redis pipeline to batch:

```go
pipe := rdb.Pipeline()
for _, hb := range heartbeats {
    pipe.HSet(ctx, key, fields...)
    pipe.Expire(ctx, key, 30*time.Second)
}
pipe.Exec(ctx)
```

### 2.5 Scaling Policies

Three scaling triggers, configurable per agent role:

| Trigger             | Metric                | Scale Up               | Scale Down             |
| ------------------- | --------------------- | ---------------------- | ---------------------- |
| `queue_depth`       | Pending tasks in NATS | > 10 per agent for 30s | < 2 per agent for 120s |
| `token_utilization` | Context window usage  | > 80% avg for 60s      | < 30% avg for 120s     |
| `latency`           | P95 task latency      | > 10s for 30s          | < 2s for 120s          |

**Scaling algorithm**:

```
desired = ceil(current_demand / target_per_agent)
desired = clamp(desired, spec.replicas.min, spec.replicas.max)
delta = desired - current_count

if delta > 0:
    spawn min(delta, 5) agents per tick  # Rate limit: max 5 new agents per 10s
elif delta < 0:
    drain 1 agent per tick               # Slow scale-down, let tasks finish
```

**Cooldown**: 60s after any scale event before allowing another.

### 2.6 Agent Lifecycle at Scale

```
┌──────────┐    register    ┌──────────┐   heartbeat   ┌──────────┐
│ Spawning ├───────────────►│  Active   │◄─────────────►│ Healthy  │
└──────────┘                └────┬──────┘               └──────────┘
                                 │
                    ┌────────────┼────────────┐
                    ▼            ▼            ▼
              ┌──────────┐ ┌──────────┐ ┌──────────┐
              │ Draining │ │  Failed  │ │ Bankrupt │
              └────┬─────┘ └────┬─────┘ └────┬─────┘
                   │            │            │
                   ▼            ▼            ▼
              ┌─────────────────────────────────┐
              │          Terminated             │
              └─────────────────────────────────┘
```

**Graceful drain** (for scale-down):

1. Remove agent from NATS consumer group (stop receiving new tasks)
2. Wait for in-flight tasks to complete (timeout: 60s)
3. Persist any L1 memory to L2 (Redis) for handoff
4. Deregister from Redis registry
5. Terminate OpenClaw process

**Bankruptcy handling** (agent stuck/failed):

1. Detect: 3 consecutive task failures OR budget exhausted
2. Mark agent as `bankrupt` in registry
3. Reassign in-flight tasks to healthy agents in same pool
4. Attempt restart with fresh context
5. If restart fails 3x, mark as `terminated` and alert

---

## 3. High-Speed Inter-Agent Communication

### 3.1 Communication Patterns

| Pattern            | Use Case                                               | Implementation                                            |
| ------------------ | ------------------------------------------------------ | --------------------------------------------------------- |
| **Pipeline**       | Sequential processing (fetch→summarize→classify)       | NATS JetStream WorkQueue — each stage is a consumer group |
| **Request-Reply**  | Agent asks another agent a question                    | NATS request-reply with inbox subjects (sub-second)       |
| **Broadcast**      | Coordinator sends instructions to all agents of a role | NATS publish to `swarm.{name}.broadcast.{role}`           |
| **Scatter-Gather** | Fan out to multiple agents, collect responses          | NATS request with multiple responders + timeout           |

### 3.2 NATS Request-Reply for Direct Agent Communication

```go
// Agent A asks Agent B a question (via control plane routing)
reply, err := nc.Request(
    "swarm.news-pipeline.agent.ask.summarizer",
    []byte(`{"question": "What's the sentiment of article X?"}`),
    5*time.Second,
)
// NATS automatically routes to one available summarizer via queue group
```

**Latency**: NATS request-reply is ~100-200μs within a cluster. Even with OpenClaw processing, end-to-end is bounded by LLM inference time, not messaging.

### 3.3 Message Batching for Throughput

For high-volume pipelines (e.g., fetcher producing 100 articles/min):

```go
// Batch publish: collect messages and publish in bursts
batch := make([]*nats.Msg, 0, 50)
ticker := time.NewTicker(100 * time.Millisecond)
for {
    select {
    case msg := <-inbound:
        batch = append(batch, msg)
        if len(batch) >= 50 {
            publishBatch(batch)
            batch = batch[:0]
        }
    case <-ticker.C:
        if len(batch) > 0 {
            publishBatch(batch)
            batch = batch[:0]
        }
    }
}
```

### 3.4 Backpressure

Prevent fast producers from overwhelming slow consumers:

- **NATS MaxAckPending**: Limits unacknowledged messages per consumer (default 100)
- **Redis queue depth monitoring**: If `osw:tasks:pending:{swarm}:{role}` exceeds threshold, pause upstream
- **Producer-side rate limiting**: Token bucket per pipeline edge (configurable in `topology`)

---

## 4. SaaS + Open-Source Dual Model

### 4.1 Deployment Tiers

| Tier           | Price   | Limits                                          | Deployment                   |
| -------------- | ------- | ----------------------------------------------- | ---------------------------- |
| **Community**  | Free    | 3 agents, 1 swarm, no genetics, 7-day audit     | Self-hosted (Docker Compose) |
| **Pro**        | $29/mo  | 25 agents, 5 swarms, genetics, 30-day audit     | Self-hosted or Cloud         |
| **Team**       | $99/mo  | 100 agents, unlimited swarms, SSO, 90-day audit | Self-hosted or Cloud         |
| **Scale**      | $299/mo | 500 agents, priority support, custom policies   | Cloud managed                |
| **Enterprise** | Custom  | Unlimited, SLA, dedicated infra, compliance     | On-prem or dedicated cloud   |

### 4.2 Feature Gating

Enforce limits in the control plane:

```go
type License struct {
    Tier           string    `json:"tier"`
    MaxAgents      int       `json:"maxAgents"`
    MaxSwarms      int       `json:"maxSwarms"`
    GeneticsEnabled bool     `json:"geneticsEnabled"`
    AuditRetention  int      `json:"auditRetentionDays"`
    ExpiresAt      time.Time `json:"expiresAt"`
}

func (l *License) Check(action string, current int) error {
    switch action {
    case "spawn_agent":
        if current >= l.MaxAgents {
            return fmt.Errorf("agent limit reached (%d/%d), upgrade to %s",
                current, l.MaxAgents, l.NextTier())
        }
    case "create_swarm":
        if current >= l.MaxSwarms {
            return fmt.Errorf("swarm limit reached")
        }
    case "evolve_genome":
        if !l.GeneticsEnabled {
            return fmt.Errorf("genetics requires Pro tier or above")
        }
    }
    return nil
}
```

**Community edition**: Fully functional, ships as a single `docker-compose.yml`. The free tier limit is enforced client-side in the open-source binary — technically bypassable by recompiling, which is intentional (open-core goodwill).

### 4.3 Cloud Managed Service Architecture

```
┌─────────────────────────────────────────────────┐
│                  OpenSwarm Cloud                 │
│                                                  │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐         │
│  │ Tenant A│  │ Tenant B│  │ Tenant C│  ...     │
│  └────┬────┘  └────┬────┘  └────┬────┘         │
│       │             │             │              │
│  ┌────┴─────────────┴─────────────┴────────┐    │
│  │         Shared Infrastructure            │    │
│  │  NATS (account-per-tenant isolation)     │    │
│  │  PostgreSQL (row-level security)         │    │
│  │  Redis (key-prefix isolation)            │    │
│  └──────────────────────────────────────────┘    │
│                                                  │
│  ┌──────────────────────────────────────────┐    │
│  │         OpenClaw Pool (shared)           │    │
│  │  500+ OpenClaw instances                 │    │
│  │  Allocated to tenants on demand          │    │
│  └──────────────────────────────────────────┘    │
└─────────────────────────────────────────────────┘
```

**Tenant isolation**:

- **NATS**: Each tenant gets a NATS account with subject permissions. Tenant A cannot see Tenant B's messages.
- **PostgreSQL**: Row-level security (RLS) with `tenant_id` column on every table.
- **Redis**: Key prefix `osw:{tenant}:{swarm}:...` with ACL restrictions.
- **OpenClaw**: Agents are ephemeral — spun up for a tenant's swarm, torn down after. No shared state between tenants.

### 4.4 On-Prem vs Cloud Comparison (for CS5224 report)

| Dimension               | Self-Hosted (Oracle Free ARM) | Cloud Managed (GKE Autopilot) |
| ----------------------- | ----------------------------- | ----------------------------- |
| Cost (10 agents)        | $0/mo (free tier)             | ~$45/mo (GKE + node pool)     |
| Cost (100 agents)       | ~$20/mo (2x ARM A1)           | ~$180/mo                      |
| Cost (500 agents)       | ~$80/mo (dedicated)           | ~$600/mo                      |
| Cold start              | 5-10s (container pull)        | 15-30s (node scale + pull)    |
| Latency (intra-cluster) | <1ms                          | <2ms                          |
| Ops burden              | High (you manage everything)  | Low (managed K8s)             |
| Scaling speed           | Minutes (manual or K3s HPA)   | Seconds (GKE Autopilot)       |
| HA/DR                   | Manual (multi-node K3s)       | Built-in (multi-zone)         |

---

## 5. New Features for SaaS Differentiation

### 5.1 Swarm Templates Marketplace

Pre-built swarm configurations that users can deploy with one click:

- **Research Assistant**: 3 agents (researcher + writer + reviewer)
- **Customer Support**: 5 agents (classifier + responder + escalator + QA + analytics)
- **Content Pipeline**: 5 agents (fetcher + summarizer + editor + publisher + monitor)
- **Code Review**: 3 agents (analyzer + reviewer + reporter)

Stored as swarm.yaml + policies in a public GitHub repo. Users install via:

```bash
openswarm template install openswarm/templates/customer-support
openswarm apply customer-support/swarm.yaml
```

### 5.2 Agent Health Dashboard with Anomaly Detection

Beyond basic health checks, detect anomalies:

- **Token cost spike**: Agent suddenly using 3x more tokens → alert
- **Latency regression**: P95 task latency increased 50% → alert
- **Error rate surge**: > 5% error rate in rolling 5-minute window → alert
- **Memory leak**: L1 context growth without corresponding task complexity → suggest restart

Implementation: TimescaleDB continuous aggregates + simple statistical thresholds (no ML needed for v1).

### 5.3 Agent Collaboration Graph

Real-time visualization in the dashboard showing:

- Which agents are talking to each other (NATS message flow)
- Message volume per edge (particle speed on React Flow edges)
- Bottleneck detection (red edges where queue depth > threshold)
- Topology health (green/yellow/red status per node)

### 5.4 Swarm Replay

Record all NATS messages + task results for a swarm execution. Replay them in the dashboard at 1x, 5x, or 10x speed to analyze behavior, debug issues, or demonstrate to stakeholders.

Implementation: NATS JetStream already persists all messages. Replay = re-read from stream with timestamp filtering + feed into dashboard SSE.

### 5.5 Cost Forecasting

Based on historical cost_events data:

- Predict daily/weekly/monthly spend for each swarm
- Alert before budget exhaustion: "At current rate, budget will be exhausted in 4.2 hours"
- Recommend model downgrades: "Switching classifier from Sonnet to Haiku would save 60% with <5% quality loss"

### 5.6 Webhook Integrations

Allow users to receive events via webhooks:

- Task completed → POST to user's endpoint
- Budget alert → Slack/Discord webhook
- Agent bankruptcy → PagerDuty
- Genome evolved → Email notification

Configuration in swarm.yaml:

```yaml
spec:
  webhooks:
    - event: task.completed
      url: https://example.com/webhook
      secret: 'hmac-secret'
    - event: budget.alert
      url: https://hooks.slack.com/services/T.../B.../xxx
```

---

## 6. Infrastructure Requirements at Scale

### 6.1 Resource Estimates (500 agents)

| Component       | CPU       | Memory | Storage          | Count           |
| --------------- | --------- | ------ | ---------------- | --------------- |
| Control Plane   | 2 vCPU    | 512MB  | —                | 3 replicas      |
| NATS            | 1 vCPU    | 1GB    | 10GB (JetStream) | 3 nodes         |
| Redis           | 1 vCPU    | 2GB    | —                | 1 (with AOF)    |
| PostgreSQL      | 2 vCPU    | 4GB    | 50GB             | 1 (+ 1 replica) |
| OpenClaw (each) | 0.5 vCPU  | 256MB  | 100MB            | 500             |
| **Total**       | ~260 vCPU | ~135GB | ~110GB           | —               |

### 6.2 Oracle Free Tier Deployment (Demo)

Oracle Cloud Free Tier provides:

- 4 ARM A1 instances (24 GB RAM, 4 OCPUs total)
- 200 GB block storage
- 10 TB/mo outbound

**Demo deployment** (fits free tier):

- Node 1: K3s control plane + PostgreSQL + Redis
- Node 2: NATS cluster node 1 + Control Plane replica 1
- Node 3: NATS cluster node 2 + Control Plane replica 2
- Node 4: 10 OpenClaw instances (for demo)

For the CS5224 demo, 10-20 agents is sufficient to show the architecture works. The scaling design is proven by the architecture, not by running 500 agents on free tier.

---

## 7. Implementation Priority

These features are additive to the existing 8-week plan. Priority order:

1. **Week 2-3**: Add Redis hash tags, connection pooling, pipeline batching (low effort, foundation for scale)
2. **Week 3**: NATS consumer groups with MaxAckPending + backpressure (part of existing scheduler work)
3. **Week 4**: Leader election for scheduler, SSE fan-out via Redis Pub/Sub
4. **Week 5**: License/tier enforcement stubs (feature gates check but always return "unlimited" for now)
5. **Week 6**: Scaling policies (queue_depth, token_utilization, latency triggers)
6. **Week 7**: Webhook integrations, cost forecasting basics
7. **Week 8**: Swarm replay demo, anomaly detection thresholds

Features that are **design-only for the report** (not implemented in 8 weeks):

- Multi-tenant cloud managed service
- Swarm templates marketplace
- Redis Cluster (single Redis is fine for demo)
- NATS super-cluster / leafnodes

---

## 8. CS5224 Report Angles

### Preliminary Report (March 9)

- Architecture diagram showing the scaling path from 1→500 agents
- On-prem vs cloud cost comparison table
- SaaS tier breakdown

### Final Report (April 19)

- Benchmark: task throughput at 5, 10, 20 agents (what free tier allows)
- Extrapolation model for 100-500 agents based on measured per-agent overhead
- NATS throughput measurements (messages/sec at different consumer counts)
- Cost per task breakdown by model (Haiku vs Sonnet)
- Agent Genetics fitness improvement over 3+ generations
