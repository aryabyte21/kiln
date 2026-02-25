-- name: CreatePolicy :one
INSERT INTO policies (name, spec)
VALUES ($1, $2)
RETURNING id, name, spec, created_at;

-- name: ListPolicies :many
SELECT id, name, spec, created_at
FROM policies
ORDER BY created_at DESC;

-- name: GetPolicyByName :one
SELECT id, name, spec, created_at
FROM policies
WHERE name = $1;
