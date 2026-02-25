package genetics

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"log/slog"
	"math"
	"math/big"
	"sort"
	"time"

	"github.com/openswarm/openswarm/internal/domain"
	"github.com/openswarm/openswarm/internal/store"
)

// Genome represents an agent configuration snapshot.
type Genome struct {
	ID         string        `json:"id"`
	SwarmName  string        `json:"swarmName"`
	AgentRole  string        `json:"agentRole"`
	Generation int           `json:"generation"`
	ParentIDs  []string      `json:"parentIds,omitempty"`
	Active     bool          `json:"active"`
	Genes      GeneSet       `json:"genes"`
	Fitness    *FitnessScore `json:"fitness,omitempty"`
	CreatedAt  time.Time     `json:"createdAt"`
}

// GeneSet holds the evolvable parameters of an agent.
type GeneSet struct {
	SystemPrompt string   `json:"systemPrompt"` // SOUL.md content
	Temperature  float64  `json:"temperature"`
	TopP         float64  `json:"topP"`
	Model        string   `json:"model"`
	Skills       []string `json:"skills,omitempty"`
	MaxTokens    int      `json:"maxTokens"`
}

// FitnessScore aggregates task performance metrics.
type FitnessScore struct {
	Score          float64 `json:"score"`          // composite 0-1
	TasksCompleted int     `json:"tasksCompleted"`
	AvgLatencyMs   int64   `json:"avgLatencyMs"`
	AvgCostUSD     float64 `json:"avgCostUsd"`
	ErrorRate      float64 `json:"errorRate"`
	AvgTokens      int     `json:"avgTokens"`
}

// Engine manages the genetics lifecycle: snapshot, fitness tracking, evolution.
type Engine struct {
	store *store.Store
}

// New creates a new genetics Engine backed by the given store.
func New(st *store.Store) *Engine {
	return &Engine{store: st}
}

// SnapshotGenome creates a generation-0 genome from a swarm's agent spec.
func (e *Engine) SnapshotGenome(ctx context.Context, swarmName, agentRole string, genes GeneSet) (*Genome, error) {
	id, err := generateUUID()
	if err != nil {
		return nil, fmt.Errorf("genetics: generate id: %w", err)
	}

	g := &Genome{
		ID:         id,
		SwarmName:  swarmName,
		AgentRole:  agentRole,
		Generation: 0,
		Active:     true,
		Genes:      genes,
		CreatedAt:  time.Now(),
	}

	genesJSON, err := json.Marshal(g.Genes)
	if err != nil {
		return nil, fmt.Errorf("genetics: marshal genes: %w", err)
	}

	// Fitness starts as nil/empty
	fitnessJSON := []byte("{}")

	if err := e.store.CreateGenome(ctx, g.ID, g.SwarmName, g.AgentRole,
		g.Generation, g.ParentIDs, g.Active, genesJSON, fitnessJSON); err != nil {
		return nil, fmt.Errorf("genetics: snapshot genome: %w", err)
	}

	slog.Info("genome snapshot created", "id", g.ID, "swarm", swarmName, "role", agentRole)
	return g, nil
}

