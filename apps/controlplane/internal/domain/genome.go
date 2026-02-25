package domain

import "time"

// GenomeConfig controls evolution settings in the swarm manifest.
type GenomeConfig struct {
	Evolution         bool   `json:"evolution" yaml:"evolution"`
	PopulationSize    int    `json:"populationSize,omitempty" yaml:"populationSize,omitempty"`
	SelectionStrategy string `json:"selectionStrategy,omitempty" yaml:"selectionStrategy,omitempty"` // tournament | roulette
}

// Genome represents a complete agent configuration snapshot.
type Genome struct {
	ID         string        `json:"id"`
	AgentRole  string        `json:"agentRole"`
	Generation int           `json:"generation"`
	ParentIDs  []string      `json:"parentIds,omitempty"`
	Genes      GenomeGenes   `json:"genes"`
	Fitness    GenomeFitness `json:"fitness"`
	Active     bool          `json:"active"`
	CreatedAt  time.Time     `json:"createdAt"`
}

// GenomeGenes are the evolvable parameters of an agent.
type GenomeGenes struct {
	SoulMD       string            `json:"soulMd"`   // SOUL.md content
	AgentsMD     string            `json:"agentsMd"` // AGENTS.md content
	Temperature  float64           `json:"temperature"`
	TopP         float64           `json:"topP"`
	Model        string            `json:"model"`
	Skills       []string          `json:"skills"`
	MemoryConfig map[string]string `json:"memoryConfig,omitempty"`
	HeartbeatMD  string            `json:"heartbeatMd,omitempty"`
}

// GenomeFitness tracks production performance metrics.
type GenomeFitness struct {
	Score          float64 `json:"score"`
	TasksCompleted int64   `json:"tasksCompleted"`
	AvgLatencyMs   float64 `json:"avgLatencyMs"`
	AvgTokenCost   float64 `json:"avgTokenCost"`
	ErrorRate      float64 `json:"errorRate"`
	UserFeedback   float64 `json:"userFeedback,omitempty"`
}
