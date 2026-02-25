package config

import "github.com/openswarm/openswarm/internal/domain"

// ResolveAgentConfig produces a fully-resolved AgentSpec by deep-merging
// swarm defaults with per-agent overrides. Agent values win on conflict.
func ResolveAgentConfig(defaults *domain.DefaultsSpec, agent domain.AgentSpec) domain.AgentSpec {
	resolved := agent

	if defaults == nil {
		if resolved.Config == nil {
			resolved.Config = make(map[string]any)
		}
		return resolved
	}

	// Model: agent wins, falls back to default
	if resolved.Model == "" {
		resolved.Model = defaults.Model
	}

	// Config: deep merge (defaults first, agent overrides)
	merged := make(map[string]any)
	for k, v := range defaults.Config {
		merged[k] = v
	}
	for k, v := range agent.Config {
		merged[k] = v
	}
	resolved.Config = merged

	return resolved
}

// ResolveAllAgents resolves config for every agent in the spec.
func ResolveAllAgents(spec domain.SwarmSpec) []domain.AgentSpec {
	resolved := make([]domain.AgentSpec, len(spec.Agents))
	for i, a := range spec.Agents {
		resolved[i] = ResolveAgentConfig(spec.Defaults, a)
	}
	return resolved
}
