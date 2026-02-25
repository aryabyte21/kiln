package store

import (
	"context"
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"sort"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/openswarm/openswarm/internal/domain"
)

//go:embed migrations/*.sql
var migrationFS embed.FS

// Store provides PostgreSQL-backed persistence for the OpenSwarm control plane.
type Store struct {
	pool *pgxpool.Pool
}

// New connects to PostgreSQL and returns a ready Store.
func New(ctx context.Context, databaseURL string) (*Store, error) {
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, fmt.Errorf("store: connect: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("store: ping: %w", err)
	}
	return &Store{pool: pool}, nil
}

// Close releases the connection pool.
func (s *Store) Close() {
	s.pool.Close()
}

// ---------------------------------------------------------------------------
// Migrations
// ---------------------------------------------------------------------------

// RunMigrations reads embedded SQL files in lexicographic order and executes
// each one inside a transaction.
func (s *Store) RunMigrations(ctx context.Context) error {
	entries, err := fs.ReadDir(migrationFS, "migrations")
	if err != nil {
		return fmt.Errorf("store: read migrations dir: %w", err)
	}

	// Sort entries by name to guarantee execution order.
	sort.Slice(entries, func(i, j int) bool {
		return entries[i].Name() < entries[j].Name()
	})

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		data, err := migrationFS.ReadFile("migrations/" + entry.Name())
		if err != nil {
			return fmt.Errorf("store: read migration %s: %w", entry.Name(), err)
		}

		tx, err := s.pool.Begin(ctx)
		if err != nil {
			return fmt.Errorf("store: begin tx for %s: %w", entry.Name(), err)
		}
		if _, err := tx.Exec(ctx, string(data)); err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("store: exec migration %s: %w", entry.Name(), err)
		}
		if err := tx.Commit(ctx); err != nil {
			return fmt.Errorf("store: commit migration %s: %w", entry.Name(), err)
		}
	}
	return nil
}

// ---------------------------------------------------------------------------
// Swarms
// ---------------------------------------------------------------------------

// CreateSwarm inserts a new swarm and returns it with server-generated fields.
func (s *Store) CreateSwarm(ctx context.Context, sw *domain.Swarm) error {
	specJSON, err := json.Marshal(sw.Spec)
	if err != nil {
		return fmt.Errorf("store: marshal swarm spec: %w", err)
	}
	return s.pool.QueryRow(ctx,
		`INSERT INTO swarms (name, spec, status)
		 VALUES ($1, $2, $3)
		 RETURNING id, created_at, updated_at`,
		sw.Name, specJSON, string(sw.Status),
	).Scan(&sw.ID, &sw.CreatedAt, &sw.UpdatedAt)
}

// ListSwarms returns all swarms ordered by creation time.
func (s *Store) ListSwarms(ctx context.Context) ([]domain.Swarm, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, name, spec, status, created_at, updated_at
		 FROM swarms ORDER BY created_at DESC`)
	if err != nil {
		return nil, fmt.Errorf("store: list swarms: %w", err)
	}
	defer rows.Close()

	var swarms []domain.Swarm
	for rows.Next() {
		var sw domain.Swarm
		var specJSON []byte
		var status string
		if err := rows.Scan(&sw.ID, &sw.Name, &specJSON, &status, &sw.CreatedAt, &sw.UpdatedAt); err != nil {
			return nil, fmt.Errorf("store: scan swarm: %w", err)
		}
		if err := json.Unmarshal(specJSON, &sw.Spec); err != nil {
			return nil, fmt.Errorf("store: unmarshal swarm spec: %w", err)
		}
		sw.Status = domain.SwarmStatus(status)
		swarms = append(swarms, sw)
	}
	return swarms, rows.Err()
}

// GetSwarmByName returns a single swarm looked up by its unique name.
func (s *Store) GetSwarmByName(ctx context.Context, name string) (*domain.Swarm, error) {
	var sw domain.Swarm
	var specJSON []byte
	var status string
	err := s.pool.QueryRow(ctx,
		`SELECT id, name, spec, status, created_at, updated_at
		 FROM swarms WHERE name = $1`, name,
	).Scan(&sw.ID, &sw.Name, &specJSON, &status, &sw.CreatedAt, &sw.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("store: get swarm %q: %w", name, err)
	}
	if err := json.Unmarshal(specJSON, &sw.Spec); err != nil {
		return nil, fmt.Errorf("store: unmarshal swarm spec: %w", err)
	}
	sw.Status = domain.SwarmStatus(status)
	return &sw, nil
}

// DeleteSwarm removes a swarm by name.
func (s *Store) DeleteSwarm(ctx context.Context, name string) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM swarms WHERE name = $1`, name)
	if err != nil {
		return fmt.Errorf("store: delete swarm %q: %w", name, err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("store: swarm %q not found", name)
	}
	return nil
}

