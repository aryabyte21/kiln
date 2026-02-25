-- Platform-wide settings (LLM provider config, etc.)
-- Single-row table: key = 'global' for platform settings,
-- or key = swarm name for swarm-specific overrides.
CREATE TABLE IF NOT EXISTS settings (
    key         TEXT PRIMARY KEY DEFAULT 'global',
    config      JSONB NOT NULL DEFAULT '{}',
    updated_at  TIMESTAMPTZ DEFAULT now()
);

-- Insert default global settings row
INSERT INTO settings (key, config) VALUES ('global', '{}')
ON CONFLICT (key) DO NOTHING;
