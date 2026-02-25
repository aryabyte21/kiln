package domain

import "time"

// TaskStatus represents the lifecycle of a task.
type TaskStatus string

const (
	TaskStatusPending   TaskStatus = "pending"
	TaskStatusAssigned  TaskStatus = "assigned"
	TaskStatusRunning   TaskStatus = "running"
	TaskStatusCompleted TaskStatus = "completed"
	TaskStatusFailed    TaskStatus = "failed"
	TaskStatusBankrupt  TaskStatus = "bankrupt"
)

// Task represents a unit of work submitted to a swarm.
type Task struct {
	ID            string            `json:"id"`
	SwarmName     string            `json:"swarmName"`
	AgentRole     string            `json:"agentRole"`
	AssignedAgent string            `json:"assignedAgent,omitempty"`
	Input         string            `json:"input"`
	Output        string            `json:"output,omitempty"`
	Status        TaskStatus        `json:"status"`
	TokensUsed    int               `json:"tokensUsed"`
	CostUSD       float64           `json:"costUsd"`
	LatencyMs     int64             `json:"latencyMs,omitempty"`
	Error         string            `json:"error,omitempty"`
	TraceID       string            `json:"traceId,omitempty"`
	Metadata      map[string]string `json:"metadata,omitempty"`
	CreatedAt     time.Time         `json:"createdAt"`
	CompletedAt   *time.Time        `json:"completedAt,omitempty"`
}

// TaskSubmission is the input for creating a new task.
type TaskSubmission struct {
	SwarmName string            `json:"swarmName"`
	AgentRole string            `json:"agentRole,omitempty"` // empty = auto-route based on topology
	Input     string            `json:"input"`
	Metadata  map[string]string `json:"metadata,omitempty"`
}
