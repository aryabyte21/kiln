Add a new SQL migration to the OpenSwarm control plane.

Migration description: $ARGUMENTS

Follow this workflow:

1. Check existing migrations in `apps/controlplane/internal/store/migrations/` to find the next sequence number
2. Create `NNN_description.up.sql` with the next number
3. Use TimescaleDB hypertables for any time-series data (`SELECT create_hypertable(...)`)
4. Use pgvector for any embedding columns (`vector(1536)`)
5. Include proper indexes for query patterns
6. Use `TIMESTAMPTZ` for all timestamps, `UUID` for IDs, `JSONB` for flexible data
7. Add `ON DELETE CASCADE` for foreign keys where appropriate

Conventions:

- Table names: snake_case, plural
- Column names: snake_case
- Default timestamps: `DEFAULT now()`
- Default UUIDs: `DEFAULT gen_random_uuid()`
- Always add created_at/updated_at where applicable