// UpdateSwarmStatus sets the status and bumps updated_at.
func (s *Store) UpdateSwarmStatus(ctx context.Context, name string, status domain.SwarmStatus) error {
	tag, err := s.pool.Exec(ctx,
		`UPDATE swarms SET status = $1, updated_at = now() WHERE name = $2`,
		string(status), name)
	if err != nil {
		return fmt.Errorf("store: update swarm status %q: %w", name, err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("store: swarm %q not found", name)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

// CreateTask inserts a task. The SwarmName field is resolved to its swarm_id.
func (s *Store) CreateTask(ctx context.Context, t *domain.Task) error {
	metaJSON, err := json.Marshal(t.Metadata)
	if err != nil {
		return fmt.Errorf("store: marshal task metadata: %w", err)
	}
	return s.pool.QueryRow(ctx,
		`INSERT INTO tasks (swarm_id, agent_role, input, status, metadata)
		 VALUES ((SELECT id FROM swarms WHERE name = $1), $2, $3, $4, $5)
		 RETURNING id, created_at`,
		t.SwarmName, t.AgentRole, t.Input, string(t.Status), metaJSON,
	).Scan(&t.ID, &t.CreatedAt)
}

// ListTasksBySwarm returns all tasks belonging to a swarm, newest first.
func (s *Store) ListTasksBySwarm(ctx context.Context, swarmName string) ([]domain.Task, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT t.id, s.name, t.agent_role, t.assigned_agent_id,
		        t.input, t.output, t.status, t.tokens_used, t.cost_usd,
		        t.latency_ms, t.error, t.trace_id, t.metadata,
		        t.created_at, t.completed_at
		 FROM tasks t
		 JOIN swarms s ON s.id = t.swarm_id
		 WHERE s.name = $1
		 ORDER BY t.created_at DESC`, swarmName)
	if err != nil {
		return nil, fmt.Errorf("store: list tasks for swarm %q: %w", swarmName, err)
	}
	defer rows.Close()

	var tasks []domain.Task
	for rows.Next() {
		t, err := scanTask(rows)
		if err != nil {
			return nil, err
		}
		tasks = append(tasks, t)
	}
	return tasks, rows.Err()
}

// GetTaskByID returns a single task by its UUID.
func (s *Store) GetTaskByID(ctx context.Context, id string) (*domain.Task, error) {
	row := s.pool.QueryRow(ctx,
		`SELECT t.id, s.name, t.agent_role, t.assigned_agent_id,
		        t.input, t.output, t.status, t.tokens_used, t.cost_usd,
		        t.latency_ms, t.error, t.trace_id, t.metadata,
		        t.created_at, t.completed_at
		 FROM tasks t
		 JOIN swarms s ON s.id = t.swarm_id
		 WHERE t.id = $1`, id)

	var t domain.Task
	var (
		assignedAgent *string
		output        *string
		latencyMs     *int64
		errStr        *string
		traceID       *string
		metaJSON      []byte
		status        string
	)
	err := row.Scan(
		&t.ID, &t.SwarmName, &t.AgentRole, &assignedAgent,
		&t.Input, &output, &status, &t.TokensUsed, &t.CostUSD,
		&latencyMs, &errStr, &traceID, &metaJSON,
		&t.CreatedAt, &t.CompletedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("store: get task %q: %w", id, err)
	}
	t.Status = domain.TaskStatus(status)
	if assignedAgent != nil {
		t.AssignedAgent = *assignedAgent
	}
	if output != nil {
		t.Output = *output
	}
	if latencyMs != nil {
		t.LatencyMs = *latencyMs
	}
	if errStr != nil {
		t.Error = *errStr
	}
	if traceID != nil {
		t.TraceID = *traceID
	}
	if metaJSON != nil {
		_ = json.Unmarshal(metaJSON, &t.Metadata)
	}
	return &t, nil
}

// UpdateTaskStatus sets the task status (and optionally assigned agent).
func (s *Store) UpdateTaskStatus(ctx context.Context, id string, status domain.TaskStatus, assignedAgent string) error {
	var (
		tag pgconn.CommandTag
		err error
	)
	if assignedAgent != "" {
		tag, err = s.pool.Exec(ctx,
			`UPDATE tasks SET status = $1, assigned_agent_id = $2 WHERE id = $3`,
			string(status), assignedAgent, id)
	} else {
		tag, err = s.pool.Exec(ctx,
			`UPDATE tasks SET status = $1 WHERE id = $2`,
			string(status), id)
	}
	if err != nil {
		return fmt.Errorf("store: update task status %q: %w", id, err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("store: task %q not found", id)
	}
	return nil
}

// UpdateTaskResult records the output, cost, and completion of a task.
func (s *Store) UpdateTaskResult(ctx context.Context, id string, output string, tokensUsed int, costUSD float64, latencyMs int64, taskErr string) error {
	now := time.Now()
	var errVal *string
	if taskErr != "" {
		errVal = &taskErr
	}
	tag, err := s.pool.Exec(ctx,
		`UPDATE tasks
		 SET output = $1, tokens_used = $2, cost_usd = $3,
		     latency_ms = $4, error = $5, completed_at = $6
		 WHERE id = $7`,
		output, tokensUsed, costUSD, latencyMs, errVal, now, id)
	if err != nil {
		return fmt.Errorf("store: update task result %q: %w", id, err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("store: task %q not found", id)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------

// CreatePolicy inserts a new policy and returns it with server-generated fields.
func (s *Store) CreatePolicy(ctx context.Context, p *domain.Policy) error {
	specJSON, err := json.Marshal(p.Spec)
	if err != nil {
		return fmt.Errorf("store: marshal policy spec: %w", err)
	}
	return s.pool.QueryRow(ctx,
		`INSERT INTO policies (name, spec)
		 VALUES ($1, $2)
		 RETURNING id, created_at`,
		p.Name, specJSON,
	).Scan(&p.ID, &p.CreatedAt)
}

// ListPolicies returns all policies ordered by creation time.
func (s *Store) ListPolicies(ctx context.Context) ([]domain.Policy, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, name, spec, created_at
		 FROM policies ORDER BY created_at DESC`)
	if err != nil {
		return nil, fmt.Errorf("store: list policies: %w", err)
	}
	defer rows.Close()

	var policies []domain.Policy
	for rows.Next() {
		var p domain.Policy
		var specJSON []byte
		if err := rows.Scan(&p.ID, &p.Name, &specJSON, &p.CreatedAt); err != nil {
			return nil, fmt.Errorf("store: scan policy: %w", err)
		}
		if err := json.Unmarshal(specJSON, &p.Spec); err != nil {
			return nil, fmt.Errorf("store: unmarshal policy spec: %w", err)
		}
		policies = append(policies, p)
	}
	return policies, rows.Err()
}

// GetPolicyByName returns a single policy by its unique name.
func (s *Store) GetPolicyByName(ctx context.Context, name string) (*domain.Policy, error) {
	var p domain.Policy
	var specJSON []byte
	err := s.pool.QueryRow(ctx,
		`SELECT id, name, spec, created_at
		 FROM policies WHERE name = $1`, name,
	).Scan(&p.ID, &p.Name, &specJSON, &p.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("store: get policy %q: %w", name, err)
	}
	if err := json.Unmarshal(specJSON, &p.Spec); err != nil {
		return nil, fmt.Errorf("store: unmarshal policy spec: %w", err)
	}
	return &p, nil
}

// ---------------------------------------------------------------------------
// Genomes
// ---------------------------------------------------------------------------

// CreateGenome inserts a new genome record. genes and fitness are passed as
// pre-marshalled JSON ([]byte) to avoid circular imports with the genetics
// package.
func (s *Store) CreateGenome(ctx context.Context, id, swarmName, agentRole string, generation int, parentIDs []string, active bool, genesJSON []byte, fitnessJSON []byte) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO genomes (id, swarm_name, agent_role, generation, parent_ids, active, genes, fitness)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
		id, swarmName, agentRole, generation, parentIDs, active, genesJSON, fitnessJSON)
	if err != nil {
		return fmt.Errorf("store: create genome: %w", err)
	}
	return nil
}

