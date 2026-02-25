package config

import (
	"testing"

	"github.com/openswarm/openswarm/internal/domain"
)

func TestResolveAgentConfig_InheritsDefaultModel(t *testing.T) {
	defaults := &domain.DefaultsSpec{
		Model: "groq/llama-3.3-70b-versatile",
		Config: map[string]any{
			"temperature":   0.7,
			"maxTokens":     4096,
			"contextWindow": 131072,
		},
	}
	agent := domain.AgentSpec{
		Name:     "triage",
		Replicas: domain.ReplicaSpec{Min: 1, Max: 1},
	}

	resolved := ResolveAgentConfig(defaults, agent)

	if resolved.Model != "groq/llama-3.3-70b-versatile" {
		t.Errorf("Model = %q, want %q", resolved.Model, "groq/llama-3.3-70b-versatile")
	}
	if resolved.Config["temperature"] != 0.7 {
		t.Errorf("Config[temperature] = %v, want 0.7", resolved.Config["temperature"])
	}
}

func TestResolveAgentConfig_AgentOverridesDefault(t *testing.T) {
	defaults := &domain.DefaultsSpec{
		Model: "groq/llama-3.3-70b-versatile",
		Config: map[string]any{
			"temperature":   0.7,
			"maxTokens":     4096,
			"contextWindow": 131072,
		},
	}
	agent := domain.AgentSpec{
		Name:     "resolver",
		Replicas: domain.ReplicaSpec{Min: 1, Max: 1},
		Model:    "groq/llama-3.1-8b-instant",
		Config: map[string]any{
			"temperature": 0.3,
			"maxTokens":   8192,
		},
	}

	resolved := ResolveAgentConfig(defaults, agent)

	if resolved.Model != "groq/llama-3.1-8b-instant" {
		t.Errorf("Model = %q, want agent override", resolved.Model)
	}
	if resolved.Config["temperature"] != 0.3 {
		t.Errorf("Config[temperature] = %v, want 0.3 (agent override)", resolved.Config["temperature"])
	}
	if resolved.Config["maxTokens"] != 8192 {
		t.Errorf("Config[maxTokens] = %v, want 8192 (agent override)", resolved.Config["maxTokens"])
	}
	if resolved.Config["contextWindow"] != 131072 {
		t.Errorf("Config[contextWindow] = %v, want 131072 (inherited)", resolved.Config["contextWindow"])
	}
}

func TestResolveAgentConfig_NilDefaults(t *testing.T) {
	agent := domain.AgentSpec{
		Name:     "solo",
		Replicas: domain.ReplicaSpec{Min: 1, Max: 1},
		Model:    "groq/llama-3.3-70b-versatile",
		Config: map[string]any{
			"temperature": 0.5,
		},
	}

	resolved := ResolveAgentConfig(nil, agent)

	if resolved.Model != "groq/llama-3.3-70b-versatile" {
		t.Errorf("Model = %q, want %q", resolved.Model, "groq/llama-3.3-70b-versatile")
	}
	if resolved.Config["temperature"] != 0.5 {
		t.Errorf("Config[temperature] = %v, want 0.5", resolved.Config["temperature"])
	}
}

func TestResolveAllAgents(t *testing.T) {
	spec := domain.SwarmSpec{
		Defaults: &domain.DefaultsSpec{
			Model: "groq/llama-3.3-70b-versatile",
			Config: map[string]any{
				"temperature": 0.7,
			},
		},
		Agents: []domain.AgentSpec{
			{Name: "a", Replicas: domain.ReplicaSpec{Min: 1, Max: 1}},
			{Name: "b", Replicas: domain.ReplicaSpec{Min: 1, Max: 1}, Model: "custom/model"},
		},
	}

	resolved := ResolveAllAgents(spec)
	if len(resolved) != 2 {
		t.Fatalf("expected 2 resolved agents, got %d", len(resolved))
	}
	if resolved[0].Model != "groq/llama-3.3-70b-versatile" {
		t.Errorf("agent[0].Model = %q, want default", resolved[0].Model)
	}
	if resolved[1].Model != "custom/model" {
		t.Errorf("agent[1].Model = %q, want override", resolved[1].Model)
	}
}
