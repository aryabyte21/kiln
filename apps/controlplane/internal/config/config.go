package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/openswarm/openswarm/internal/domain"
	"gopkg.in/yaml.v3"
)

// LoadSwarmManifest reads and validates a swarm.yaml file.
func LoadSwarmManifest(path string) (*domain.SwarmManifest, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read swarm manifest: %w", err)
	}

	return ParseSwarmManifest(data)
}

// ParseSwarmManifest parses raw YAML bytes into a SwarmManifest.
func ParseSwarmManifest(data []byte) (*domain.SwarmManifest, error) {
	var manifest domain.SwarmManifest
	if err := yaml.Unmarshal(data, &manifest); err != nil {
		return nil, fmt.Errorf("parse swarm manifest: %w", err)
	}

	if err := validateSwarmManifest(&manifest); err != nil {
		return nil, err
	}

	return &manifest, nil
}

// LoadPolicyManifest reads and validates a policy YAML file.
func LoadPolicyManifest(path string) (*domain.PolicyManifest, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read policy manifest: %w", err)
	}

	return ParsePolicyManifest(data)
}

// ParsePolicyManifest parses raw YAML bytes into a PolicyManifest.
func ParsePolicyManifest(data []byte) (*domain.PolicyManifest, error) {
	var manifest domain.PolicyManifest
	if err := yaml.Unmarshal(data, &manifest); err != nil {
		return nil, fmt.Errorf("parse policy manifest: %w", err)
	}

	if err := validatePolicyManifest(&manifest); err != nil {
		return nil, err
	}

	return &manifest, nil
}

// LoadPoliciesFromDir reads all YAML files in a directory as policy manifests.
func LoadPoliciesFromDir(dir string) ([]*domain.PolicyManifest, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("read policy directory: %w", err)
	}

	var policies []*domain.PolicyManifest
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		ext := strings.ToLower(filepath.Ext(entry.Name()))
		if ext != ".yaml" && ext != ".yml" {
			continue
		}

		p, err := LoadPolicyManifest(filepath.Join(dir, entry.Name()))
		if err != nil {
			return nil, fmt.Errorf("load policy %s: %w", entry.Name(), err)
		}
		policies = append(policies, p)
	}

	return policies, nil
}

func validateSwarmManifest(m *domain.SwarmManifest) error {
	if m.APIVersion != "openswarm/v1alpha1" {
		return fmt.Errorf("unsupported apiVersion: %q (expected openswarm/v1alpha1)", m.APIVersion)
	}
	if m.Kind != "Swarm" {
		return fmt.Errorf("unexpected kind: %q (expected Swarm)", m.Kind)
	}
	if m.Metadata.Name == "" {
		return fmt.Errorf("metadata.name is required")
	}
	if len(m.Spec.Agents) == 0 {
		return fmt.Errorf("spec.agents must contain at least one agent")
	}

	agentNames := make(map[string]bool)
	for i, a := range m.Spec.Agents {
		if a.Name == "" {
			return fmt.Errorf("spec.agents[%d].name is required", i)
		}
		if agentNames[a.Name] {
			return fmt.Errorf("duplicate agent name: %q", a.Name)
		}
		agentNames[a.Name] = true

		if a.Model == "" && (m.Spec.Defaults == nil || m.Spec.Defaults.Model == "") {
			return fmt.Errorf("spec.agents[%d].model is required (no spec.defaults.model set)", i)
		}
		if a.Replicas.Min < 0 {
			return fmt.Errorf("spec.agents[%d].replicas.min must be >= 0", i)
		}
		if a.Replicas.Max < a.Replicas.Min {
			return fmt.Errorf("spec.agents[%d].replicas.max must be >= min", i)
		}
	}

	// Validate topology references
	for i, edge := range m.Spec.Topology {
		if !agentNames[edge.From] {
			return fmt.Errorf("spec.topology[%d].from references unknown agent: %q", i, edge.From)
		}
		if !agentNames[edge.To] {
			return fmt.Errorf("spec.topology[%d].to references unknown agent: %q", i, edge.To)
		}
		if edge.Subject == "" {
			return fmt.Errorf("spec.topology[%d].subject is required", i)
		}
	}

	// Validate dependsOn references
	for i, a := range m.Spec.Agents {
		for _, dep := range a.DependsOn {
			if !agentNames[dep] {
				return fmt.Errorf("spec.agents[%d].dependsOn references unknown agent: %q", i, dep)
			}
		}
	}

	return nil
}

func validatePolicyManifest(m *domain.PolicyManifest) error {
	if m.APIVersion != "openswarm/v1alpha1" {
		return fmt.Errorf("unsupported apiVersion: %q (expected openswarm/v1alpha1)", m.APIVersion)
	}
	if m.Kind != "AgentPolicy" {
		return fmt.Errorf("unexpected kind: %q (expected AgentPolicy)", m.Kind)
	}
	if m.Metadata.Name == "" {
		return fmt.Errorf("metadata.name is required")
	}
	return nil
}