// GenomeRow is a raw row from the genomes table, used to decouple the store
// from the genetics package types.
type GenomeRow struct {
	ID          string
	SwarmName   string
	AgentRole   string
	Generation  int
	ParentIDs   []string
	Active      bool
	GenesJSON   []byte
	FitnessJSON []byte
	CreatedAt   time.Time
}

// ListGenomesBySwarm returns all genomes for a swarm, newest first.
func (s *Store) ListGenomesBySwarm(ctx context.Context, swarmName string) ([]GenomeRow, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, swarm_name, agent_role, generation, parent_ids, active, genes, fitness, created_at
		 FROM genomes WHERE swarm_name = $1
		 ORDER BY created_at DESC`, swarmName)
	if err != nil {
		return nil, fmt.Errorf("store: list genomes for swarm %q: %w", swarmName, err)
	}
	defer rows.Close()

	var genomes []GenomeRow
	for rows.Next() {
		var g GenomeRow
		if err := rows.Scan(&g.ID, &g.SwarmName, &g.AgentRole, &g.Generation,
			&g.ParentIDs, &g.Active, &g.GenesJSON, &g.FitnessJSON, &g.CreatedAt); err != nil {
			return nil, fmt.Errorf("store: scan genome: %w", err)
		}
		genomes = append(genomes, g)
	}
	return genomes, rows.Err()
}

// GetGenomeByID returns a single genome by its UUID.
func (s *Store) GetGenomeByID(ctx context.Context, id string) (*GenomeRow, error) {
	var g GenomeRow
	err := s.pool.QueryRow(ctx,
		`SELECT id, swarm_name, agent_role, generation, parent_ids, active, genes, fitness, created_at
		 FROM genomes WHERE id = $1`, id,
	).Scan(&g.ID, &g.SwarmName, &g.AgentRole, &g.Generation,
		&g.ParentIDs, &g.Active, &g.GenesJSON, &g.FitnessJSON, &g.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("store: get genome %q: %w", id, err)
	}
	return &g, nil
}

// UpdateGenomeFitness updates the fitness JSONB field for a genome.
func (s *Store) UpdateGenomeFitness(ctx context.Context, id string, fitnessJSON []byte) error {
	tag, err := s.pool.Exec(ctx,
		`UPDATE genomes SET fitness = $1 WHERE id = $2`,
		fitnessJSON, id)
	if err != nil {
		return fmt.Errorf("store: update genome fitness %q: %w", id, err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("store: genome %q not found", id)
	}
	return nil
}

// DeactivateGenomes marks all active genomes for a swarm+role as inactive.
func (s *Store) DeactivateGenomes(ctx context.Context, swarmName, agentRole string) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE genomes SET active = false WHERE swarm_name = $1 AND agent_role = $2 AND active = true`,
		swarmName, agentRole)
	if err != nil {
		return fmt.Errorf("store: deactivate genomes for %s/%s: %w", swarmName, agentRole, err)
	}
	return nil
}

