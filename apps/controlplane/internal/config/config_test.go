package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestParseSwarmManifest(t *testing.T) {
	yaml := []byte(`
apiVersion: openswarm/v1alpha1
kind: Swarm
metadata:
  name: test-swarm
  labels:
    env: test
spec:
  budget:
    total: "$1.00"
    perTask: "$0.05"
    alertAt: 80
    hardStop: 100
  agents:
    - name: researcher
      replicas: { min: 1, max: 3 }
      model: claude-haiku-4-5-20251001
      skills: [web-browse]
      policy: default
    - name: writer
      replicas: { min: 1, max: 1 }
      model: claude-sonnet-4-6
      dependsOn: [researcher]
  topology:
    - from: researcher
      to: writer
      subject: research.results
`)

	m, err := ParseSwarmManifest(yaml)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if m.Metadata.Name != "test-swarm" {
		t.Errorf("name = %q, want %q", m.Metadata.Name, "test-swarm")
	}
	if len(m.Spec.Agents) != 2 {
		t.Errorf("agents count = %d, want 2", len(m.Spec.Agents))
	}
	if m.Spec.Agents[0].Name != "researcher" {
		t.Errorf("agent[0].name = %q, want %q", m.Spec.Agents[0].Name, "researcher")
	}
	if m.Spec.Agents[0].Replicas.Max != 3 {
		t.Errorf("agent[0].replicas.max = %d, want 3", m.Spec.Agents[0].Replicas.Max)
	}
	if len(m.Spec.Topology) != 1 {
		t.Errorf("topology count = %d, want 1", len(m.Spec.Topology))
	}
	if m.Spec.Budget.Total != "$1.00" {
		t.Errorf("budget.total = %q, want %q", m.Spec.Budget.Total, "$1.00")
	}
}

func TestParseSwarmManifest_ValidationErrors(t *testing.T) {
	tests := []struct {
		name string
		yaml string
		want string
	}{
		{
			name: "wrong apiVersion",
			yaml: `apiVersion: v1
kind: Swarm
metadata:
  name: test
spec:
  agents:
    - name: a
      replicas: {min: 1, max: 1}
      model: haiku`,
			want: "unsupported apiVersion",
		},
		{
			name: "wrong kind",
			yaml: `apiVersion: openswarm/v1alpha1
kind: Deployment
metadata:
  name: test
spec:
  agents:
    - name: a
      replicas: {min: 1, max: 1}
      model: haiku`,
			want: "unexpected kind",
		},
		{
			name: "missing name",
			yaml: `apiVersion: openswarm/v1alpha1
kind: Swarm
metadata:
  name: ""
spec:
  agents:
    - name: a
      replicas: {min: 1, max: 1}
      model: haiku`,
			want: "metadata.name is required",
		},
		{
			name: "no agents",
			yaml: `apiVersion: openswarm/v1alpha1
kind: Swarm
metadata:
  name: test
spec:
  agents: []`,
			want: "at least one agent",
		},
		{
			name: "duplicate agent name",
			yaml: `apiVersion: openswarm/v1alpha1
kind: Swarm
metadata:
  name: test
spec:
  agents:
    - name: worker
      replicas: {min: 1, max: 1}
      model: haiku
    - name: worker
      replicas: {min: 1, max: 1}
      model: haiku`,
			want: "duplicate agent name",
		},
		{
			name: "topology references unknown agent",
			yaml: `apiVersion: openswarm/v1alpha1
kind: Swarm
metadata:
  name: test
spec:
  agents:
    - name: a
      replicas: {min: 1, max: 1}
      model: haiku
  topology:
    - from: a
      to: unknown
      subject: test`,
			want: "unknown agent",
		},
		{
			name: "max < min replicas",
			yaml: `apiVersion: openswarm/v1alpha1
kind: Swarm
metadata:
  name: test
spec:
  agents:
    - name: a
      replicas: {min: 5, max: 1}
      model: haiku`,
			want: "max must be >= min",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := ParseSwarmManifest([]byte(tt.yaml))
			if err == nil {
				t.Fatal("expected error, got nil")
			}
			if got := err.Error(); !contains(got, tt.want) {
				t.Errorf("error = %q, want to contain %q", got, tt.want)
			}
		})
	}
}

func TestParsePolicyManifest(t *testing.T) {
	yaml := []byte(`
apiVersion: openswarm/v1alpha1
kind: AgentPolicy
metadata:
  name: default
spec:
  tools:
    allowed: [web-browse, read-file]
    denied: [execute-shell]
  budget:
    maxTokensPerTask: 8000
    maxCostPerTask: "$0.10"
  safety:
    blastRadius: contained
  failure:
    maxRetries: 2
    onBankruptcy: restart
`)

	m, err := ParsePolicyManifest(yaml)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if m.Metadata.Name != "default" {
		t.Errorf("name = %q, want %q", m.Metadata.Name, "default")
	}
	if len(m.Spec.Tools.Allowed) != 2 {
		t.Errorf("tools.allowed count = %d, want 2", len(m.Spec.Tools.Allowed))
	}
	if m.Spec.Failure.MaxRetries != 2 {
		t.Errorf("failure.maxRetries = %d, want 2", m.Spec.Failure.MaxRetries)
	}
}

func TestExampleYAMLs(t *testing.T) {
	root := filepath.Join("..", "..", "..", "..", "examples")
	examples := []struct {
		dir       string
		name      string
		agentCnt  int
		hasDefaults bool
	}{
		{"hello-swarm", "hello-swarm", 2, true},
		{"customer-support", "customer-support", 3, true},
	}

	for _, ex := range examples {
		t.Run(ex.dir, func(t *testing.T) {
			data, err := os.ReadFile(filepath.Join(root, ex.dir, "swarm.yaml"))
			if err != nil {
				t.Fatalf("read: %v", err)
			}
			m, err := ParseSwarmManifest(data)
			if err != nil {
				t.Fatalf("parse: %v", err)
			}
			if m.Metadata.Name != ex.name {
				t.Errorf("name = %q, want %q", m.Metadata.Name, ex.name)
			}
			if len(m.Spec.Agents) != ex.agentCnt {
				t.Errorf("agents = %d, want %d", len(m.Spec.Agents), ex.agentCnt)
			}
			if ex.hasDefaults && m.Spec.Defaults == nil {
				t.Error("expected defaults, got nil")
			}

			// Verify resolve works without panic
			resolved := ResolveAllAgents(m.Spec)
			if len(resolved) != ex.agentCnt {
				t.Errorf("resolved agents = %d, want %d", len(resolved), ex.agentCnt)
			}
			// All resolved agents must have a model
			for _, a := range resolved {
				if a.Model == "" {
					t.Errorf("agent %q has empty model after resolve", a.Name)
				}
			}
		})
	}
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && searchString(s, substr)
}

func searchString(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
