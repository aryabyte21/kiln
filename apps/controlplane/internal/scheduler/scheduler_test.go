package scheduler

import (
	"testing"

	"github.com/openswarm/openswarm/internal/domain"
)

func TestPickAgent_SelectsOnline(t *testing.T) {
	agents := []domain.Agent{
		{ID: "a1", Status: domain.AgentStatusOffline},
		{ID: "a2", Status: domain.AgentStatusOnline},
		{ID: "a3", Status: domain.AgentStatusError},
	}
	picked := pickAgent(agents)
	if picked == nil {
		t.Fatal("expected to pick an agent")
	}
	if picked.ID != "a2" {
		t.Errorf("expected a2, got %s", picked.ID)
	}
}

func TestPickAgent_NoneAvailable(t *testing.T) {
	agents := []domain.Agent{
		{ID: "a1", Status: domain.AgentStatusOffline},
		{ID: "a2", Status: domain.AgentStatusError},
	}
	picked := pickAgent(agents)
	if picked != nil {
		t.Errorf("expected nil, got %s", picked.ID)
	}
}

func TestPickAgent_PrefersOnlineOverBusy(t *testing.T) {
	agents := []domain.Agent{
		{ID: "a1", Status: domain.AgentStatusBusy},
		{ID: "a2", Status: domain.AgentStatusOnline},
	}
	picked := pickAgent(agents)
	if picked == nil || picked.ID != "a2" {
		t.Error("expected a2 (online preferred over busy)")
	}
}

func TestPickAgent_FallsBackToBusy(t *testing.T) {
	agents := []domain.Agent{
		{ID: "a1", Status: domain.AgentStatusOffline},
		{ID: "a2", Status: domain.AgentStatusBusy},
	}
	picked := pickAgent(agents)
	if picked == nil || picked.ID != "a2" {
		t.Error("expected a2 (busy as fallback)")
	}
}
