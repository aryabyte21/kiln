package domain

import "time"

// AuditAction represents the type of auditable event.
type AuditAction string

const (
	AuditTaskStarted       AuditAction = "task_started"
	AuditTaskCompleted     AuditAction = "task_completed"
	AuditTaskFailed        AuditAction = "task_failed"
	AuditLLMCall           AuditAction = "llm_call"
	AuditToolCall          AuditAction = "tool_call"
	AuditPolicyViolation   AuditAction = "policy_violation"
	AuditBudgetAlert       AuditAction = "budget_alert"
	AuditBudgetExceeded    AuditAction = "budget_exceeded"
	AuditAgentRegistered   AuditAction = "agent_registered"
	AuditAgentDeregistered AuditAction = "agent_deregistered"
	AuditAgentBankrupt     AuditAction = "agent_bankrupt"
	AuditGenomeEvolved     AuditAction = "genome_evolved"
	AuditCheckpointPaused  AuditAction = "checkpoint_paused"
	AuditCheckpointResumed AuditAction = "checkpoint_resumed"
	AuditSwarmCreated      AuditAction = "swarm_created"
	AuditSwarmDeleted      AuditAction = "swarm_deleted"
	AuditPipelineMessage   AuditAction = "pipeline_message"
)

// AuditEvent is a single entry in the tamper-evident audit log.
// Events form a per-agent hash chain: each event's PrevHash points to the
// EventHash of the preceding event for the same agent, enabling O(n)
// verification of the full chain.
type AuditEvent struct {
	Time       time.Time         `json:"time"`
	SwarmName  string            `json:"swarmName"`
	AgentID    string            `json:"agentId"`
	TaskID     string            `json:"taskId,omitempty"`
	Action     AuditAction       `json:"action"`
	TokensUsed int               `json:"tokensUsed,omitempty"`
	CostUSD    float64           `json:"costUsd,omitempty"`
	InputHash  string            `json:"inputHash,omitempty"`
	OutputHash string            `json:"outputHash,omitempty"`
	PrevHash   string            `json:"prevHash"`  // SHA-256 of previous event for this agent
	EventHash  string            `json:"eventHash"` // SHA-256 of this event
	Metadata   map[string]string `json:"metadata,omitempty"`
}

// AuditFilter defines query parameters for listing audit events.
type AuditFilter struct {
	SwarmName string
	AgentID   string
	Action    AuditAction
	Limit     int
	Offset    int
}

// AuditChainResult holds the result of verifying an audit hash chain.
type AuditChainResult struct {
	Valid      bool   `json:"valid"`
	EventCount int    `json:"eventCount"`
	FirstEvent string `json:"firstEvent,omitempty"`
	LastEvent  string `json:"lastEvent,omitempty"`
	BrokenAt   int    `json:"brokenAt,omitempty"` // index of first broken link (0 = no break)
	BrokenHash string `json:"brokenHash,omitempty"`
	Error      string `json:"error,omitempty"`
}