// RecordFitness updates the fitness score for a genome based on a completed task.
// It retrieves the existing fitness, incorporates the new task's metrics, and
// recomputes the composite score using an incremental average.
func (e *Engine) RecordFitness(ctx context.Context, genomeID string, task domain.Task) error {
	row, err := e.store.GetGenomeByID(ctx, genomeID)
	if err != nil {
		return fmt.Errorf("genetics: record fitness: %w", err)
	}

	var fitness FitnessScore
	if row.FitnessJSON != nil && len(row.FitnessJSON) > 0 {
		_ = json.Unmarshal(row.FitnessJSON, &fitness)
	}

	// Determine if this task was an error
	isError := task.Status == domain.TaskStatusFailed

	// Incremental update of averages
	n := fitness.TasksCompleted
	fitness.TasksCompleted = n + 1

	if n == 0 {
		fitness.AvgLatencyMs = task.LatencyMs
		fitness.AvgCostUSD = task.CostUSD
		fitness.AvgTokens = task.TokensUsed
		if isError {
			fitness.ErrorRate = 1.0
		} else {
			fitness.ErrorRate = 0.0
		}
	} else {
		nf := float64(n)
		fitness.AvgLatencyMs = (fitness.AvgLatencyMs*int64(n) + task.LatencyMs) / int64(n+1)
		fitness.AvgCostUSD = (fitness.AvgCostUSD*nf + task.CostUSD) / (nf + 1)
		fitness.AvgTokens = (fitness.AvgTokens*n + task.TokensUsed) / (n + 1)

		var errorCount float64
		if isError {
			errorCount = 1.0
		}
		fitness.ErrorRate = (fitness.ErrorRate*nf + errorCount) / (nf + 1)
	}

	// Recompute composite fitness score
	fitness.Score = ComputeFitness(fitness.TasksCompleted, fitness.AvgLatencyMs, fitness.AvgCostUSD, fitness.ErrorRate)

	fitnessJSON, err := json.Marshal(fitness)
	if err != nil {
		return fmt.Errorf("genetics: marshal fitness: %w", err)
	}

	if err := e.store.UpdateGenomeFitness(ctx, genomeID, fitnessJSON); err != nil {
		return fmt.Errorf("genetics: update fitness: %w", err)
	}

	slog.Info("genome fitness updated", "genomeId", genomeID, "score", fitness.Score, "tasks", fitness.TasksCompleted)
	return nil
}

// ComputeFitness calculates the composite fitness score from task metrics.
//
//	score = 0.4 * (1 - errorRate)
//	      + 0.3 * (1 / (1 + avgLatencyMs/1000))
//	      + 0.2 * (1 / (1 + avgCostUSD*100))
//	      + 0.1 * min(tasksCompleted/10, 1.0)
func ComputeFitness(tasksCompleted int, avgLatencyMs int64, avgCostUSD float64, errorRate float64) float64 {
	reliability := 1.0 - errorRate
	speed := 1.0 / (1.0 + float64(avgLatencyMs)/1000.0)
	cost := 1.0 / (1.0 + avgCostUSD*100.0)
	experience := math.Min(float64(tasksCompleted)/10.0, 1.0)

	return 0.4*reliability + 0.3*speed + 0.2*cost + 0.1*experience
}

