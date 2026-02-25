-- name: CreateSwarm :one
INSERT INTO swarms (name, spec, status)
VALUES ($1, $2, $3)
RETURNING id, name, spec, status, created_at, updated_at;

-- name: ListSwarms :many
SELECT id, name, spec, status, created_at, updated_at
FROM swarms
ORDER BY created_at DESC;

-- name: GetSwarmByName :one
SELECT id, name, spec, status, created_at, updated_at
FROM swarms
WHERE name = $1;

-- name: DeleteSwarm :execresult
DELETE FROM swarms WHERE name = $1;

-- name: UpdateSwarmStatus :execresult
UPDATE swarms
SET status = $1, updated_at = now()
WHERE name = $2;
