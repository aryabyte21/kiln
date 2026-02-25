package domain

import "time"

// SwarmStatus represents the lifecycle state of a swarm.
type SwarmStatus string

const (
	SwarmStatusPending SwarmStatus = "pending"
	SwarmStatusRunning SwarmStatus = "running"
	SwarmStatusStopped SwarmStatus = "stopped"
	SwarmStatusError   SwarmStatus = "error"
)

// Swarm is the top-level orchestration unit — a fleet of agents working together.
type Swarm struct {
	ID        string      `json:"id"`
	Name      string      `json:"name"`
	Status    SwarmStatus `json:"status"`
	Spec      SwarmSpec   `json:"spec"`
	CreatedAt time.Time   `json:"createdAt"`
	UpdatedAt time.Time   `json:"updatedAt"`
}

// SwarmSpec is the declarative specification from swarm.yaml.
type SwarmSpec struct {
	Budget      BudgetSpec     `json:"budget" yaml:"budget"`
	Agents      []AgentSpec    `json:"agents" yaml:"agents"`
	Topology    []TopologyEdge `json:"topology,omitempty" yaml:"topology,omitempty"`
	Memory      *MemorySpec    `json:"memory,omitempty" yaml:"memory,omitempty"`
	Checkpoints []Checkpoint   `json:"checkpoints,omitempty" yaml:"checkpoints,omitempty"`
	Audit       *AuditSpec     `json:"audit,omitempty" yaml:"audit,omitempty"`
}

// SwarmManifest is the full YAML document structure.
type SwarmManifest struct {
	APIVersion string           `json:"apiVersion" yaml:"apiVersion"`
	Kind       string           `json:"kind" yaml:"kind"`
	Metadata   ManifestMetadata `json:"metadata" yaml:"metadata"`
	Spec       SwarmSpec        `json:"spec" yaml:"spec"`
}

// ManifestMetadata holds identification and labeling.
type ManifestMetadata struct {
	Name   string            `json:"name" yaml:"name"`
	Labels map[string]string `json:"labels,omitempty" yaml:"labels,omitempty"`
}

// BudgetSpec controls cost limits for a swarm.
type BudgetSpec struct {
	Total    string `json:"total" yaml:"total"` // e.g. "$2.00"
	PerTask  string `json:"perTask,omitempty" yaml:"perTask,omitempty"`
	AlertAt  int    `json:"alertAt" yaml:"alertAt"`   // percentage
	HardStop int    `json:"hardStop" yaml:"hardStop"` // percentage
}

// TopologyEdge defines a data flow connection between agent roles.
type TopologyEdge struct {
	From    string `json:"from" yaml:"from"`
	To      string `json:"to" yaml:"to"`
	Subject string `json:"subject" yaml:"subject"`
}

// MemorySpec configures shared memory tiers.
type MemorySpec struct {
	L2 *L2MemorySpec `json:"l2,omitempty" yaml:"l2,omitempty"`
	L3 *L3MemorySpec `json:"l3,omitempty" yaml:"l3,omitempty"`
}

type L2MemorySpec struct {
	Backend string `json:"backend" yaml:"backend"` // redis
	TTL     int    `json:"ttl" yaml:"ttl"`         // seconds
}

type L3MemorySpec struct {
	Backend    string `json:"backend" yaml:"backend"` // pgvector
	Collection string `json:"collection" yaml:"collection"`
}

// Checkpoint defines a human-in-the-loop gate.
type Checkpoint struct {
	Before          string `json:"before" yaml:"before"`
	Tool            string `json:"tool" yaml:"tool"`
	RequireApproval bool   `json:"requireApproval" yaml:"requireApproval"`
	Timeout         string `json:"timeout,omitempty" yaml:"timeout,omitempty"`
	OnTimeout       string `json:"onTimeout,omitempty" yaml:"onTimeout,omitempty"`
}

// AuditSpec configures audit logging.
type AuditSpec struct {
	Enabled       bool `json:"enabled" yaml:"enabled"`
	HashChaining  bool `json:"hashChaining" yaml:"hashChaining"`
	RetentionDays int  `json:"retentionDays" yaml:"retentionDays"`
}
