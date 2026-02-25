package domain

import "time"

// AuditAction represents the type of auditable event.
type AuditAction string

const (
	AuditTaskStarted      AuditAction = "task_started"
	AuditTaskCompleted    AuditAction = "task_completed"
	AuditTaskFailed       AuditAction = "task_failed"
	AuditLLMCall          AuditAction = "llm_call"
	AuditToolCall         AuditAction = "tool_call"
	AuditPolicyViolation  AuditAction = "policy_violation"
	AuditBudgetAlert      AuditAction = "budget_alert"
	AuditBudgetExceeded   AuditAction = "budget_exceeded"
	AuditAgentRegistered  AuditAction = "agent_registered"
	AuditAgentDeregistered AuditAction = "agent_deregistered"
	AuditAgentBankrupt    AuditAction = "agent_bankrupt"
	AuditGenomeEvolved    AuditAction = "genome_evolved"
	AuditCheckpointPaused AuditAction = "checkpoint_paused"
	AuditCheckpointResumed AuditAction = "checkpoint_resumed"
)

// AuditEvent is a single entry in the tamper-evident audit log.
type AuditEvent struct {
	Time       time.Time         `json:"time"`
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
