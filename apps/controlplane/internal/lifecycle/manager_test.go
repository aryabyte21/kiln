package lifecycle

import (
	"testing"

	"github.com/openswarm/openswarm/internal/domain"
)

func TestGenerateAgentID(t *testing.T) {
	id := generateAgentID("hello-swarm", "researcher", 0)
	if id == "" {
		t.Fatal("expected non-empty agent ID")
	}
	id2 := generateAgentID("hello-swarm", "researcher", 0)
	if id != id2 {
		t.Error("expected deterministic IDs for same inputs")
	}
	id3 := generateAgentID("hello-swarm", "researcher", 1)
	if id == id3 {
		t.Error("expected different IDs for different indexes")
	}
}

func TestBuildAgentsFromSpec(t *testing.T) {
	spec := domain.SwarmSpec{
		Agents: []domain.AgentSpec{
			{Name: "researcher", Replicas: domain.ReplicaSpec{Min: 2, Max: 5}, Model: "claude-sonnet-4-6"},
			{Name: "writer", Replicas: domain.ReplicaSpec{Min: 1, Max: 2}, Model: "claude-sonnet-4-6"},
		},
	}
	agents := buildAgentsFromSpec("test-swarm", spec)
	if len(agents) != 3 {
		t.Fatalf("expected 3 agents (2+1), got %d", len(agents))
	}
	researchers, writers := 0, 0
	for _, a := range agents {
		switch a.Role {
		case "researcher":
			researchers++
		case "writer":
			writers++
		}
		if a.Status != domain.AgentStatusOnline {
			t.Errorf("expected online, got %s", a.Status)
		}
		if a.SwarmName != "test-swarm" {
			t.Errorf("expected test-swarm, got %s", a.SwarmName)
		}
	}
	if researchers != 2 {
		t.Errorf("expected 2 researchers, got %d", researchers)
	}
	if writers != 1 {
		t.Errorf("expected 1 writer, got %d", writers)
	}
}
