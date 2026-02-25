package domain

import "time"

// Policy defines governance rules for agent behavior.
type Policy struct {
	ID        string     `json:"id"`
	Name      string     `json:"name"`
	Spec      PolicySpec `json:"spec"`
	CreatedAt time.Time  `json:"createdAt"`
}

// PolicyManifest is the full YAML document structure.
type PolicyManifest struct {
	APIVersion string           `json:"apiVersion" yaml:"apiVersion"`
	Kind       string           `json:"kind" yaml:"kind"`
	Metadata   ManifestMetadata `json:"metadata" yaml:"metadata"`
	Spec       PolicySpec       `json:"spec" yaml:"spec"`
}

// PolicySpec defines all policy rules.
type PolicySpec struct {
	Tools   *ToolPolicy    `json:"tools,omitempty" yaml:"tools,omitempty"`
	Egress  *EgressPolicy  `json:"egress,omitempty" yaml:"egress,omitempty"`
	Budget  *BudgetPolicy  `json:"budget,omitempty" yaml:"budget,omitempty"`
	Safety  *SafetyPolicy  `json:"safety,omitempty" yaml:"safety,omitempty"`
	Failure *FailurePolicy `json:"failure,omitempty" yaml:"failure,omitempty"`
}

// ToolPolicy controls which tools an agent can use.
type ToolPolicy struct {
	Allowed    []string          `json:"allowed,omitempty" yaml:"allowed,omitempty"`
	Denied     []string          `json:"denied,omitempty" yaml:"denied,omitempty"`
	RateLimits map[string]string `json:"rateLimits,omitempty" yaml:"rateLimits,omitempty"`
}

// EgressPolicy controls network access.
type EgressPolicy struct {
	AllowedDomains []string `json:"allowedDomains,omitempty" yaml:"allowedDomains,omitempty"`
}

// BudgetPolicy sets per-task cost limits.
type BudgetPolicy struct {
	MaxTokensPerTask int    `json:"maxTokensPerTask,omitempty" yaml:"maxTokensPerTask,omitempty"`
	MaxCostPerTask   string `json:"maxCostPerTask,omitempty" yaml:"maxCostPerTask,omitempty"`
}

// SafetyPolicy configures safety features.
type SafetyPolicy struct {
	BlastRadius     string  `json:"blastRadius,omitempty" yaml:"blastRadius,omitempty"`
	HumanEscalation float64 `json:"humanEscalation,omitempty" yaml:"humanEscalation,omitempty"`
}

// FailurePolicy defines how agent failures are handled.
type FailurePolicy struct {
	BankruptcyThreshold *BankruptcyThreshold `json:"bankruptcyThreshold,omitempty" yaml:"bankruptcyThreshold,omitempty"`
	OnBankruptcy        string               `json:"onBankruptcy,omitempty" yaml:"onBankruptcy,omitempty"` // handoff | restart | terminate
	MaxRetries          int                  `json:"maxRetries,omitempty" yaml:"maxRetries,omitempty"`
}

// BankruptcyThreshold defines when an agent declares bankruptcy.
type BankruptcyThreshold struct {
	ConsecutiveErrors int  `json:"consecutiveErrors,omitempty" yaml:"consecutiveErrors,omitempty"`
	BudgetExhausted   bool `json:"budgetExhausted,omitempty" yaml:"budgetExhausted,omitempty"`
}
