-- OpenSwarm Genomes Enhancement
-- Migration 004: Add swarm_name column to genomes table for multi-swarm genetics

ALTER TABLE genomes ADD COLUMN IF NOT EXISTS swarm_name TEXT;

-- Backfill: set swarm_name to empty string for any existing rows
UPDATE genomes SET swarm_name = '' WHERE swarm_name IS NULL;

-- Make swarm_name NOT NULL after backfill
ALTER TABLE genomes ALTER COLUMN swarm_name SET NOT NULL;
ALTER TABLE genomes ALTER COLUMN swarm_name SET DEFAULT '';

-- Add index for swarm+role queries
CREATE INDEX IF NOT EXISTS idx_genomes_swarm_role ON genomes(swarm_name, agent_role);
