-- no-transaction
-- OpenSwarm TimescaleDB Hypertables
-- Migration 002: Create time-series tables for audit, cost, and metrics

-- Audit log with hash chaining for tamper evidence
CREATE TABLE IF NOT EXISTS audit_events (
    time TIMESTAMPTZ NOT NULL,
    agent_id TEXT NOT NULL,
    task_id UUID,
    action TEXT NOT NULL,
    tokens_used INT NOT NULL DEFAULT 0,
    cost_usd NUMERIC(10,6) NOT NULL DEFAULT 0,
    input_hash TEXT,
    output_hash TEXT,
    prev_hash TEXT,
    event_hash TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'
);

SELECT create_hypertable('audit_events', 'time', if_not_exists => TRUE);
SELECT add_retention_policy('audit_events', INTERVAL '30 days', if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS idx_audit_agent ON audit_events(agent_id, time DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_events(action, time DESC);
CREATE INDEX IF NOT EXISTS idx_audit_task ON audit_events(task_id, time DESC);

-- Cost tracking per model call
CREATE TABLE IF NOT EXISTS cost_events (
    time TIMESTAMPTZ NOT NULL,
    swarm_name TEXT NOT NULL,
    agent_role TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    task_id UUID,
    tokens_in INT NOT NULL DEFAULT 0,
    tokens_out INT NOT NULL DEFAULT 0,
    cost_usd NUMERIC(10,6) NOT NULL,
    model TEXT NOT NULL
);

SELECT create_hypertable('cost_events', 'time', if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS idx_cost_swarm ON cost_events(swarm_name, time DESC);

-- Continuous aggregate for hourly cost rollups
CREATE MATERIALIZED VIEW IF NOT EXISTS cost_hourly
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', time) AS bucket,
    swarm_name,
    agent_role,
    SUM(cost_usd) AS total_cost,
    SUM(tokens_in + tokens_out) AS total_tokens,
    COUNT(*) AS task_count
FROM cost_events
GROUP BY bucket, swarm_name, agent_role;

-- Agent health metrics time-series
CREATE TABLE IF NOT EXISTS agent_metrics (
    time TIMESTAMPTZ NOT NULL,
    agent_id TEXT NOT NULL,
    context_used INT,
    queue_depth INT,
    health_score REAL,
    cost_session NUMERIC(10,6),
    current_task_id UUID
);

SELECT create_hypertable('agent_metrics', 'time', if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS idx_metrics_agent ON agent_metrics(agent_id, time DESC);
