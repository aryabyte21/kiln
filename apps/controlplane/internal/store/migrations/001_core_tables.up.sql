-- OpenSwarm Core Tables
-- Migration 001: Create core application tables

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

-- Swarm definitions (from applied swarm.yaml)
CREATE TABLE IF NOT EXISTS swarms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT UNIQUE NOT NULL,
    spec JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Agent specifications within a swarm
CREATE TABLE IF NOT EXISTS agent_specs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    swarm_id UUID NOT NULL REFERENCES swarms(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    model TEXT NOT NULL,
    policy_name TEXT,
    config JSONB NOT NULL DEFAULT '{}',
    UNIQUE(swarm_id, name)
);

-- Policy definitions
CREATE TABLE IF NOT EXISTS policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT UNIQUE NOT NULL,
    spec JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Task records
CREATE TABLE IF NOT EXISTS tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    swarm_id UUID REFERENCES swarms(id),
    agent_role TEXT NOT NULL,
    assigned_agent_id TEXT,
    input TEXT NOT NULL,
    output TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    tokens_used INT NOT NULL DEFAULT 0,
    cost_usd NUMERIC(10,6) NOT NULL DEFAULT 0,
    latency_ms INT,
    error TEXT,
    trace_id TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_tasks_swarm_status ON tasks(swarm_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_agent_role ON tasks(agent_role);
CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at DESC);

-- Agent genomes
CREATE TABLE IF NOT EXISTS genomes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_role TEXT NOT NULL,
    generation INT NOT NULL,
    parent_ids UUID[],
    genes JSONB NOT NULL,
    fitness JSONB DEFAULT '{}',
    active BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_genomes_role_gen ON genomes(agent_role, generation);
CREATE INDEX IF NOT EXISTS idx_genomes_active ON genomes(active) WHERE active = true;
