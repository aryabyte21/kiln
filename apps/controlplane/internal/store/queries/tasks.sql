-- name: CreateTask :one
INSERT INTO tasks (swarm_id, agent_role, input, status, metadata)
VALUES (
    (SELECT id FROM swarms WHERE name = @swarm_name),
    @agent_role,
    @input,
    @status,
    @metadata
)
RETURNING id, created_at;

-- name: ListTasksBySwarm :many
SELECT
    t.id,
    s.name AS swarm_name,
    t.agent_role,
    t.assigned_agent_id,
    t.input,
    t.output,
    t.status,
    t.tokens_used,
    t.cost_usd,
    t.latency_ms,
    t.error,
    t.trace_id,
    t.metadata,
    t.created_at,
    t.completed_at
FROM tasks t
JOIN swarms s ON s.id = t.swarm_id
WHERE s.name = $1
ORDER BY t.created_at DESC;

-- name: GetTaskByID :one
SELECT
    t.id,
    s.name AS swarm_name,
    t.agent_role,
    t.assigned_agent_id,
    t.input,
    t.output,
    t.status,
    t.tokens_used,
    t.cost_usd,
    t.latency_ms,
    t.error,
    t.trace_id,
    t.metadata,
    t.created_at,
    t.completed_at
FROM tasks t
JOIN swarms s ON s.id = t.swarm_id
WHERE t.id = $1;

-- name: UpdateTaskStatus :execresult
UPDATE tasks
SET status = $1, assigned_agent_id = $2
WHERE id = $3;

-- name: UpdateTaskStatusOnly :execresult
UPDATE tasks
SET status = $1
WHERE id = $2;

-- name: UpdateTaskResult :execresult
UPDATE tasks
SET output = $1,
    tokens_used = $2,
    cost_usd = $3,
    latency_ms = $4,
    error = $5,
    completed_at = $6
WHERE id = $7;