// Evolve runs one generation cycle for a given swarm and agent role:
//  1. Selection: tournament — take top 40% of population by fitness.
//  2. Crossover: blend GeneSet from parent pairs.
//  3. Mutation: with 20% probability, perturb Temperature and TopP.
//  4. Create new genomes with incremented generation, deactivate old.
func (e *Engine) Evolve(ctx context.Context, swarmName, agentRole string) ([]Genome, error) {
	rows, err := e.store.ListActiveGenomesByRole(ctx, swarmName, agentRole)
	if err != nil {
		return nil, fmt.Errorf("genetics: evolve: %w", err)
	}

	if len(rows) < 2 {
		return nil, fmt.Errorf("genetics: need at least 2 active genomes to evolve, found %d", len(rows))
	}

	// Convert store rows to Genome structs
	population := make([]Genome, 0, len(rows))
	for _, row := range rows {
		g, err := rowToGenome(row)
		if err != nil {
			return nil, fmt.Errorf("genetics: convert genome row: %w", err)
		}
		population = append(population, *g)
	}

	// Step 1: Selection — sort by fitness descending, take top 40%
	sort.Slice(population, func(i, j int) bool {
		fi := fitnessScoreOf(population[i])
		fj := fitnessScoreOf(population[j])
		return fi > fj
	})

	selectCount := int(math.Ceil(float64(len(population)) * 0.4))
	if selectCount < 2 {
		selectCount = 2
	}
	parents := population[:selectCount]

	// Determine max generation among parents
	maxGen := 0
	for _, p := range parents {
		if p.Generation > maxGen {
			maxGen = p.Generation
		}
	}
	nextGen := maxGen + 1

	// Step 2+3: Crossover + Mutation — pair consecutive parents
	var children []Genome
	for i := 0; i+1 < len(parents); i += 2 {
		p1 := parents[i]
		p2 := parents[i+1]

		childGenes := CrossoverGenes(p1.Genes, p2.Genes, fitnessScoreOf(p1), fitnessScoreOf(p2))
		childGenes = MutateGenes(childGenes)

		childID, err := generateUUID()
		if err != nil {
			return nil, fmt.Errorf("genetics: generate child id: %w", err)
		}

		child := Genome{
			ID:         childID,
			SwarmName:  swarmName,
			AgentRole:  agentRole,
			Generation: nextGen,
			ParentIDs:  []string{p1.ID, p2.ID},
			Active:     true,
			Genes:      childGenes,
			CreatedAt:  time.Now(),
		}
		children = append(children, child)
	}

	// If odd number of parents, carry the last parent forward with mutation
	if len(parents)%2 == 1 {
		last := parents[len(parents)-1]
		childGenes := MutateGenes(last.Genes)
		childID, err := generateUUID()
		if err != nil {
			return nil, fmt.Errorf("genetics: generate child id: %w", err)
		}
		child := Genome{
			ID:         childID,
			SwarmName:  swarmName,
			AgentRole:  agentRole,
			Generation: nextGen,
			ParentIDs:  []string{last.ID},
			Active:     true,
			Genes:      childGenes,
			CreatedAt:  time.Now(),
		}
		children = append(children, child)
	}

	// Step 4: Deactivate old genomes, persist new children
	if err := e.store.DeactivateGenomes(ctx, swarmName, agentRole); err != nil {
		return nil, fmt.Errorf("genetics: deactivate old genomes: %w", err)
	}

	for i := range children {
		genesJSON, err := json.Marshal(children[i].Genes)
		if err != nil {
			return nil, fmt.Errorf("genetics: marshal child genes: %w", err)
		}
		fitnessJSON := []byte("{}")

		if err := e.store.CreateGenome(ctx, children[i].ID, children[i].SwarmName,
			children[i].AgentRole, children[i].Generation, children[i].ParentIDs,
			children[i].Active, genesJSON, fitnessJSON); err != nil {
			return nil, fmt.Errorf("genetics: persist child genome: %w", err)
		}
	}

	slog.Info("evolution complete", "swarm", swarmName, "role", agentRole,
		"generation", nextGen, "parents", len(parents), "children", len(children))
	return children, nil
}

// ListGenomes returns all genomes for a swarm.
func (e *Engine) ListGenomes(ctx context.Context, swarmName string) ([]Genome, error) {
	rows, err := e.store.ListGenomesBySwarm(ctx, swarmName)
	if err != nil {
		return nil, fmt.Errorf("genetics: list genomes: %w", err)
	}

	genomes := make([]Genome, 0, len(rows))
	for _, row := range rows {
		g, err := rowToGenome(row)
		if err != nil {
			return nil, fmt.Errorf("genetics: convert genome row: %w", err)
		}
		genomes = append(genomes, *g)
	}
	return genomes, nil
}

// GetGenome returns a single genome by ID.
func (e *Engine) GetGenome(ctx context.Context, id string) (*Genome, error) {
	row, err := e.store.GetGenomeByID(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("genetics: get genome: %w", err)
	}
	return rowToGenome(*row)
}

// ---------------------------------------------------------------------------
// Pure functions: crossover and mutation (exported for testing)
// ---------------------------------------------------------------------------

