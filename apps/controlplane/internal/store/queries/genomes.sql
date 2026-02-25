-- name: CreateGenome :exec
INSERT INTO genomes (id, swarm_name, agent_role, generation, parent_ids, active, genes, fitness)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8);

-- name: ListGenomesBySwarm :many
SELECT id, swarm_name, agent_role, generation, parent_ids, active, genes, fitness, created_at
FROM genomes
WHERE swarm_name = $1
ORDER BY created_at DESC;

-- name: GetGenomeByID :one
SELECT id, swarm_name, agent_role, generation, parent_ids, active, genes, fitness, created_at
FROM genomes
WHERE id = $1;

-- name: UpdateGenomeFitness :execresult
UPDATE genomes SET fitness = $1 WHERE id = $2;

-- name: DeactivateGenomes :exec
UPDATE genomes
SET active = false
WHERE swarm_name = $1 AND agent_role = $2 AND active = true;

-- name: ListActiveGenomesByRole :many
SELECT id, swarm_name, agent_role, generation, parent_ids, active, genes, fitness, created_at
FROM genomes
WHERE swarm_name = $1 AND agent_role = $2 AND active = true
ORDER BY created_at DESC;
