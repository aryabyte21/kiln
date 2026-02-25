-- OpenSwarm L3 Memory (pgvector)
-- Migration 003: Vector embeddings for long-term agent memory

CREATE TABLE IF NOT EXISTS memory_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    swarm_name TEXT NOT NULL,
    agent_role TEXT,
    content TEXT NOT NULL,
    embedding vector(1536),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- IVFFlat index for approximate nearest neighbor search
-- lists=100 is good for up to ~100K vectors
CREATE INDEX IF NOT EXISTS idx_memory_embedding
    ON memory_embeddings USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

CREATE INDEX idx_memory_swarm ON memory_embeddings(swarm_name);
CREATE INDEX idx_memory_role ON memory_embeddings(swarm_name, agent_role);