// CrossoverGenes blends two parent GeneSets. The parent with higher fitness
// contributes the SystemPrompt and Model. Numeric parameters are averaged.
// Skills are the union of both parents.
func CrossoverGenes(p1, p2 GeneSet, fitness1, fitness2 float64) GeneSet {
	child := GeneSet{}

	// SystemPrompt and Model: pick from fitter parent
	if fitness1 >= fitness2 {
		child.SystemPrompt = p1.SystemPrompt
		child.Model = p1.Model
	} else {
		child.SystemPrompt = p2.SystemPrompt
		child.Model = p2.Model
	}

	// Temperature: average of parents + small noise
	child.Temperature = (p1.Temperature + p2.Temperature) / 2.0
	noise := cryptoRandFloat(-0.02, 0.02)
	child.Temperature = clamp(child.Temperature+noise, 0.0, 2.0)

	// TopP: average of parents + small noise
	child.TopP = (p1.TopP + p2.TopP) / 2.0
	noise = cryptoRandFloat(-0.02, 0.02)
	child.TopP = clamp(child.TopP+noise, 0.0, 1.0)

	// MaxTokens: average
	child.MaxTokens = (p1.MaxTokens + p2.MaxTokens) / 2

	// Skills: union of both parents
	skillSet := make(map[string]struct{})
	for _, sk := range p1.Skills {
		skillSet[sk] = struct{}{}
	}
	for _, sk := range p2.Skills {
		skillSet[sk] = struct{}{}
	}
	child.Skills = make([]string, 0, len(skillSet))
	for sk := range skillSet {
		child.Skills = append(child.Skills, sk)
	}
	sort.Strings(child.Skills) // deterministic ordering

	return child
}

// MutateGenes applies random mutations with 20% probability.
// Temperature: += random(-0.05, 0.05), clamped to [0.0, 2.0]
// TopP: += random(-0.05, 0.05), clamped to [0.0, 1.0]
func MutateGenes(genes GeneSet) GeneSet {
	mutated := genes

	// Copy skills slice to avoid aliasing
	if genes.Skills != nil {
		mutated.Skills = make([]string, len(genes.Skills))
		copy(mutated.Skills, genes.Skills)
	}

	if cryptoRandFloat(0, 1) < 0.2 {
		delta := cryptoRandFloat(-0.05, 0.05)
		mutated.Temperature = clamp(mutated.Temperature+delta, 0.0, 2.0)
	}

	if cryptoRandFloat(0, 1) < 0.2 {
		delta := cryptoRandFloat(-0.05, 0.05)
		mutated.TopP = clamp(mutated.TopP+delta, 0.0, 1.0)
	}

	return mutated
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func rowToGenome(row store.GenomeRow) (*Genome, error) {
	g := &Genome{
		ID:         row.ID,
		SwarmName:  row.SwarmName,
		AgentRole:  row.AgentRole,
		Generation: row.Generation,
		ParentIDs:  row.ParentIDs,
		Active:     row.Active,
		CreatedAt:  row.CreatedAt,
	}

	if err := json.Unmarshal(row.GenesJSON, &g.Genes); err != nil {
		return nil, fmt.Errorf("genetics: unmarshal genes: %w", err)
	}

	if row.FitnessJSON != nil && len(row.FitnessJSON) > 0 {
		var f FitnessScore
		if err := json.Unmarshal(row.FitnessJSON, &f); err == nil && f.TasksCompleted > 0 {
			g.Fitness = &f
		}
	}

	return g, nil
}

func fitnessScoreOf(g Genome) float64 {
	if g.Fitness == nil {
		return 0.0
	}
	return g.Fitness.Score
}

// clamp restricts v to the range [lo, hi].
func clamp(v, lo, hi float64) float64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

// cryptoRandFloat returns a cryptographically random float64 in [lo, hi).
func cryptoRandFloat(lo, hi float64) float64 {
	// Generate a random uint64 using crypto/rand
	n, err := rand.Int(rand.Reader, big.NewInt(1<<53))
	if err != nil {
		// Fallback: return midpoint if crypto/rand fails (should not happen)
		return (lo + hi) / 2.0
	}
	// Convert to [0, 1) range
	f := float64(n.Int64()) / float64(1<<53)
	return lo + f*(hi-lo)
}

// generateUUID creates a v4 UUID using crypto/rand.
func generateUUID() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("generate uuid: %w", err)
	}
	// Set version 4 and variant bits
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
		b[0:4], b[4:6], b[6:8], b[8:10], b[10:16]), nil
}
