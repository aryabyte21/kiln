-- Babel Local Registry — Initial Schema
-- Migration: 001_initial
-- Run automatically by LocalRegistry.__init__ on first connect.

CREATE TABLE IF NOT EXISTS tools (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    tool_id     TEXT    NOT NULL UNIQUE,           -- com.aria.tools.weather
    name        TEXT    NOT NULL,                  -- "Weather Tool"
    version     TEXT    NOT NULL DEFAULT '1.0.0',
    description TEXT    NOT NULL DEFAULT '',
    spec_yaml   TEXT    NOT NULL,                  -- full YAML spec (raw string)
    impl_path   TEXT    NOT NULL,                  -- absolute path to impl.py
    tags        TEXT    NOT NULL DEFAULT '[]',     -- JSON array of tag strings
    source      TEXT    NOT NULL DEFAULT 'pre-built', -- 'pre-built' | 'synthesized' | 'imported'
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tools_tool_id ON tools (tool_id);
CREATE INDEX IF NOT EXISTS idx_tools_source  ON tools (source);

-- Track registry events for W&B Weave observability (E3 reads this)
CREATE TABLE IF NOT EXISTS registry_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type  TEXT    NOT NULL,   -- 'publish' | 'query_hit' | 'query_miss' | 'load'
    tool_id     TEXT,
    detail      TEXT,               -- JSON blob with request context
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