// ListActiveGenomesByRole returns active genomes for a specific swarm+role.
func (s *Store) ListActiveGenomesByRole(ctx context.Context, swarmName, agentRole string) ([]GenomeRow, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, swarm_name, agent_role, generation, parent_ids, active, genes, fitness, created_at
		 FROM genomes WHERE swarm_name = $1 AND agent_role = $2 AND active = true
		 ORDER BY created_at DESC`, swarmName, agentRole)
	if err != nil {
		return nil, fmt.Errorf("store: list active genomes for %s/%s: %w", swarmName, agentRole, err)
	}
	defer rows.Close()

	var genomes []GenomeRow
	for rows.Next() {
		var g GenomeRow
		if err := rows.Scan(&g.ID, &g.SwarmName, &g.AgentRole, &g.Generation,
			&g.ParentIDs, &g.Active, &g.GenesJSON, &g.FitnessJSON, &g.CreatedAt); err != nil {
			return nil, fmt.Errorf("store: scan genome: %w", err)
		}
		genomes = append(genomes, g)
	}
	return genomes, rows.Err()
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

// scanner is satisfied by both pgx.Row and pgx.Rows.
type scanner interface {
	Scan(dest ...any) error
}

func scanTask(sc scanner) (domain.Task, error) {
	var t domain.Task
	var (
		assignedAgent *string
		output        *string
		latencyMs     *int64
		errStr        *string
		traceID       *string
		metaJSON      []byte
		status        string
	)
	err := sc.Scan(
		&t.ID, &t.SwarmName, &t.AgentRole, &assignedAgent,
		&t.Input, &output, &status, &t.TokensUsed, &t.CostUSD,
		&latencyMs, &errStr, &traceID, &metaJSON,
		&t.CreatedAt, &t.CompletedAt,
	)
	if err != nil {
		return t, fmt.Errorf("store: scan task: %w", err)
	}
	t.Status = domain.TaskStatus(status)
	if assignedAgent != nil {
		t.AssignedAgent = *assignedAgent
	}
	if output != nil {
		t.Output = *output
	}
	if latencyMs != nil {
		t.LatencyMs = *latencyMs
	}
	if errStr != nil {
		t.Error = *errStr
	}
	if traceID != nil {
		t.TraceID = *traceID
	}
	if metaJSON != nil {
		_ = json.Unmarshal(metaJSON, &t.Metadata)
	}
	return t, nil
}
