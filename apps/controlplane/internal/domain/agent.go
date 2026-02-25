package domain

import "time"

// AgentStatus represents the current lifecycle state of an agent instance.
type AgentStatus string

const (
	AgentStatusPending  AgentStatus = "pending"
	AgentStatusOnline   AgentStatus = "online"
	AgentStatusBusy     AgentStatus = "busy"
	AgentStatusDraining AgentStatus = "draining"
	AgentStatusOffline  AgentStatus = "offline"
	AgentStatusError    AgentStatus = "error"
)

// Agent represents a running OpenClaw instance managed by the orchestrator.
type Agent struct {
	ID           string            `json:"id"`
	SwarmName    string            `json:"swarmName"`
	Role         string            `json:"role"`
	Status       AgentStatus       `json:"status"`
	Model        string            `json:"model"`
	OpenClawAddr string            `json:"openclawAddr"` // host:port of the OpenClaw Gateway
	ContainerID  string            `json:"containerId,omitempty"` // Docker container ID
	ConfigHash   string            `json:"configHash"`
	Labels       map[string]string `json:"labels,omitempty"`
	RegisteredAt time.Time         `json:"registeredAt"`
	LastSeen     time.Time         `json:"lastSeen"`
}

// AgentHealth holds real-time health metrics reported by heartbeats.
type AgentHealth struct {
	AgentID      string    `json:"agentId"`
	ContextUsed  int       `json:"contextUsed"` // tokens currently in context window
	QueueDepth   int       `json:"queueDepth"`  // tasks waiting
	HealthScore  float64   `json:"healthScore"` // 0.0-1.0
	CostSession  float64   `json:"costSession"` // USD spent this session
	CurrentTask  string    `json:"currentTask,omitempty"`
	LastReported time.Time `json:"lastReported"`
}

// AgentSpec defines an agent role within a swarm manifest.
type AgentSpec struct {
	Name      string         `json:"name" yaml:"name"`
	Replicas  ReplicaSpec    `json:"replicas" yaml:"replicas"`
	Model     string         `json:"model,omitempty" yaml:"model,omitempty"`
	Soul      string         `json:"soul,omitempty" yaml:"soul,omitempty"`
	Skills    []string       `json:"skills,omitempty" yaml:"skills,omitempty"`
	Tools     []string       `json:"tools,omitempty" yaml:"tools,omitempty"`
	Cron      []CronJob      `json:"cron,omitempty" yaml:"cron,omitempty"`
	Config    map[string]any `json:"config,omitempty" yaml:"config,omitempty"`
	Policy    string         `json:"policy,omitempty" yaml:"policy,omitempty"`
	DependsOn []string       `json:"dependsOn,omitempty" yaml:"dependsOn,omitempty"`
	Genome    *GenomeConfig  `json:"genome,omitempty" yaml:"genome,omitempty"`
	Resources *ResourceSpec  `json:"resources,omitempty" yaml:"resources,omitempty"`
}

// ReplicaSpec controls scaling for an agent role.
type ReplicaSpec struct {
	Min     int32  `json:"min" yaml:"min"`
	Max     int32  `json:"max" yaml:"max"`
	ScaleOn string `json:"scaleOn,omitempty" yaml:"scaleOn,omitempty"` // queue_depth | token_utilization
}

// ResourceSpec defines resource limits for an agent.
type ResourceSpec struct {
	MaxContextTokens   int `json:"maxContextTokens,omitempty" yaml:"maxContextTokens,omitempty"`
	MaxConcurrentTasks int `json:"maxConcurrentTasks,omitempty" yaml:"maxConcurrentTasks,omitempty"`
}
