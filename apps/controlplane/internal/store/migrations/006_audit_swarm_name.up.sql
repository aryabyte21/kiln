-- Add swarm_name to audit_events for efficient per-swarm filtering
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS swarm_name TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_audit_swarm ON audit_events(swarm_name, time DESC);
