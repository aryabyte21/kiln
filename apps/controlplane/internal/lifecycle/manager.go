package lifecycle

import (
	"context"
	"crypto/sha256"
	"fmt"
	"log/slog"
	"time"

	"github.com/openswarm/openswarm/internal/domain"
	"github.com/openswarm/openswarm/internal/registry"
	"github.com/openswarm/openswarm/internal/store"
)

const heartbeatInterval = 10 * time.Second

type Manager struct {
	store    *store.Store
	registry *registry.Registry
	cancel   context.CancelFunc
}

func New(st *store.Store, reg *registry.Registry) *Manager {
	return &Manager{store: st, registry: reg}
}

func (m *Manager) Start(ctx context.Context) error {
	ctx, m.cancel = context.WithCancel(ctx)

	swarms, err := m.store.ListSwarms(ctx)
	if err != nil {
		return fmt.Errorf("lifecycle: list swarms: %w", err)
	}

	for _, sw := range swarms {
		if err := m.RegisterSwarmAgents(ctx, sw.Name, sw.Spec); err != nil {
			slog.Error("lifecycle: register agents failed", "swarm", sw.Name, "error", err)
		}
	}

	go m.heartbeatLoop(ctx)
	slog.Info("lifecycle: manager started")
	return nil
}

func (m *Manager) Stop() {
	if m.cancel != nil {
		m.cancel()
	}
}

func (m *Manager) RegisterSwarmAgents(ctx context.Context, swarmName string, spec domain.SwarmSpec) error {
	agents := buildAgentsFromSpec(swarmName, spec)

	for _, agent := range agents {
		if err := m.registry.Register(ctx, agent); err != nil {
			return fmt.Errorf("lifecycle: register %s/%s: %w", swarmName, agent.Role, err)
		}
		health := domain.AgentHealth{
			AgentID:      agent.ID,
			HealthScore:  1.0,
			QueueDepth:   0,
			ContextUsed:  0,
			CostSession:  0,
			LastReported: time.Now().UTC(),
		}
		if err := m.registry.Heartbeat(ctx, swarmName, health); err != nil {
			slog.Error("lifecycle: initial heartbeat failed", "agent", agent.ID, "error", err)
		}
	}

	if err := m.store.UpdateSwarmStatus(ctx, swarmName, domain.SwarmStatusRunning); err != nil {
		slog.Error("lifecycle: update swarm status failed", "swarm", swarmName, "error", err)
	}

	slog.Info("lifecycle: agents registered", "swarm", swarmName, "count", len(agents))
	return nil
}

func (m *Manager) heartbeatLoop(ctx context.Context) {
	ticker := time.NewTicker(heartbeatInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			slog.Info("lifecycle: heartbeat loop stopped")
			return
		case <-ticker.C:
			m.sendHeartbeats(ctx)
		}
	}
}

func (m *Manager) sendHeartbeats(ctx context.Context) {
	swarms, err := m.store.ListSwarms(ctx)
	if err != nil {
		slog.Error("lifecycle: heartbeat list swarms", "error", err)
		return
	}

	for _, sw := range swarms {
		if sw.Status != domain.SwarmStatusRunning {
			continue
		}
		agents, err := m.registry.ListAgentsBySwarm(ctx, sw.Name)
		if err != nil {
			slog.Error("lifecycle: heartbeat list agents", "swarm", sw.Name, "error", err)
			continue
		}
		for _, agent := range agents {
			health := domain.AgentHealth{
				AgentID:      agent.ID,
				HealthScore:  1.0,
				QueueDepth:   0,
				ContextUsed:  0,
				CostSession:  0,
				LastReported: time.Now().UTC(),
			}
			if err := m.registry.Heartbeat(ctx, sw.Name, health); err != nil {
				slog.Error("lifecycle: heartbeat failed", "agent", agent.ID, "error", err)
			}
		}
	}
}

func buildAgentsFromSpec(swarmName string, spec domain.SwarmSpec) []domain.Agent {
	var agents []domain.Agent
	now := time.Now().UTC()

	for _, agentSpec := range spec.Agents {
		count := int(agentSpec.Replicas.Min)
		if count < 1 {
			count = 1
		}
		for i := 0; i < count; i++ {
			agents = append(agents, domain.Agent{
				ID:           generateAgentID(swarmName, agentSpec.Name, i),
				SwarmName:    swarmName,
				Role:         agentSpec.Name,
				Status:       domain.AgentStatusOnline,
				Model:        agentSpec.Model,
				OpenClawAddr: fmt.Sprintf("sim://%s-%s-%d", swarmName, agentSpec.Name, i),
				RegisteredAt: now,
				LastSeen:     now,
			})
		}
	}
	return agents
}

func generateAgentID(swarm, role string, index int) string {
	h := sha256.Sum256([]byte(fmt.Sprintf("%s/%s/%d", swarm, role, index)))
	return fmt.Sprintf("%x", h[:16])
}
