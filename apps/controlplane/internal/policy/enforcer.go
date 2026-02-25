// Package policy provides enforcement of AgentPolicy rules before task
// execution. Policies control which tools an agent can use, which domains
// it can access, and per-task budget limits.
package policy

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/openswarm/openswarm/internal/audit"
	"github.com/openswarm/openswarm/internal/domain"
	"github.com/openswarm/openswarm/internal/store"
)

// Enforcer loads and enforces policies for agents. It checks tool access,
// egress domains, budget limits, and failure thresholds before allowing
// task execution.
type Enforcer struct {
	store    *store.Store
	auditLog *audit.Logger
}

// New creates a policy enforcer with the given dependencies.
func New(st *store.Store, al *audit.Logger) *Enforcer {
	return &Enforcer{
		store:    st,
		auditLog: al,
	}
}

// Violation represents a policy rule that was violated.
type Violation struct {
	PolicyName string `json:"policyName"`
	Rule       string `json:"rule"`
	Detail     string `json:"detail"`
}

func (v Violation) Error() string {
	return fmt.Sprintf("policy %q violated: %s — %s", v.PolicyName, v.Rule, v.Detail)
}

// CheckTaskBudget verifies that the agent's policy allows the estimated
// cost/tokens for a task. Returns nil if OK, or a Violation if denied.
func (e *Enforcer) CheckTaskBudget(ctx context.Context, agentSpec domain.AgentSpec, estimatedTokens int, estimatedCost float64) *Violation {
	if agentSpec.Policy == "" {
		return nil // no policy = no restrictions
	}

	policy, err := e.store.GetPolicyByName(ctx, agentSpec.Policy)
	if err != nil {
		slog.Warn("policy: could not load policy, allowing task",
			"policy", agentSpec.Policy, "error", err)
		return nil // fail-open if policy not found
	}

	if policy.Spec.Budget == nil {
		return nil
	}

	// Check per-task token limit
	if policy.Spec.Budget.MaxTokensPerTask > 0 && estimatedTokens > policy.Spec.Budget.MaxTokensPerTask {
		v := &Violation{
			PolicyName: policy.Name,
			Rule:       "budget.maxTokensPerTask",
			Detail:     fmt.Sprintf("estimated %d tokens exceeds limit of %d", estimatedTokens, policy.Spec.Budget.MaxTokensPerTask),
		}
		e.logViolation(agentSpec, v)
		return v
	}

	return nil
}

// CheckToolAllowed verifies that a tool is allowed by the agent's policy.
func (e *Enforcer) CheckToolAllowed(ctx context.Context, agentSpec domain.AgentSpec, toolName string) *Violation {
	if agentSpec.Policy == "" {
		return nil
	}

	policy, err := e.store.GetPolicyByName(ctx, agentSpec.Policy)
	if err != nil {
		return nil // fail-open
	}

	if policy.Spec.Tools == nil {
		return nil
	}

	// Check denied list first (deny takes precedence)
	for _, denied := range policy.Spec.Tools.Denied {
		if denied == toolName {
			v := &Violation{
				PolicyName: policy.Name,
				Rule:       "tools.denied",
				Detail:     fmt.Sprintf("tool %q is explicitly denied", toolName),
			}
			e.logViolation(agentSpec, v)
			return v
		}
	}

	// If allowed list is specified, tool must be in it
	if len(policy.Spec.Tools.Allowed) > 0 {
		found := false
		for _, allowed := range policy.Spec.Tools.Allowed {
			if allowed == toolName {
				found = true
				break
			}
		}
		if !found {
			v := &Violation{
				PolicyName: policy.Name,
				Rule:       "tools.allowed",
				Detail:     fmt.Sprintf("tool %q is not in the allowed list", toolName),
			}
			e.logViolation(agentSpec, v)
			return v
		}
	}

	return nil
}

// CheckEgress verifies that a domain is allowed by the agent's egress policy.
func (e *Enforcer) CheckEgress(ctx context.Context, agentSpec domain.AgentSpec, targetDomain string) *Violation {
	if agentSpec.Policy == "" {
		return nil
	}

	policy, err := e.store.GetPolicyByName(ctx, agentSpec.Policy)
	if err != nil {
		return nil // fail-open
	}

	if policy.Spec.Egress == nil || len(policy.Spec.Egress.AllowedDomains) == 0 {
		return nil // no egress restrictions
	}

	for _, allowed := range policy.Spec.Egress.AllowedDomains {
		if matchDomain(allowed, targetDomain) {
			return nil
		}
	}

	v := &Violation{
		PolicyName: policy.Name,
		Rule:       "egress.allowedDomains",
		Detail:     fmt.Sprintf("domain %q is not in the allowed list", targetDomain),
	}
	e.logViolation(agentSpec, v)
	return v
}

// GetFailurePolicy returns the failure policy for an agent, or nil if none.
func (e *Enforcer) GetFailurePolicy(ctx context.Context, agentSpec domain.AgentSpec) *domain.FailurePolicy {
	if agentSpec.Policy == "" {
		return nil
	}

	policy, err := e.store.GetPolicyByName(ctx, agentSpec.Policy)
	if err != nil {
		return nil
	}

	return policy.Spec.Failure
}

// logViolation emits an audit event for a policy violation.
func (e *Enforcer) logViolation(agentSpec domain.AgentSpec, v *Violation) {
	if e.auditLog == nil {
		return
	}
	e.auditLog.Log(domain.AuditEvent{
		AgentID: agentSpec.Name,
		Action:  domain.AuditPolicyViolation,
		Metadata: audit.Meta(
			"policy", v.PolicyName,
			"rule", v.Rule,
			"detail", v.Detail,
		),
	})
}

// matchDomain checks if a target domain matches an allowed pattern.
// Supports wildcard prefix: "*.example.com" matches "foo.example.com".
func matchDomain(pattern, target string) bool {
	if pattern == target {
		return true
	}
	// Wildcard: "*.example.com" matches "sub.example.com"
	if len(pattern) > 2 && pattern[:2] == "*." {
		suffix := pattern[1:] // ".example.com"
		if len(target) > len(suffix) && target[len(target)-len(suffix):] == suffix {
			return true
		}
	}
	return false
}
