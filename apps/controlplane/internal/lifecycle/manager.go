package lifecycle

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/openswarm/openswarm/internal/domain"
	"github.com/openswarm/openswarm/internal/pool"
	"github.com/openswarm/openswarm/internal/registry"
	"github.com/openswarm/openswarm/internal/sse"
	"github.com/openswarm/openswarm/internal/store"
)

const reconcileInterval = 5 * time.Second

// Manager reconciles desired agent state (swarm.yaml) with actual state
// (running Docker containers), like a Kubernetes controller.
type Manager struct {
	store    *store.Store
	registry *registry.Registry
	pool     *pool.Pool
	hub      *sse.Hub
	cancel   context.CancelFunc
}

// New creates a lifecycle Manager.
func New(st *store.Store, reg *registry.Registry, p *pool.Pool, hub *sse.Hub) *Manager {
	return &Manager{store: st, registry: reg, pool: p, hub: hub}
}

// Start begins the reconciliation loop.
// On startup, it terminates stale containers from a previous run and resets
// swarm status so agents are only spawned when the user explicitly applies a swarm.
func (m *Manager) Start(ctx context.Context) error {
	ctx, m.cancel = context.WithCancel(ctx)

	// Terminate stale containers from a previous control plane run
	// instead of recovering them (they may have stale config, old LLM keys, etc.).
	if err := m.pool.TerminateRecovered(ctx); err != nil {
		slog.Warn("lifecycle: terminate stale containers", "error", err)
	}

	// Reset all "running" swarms to "stopped" so they don't auto-spawn agents.
	// Users must explicitly re-apply a swarm to start its agents.
	swarms, err := m.store.ListSwarms(ctx)
	if err != nil {
		return fmt.Errorf("lifecycle: list swarms: %w", err)
	}
	for _, sw := range swarms {
		if sw.Status == domain.SwarmStatusRunning {
			slog.Info("lifecycle: resetting stale swarm to stopped", "swarm", sw.Name)
			if err := m.store.UpdateSwarmStatus(ctx, sw.Name, domain.SwarmStatusStopped); err != nil {
				slog.Error("lifecycle: reset swarm status", "swarm", sw.Name, "error", err)
			}
		}
	}

	go m.reconcileLoop(ctx)
	slog.Info("lifecycle: manager started with reconciliation loop", "interval", reconcileInterval)
	return nil
}

// Stop halts the reconciliation loop.
func (m *Manager) Stop() {
	if m.cancel != nil {
		m.cancel()
	}
}

// RegisterSwarmAgents spawns containers to match the desired state.
// Called when a new swarm is applied via `openswarm apply`.
func (m *Manager) RegisterSwarmAgents(ctx context.Context, swarmName string, spec domain.SwarmSpec) error {
	if err := m.Reconcile(ctx, swarmName, spec); err != nil {
		return fmt.Errorf("lifecycle: register swarm agents: %w", err)
	}

	if err := m.store.UpdateSwarmStatus(ctx, swarmName, domain.SwarmStatusRunning); err != nil {
		slog.Error("lifecycle: update swarm status", "swarm", swarmName, "error", err)
	}

	return nil
}

// Reconcile ensures actual running instances match desired replica counts.
func (m *Manager) Reconcile(ctx context.Context, swarmName string, spec domain.SwarmSpec) error {
	for _, agentSpec := range spec.Agents {
		desired := int(agentSpec.Replicas.Min)
		if desired < 1 {
			desired = 1
		}

		actual := m.pool.CountByRole(swarmName, agentSpec.Name)

		slog.Info("lifecycle: reconcile",
			"swarm", swarmName, "role", agentSpec.Name,
			"desired", desired, "actual", actual)

		// Scale up: spawn more instances
		for actual < desired {
			spawnCfg := pool.SpawnConfig{
				SwarmName: swarmName,
				Role:      agentSpec.Name,
				SoulMD:    agentSpec.Soul,
				Config:    agentSpec.Config,
				Tools:     agentSpec.Tools,
				Skills:    agentSpec.Skills,
				Cron:      agentSpec.Cron,
			}
			inst, err := m.pool.Spawn(ctx, spawnCfg)
			if err != nil {
				slog.Error("lifecycle: spawn failed", "role", agentSpec.Name, "error", err)
				break
			}

			// Register in Redis
			agent := domain.Agent{
				ID:           inst.ID,
				SwarmName:    swarmName,
				Role:         agentSpec.Name,
				Status:       domain.AgentStatusPending,
				Model:        agentSpec.Model,
				OpenClawAddr: inst.Addr,
				ContainerID:  inst.ContainerID,
				RegisteredAt: time.Now().UTC(),
				LastSeen:     time.Now().UTC(),
			}
			if err := m.registry.Register(ctx, agent); err != nil {
				slog.Error("lifecycle: register agent", "id", inst.ID, "error", err)
			}

			// Broadcast to dashboard
			if m.hub != nil {
				m.hub.Broadcast(swarmName, sse.Event{
					Type: "agent_spawned",
					Data: map[string]string{
						"agentId": inst.ID,
						"role":    agentSpec.Name,
						"addr":    inst.Addr,
					},
				})
			}

			actual++
			slog.Info("lifecycle: spawned instance",
				"swarm", swarmName, "role", agentSpec.Name,
				"id", inst.ID, "addr", inst.Addr)
		}

		// Scale down: terminate excess instances (LIFO)
		if actual > desired {
			excess := actual - desired
			instances := m.pool.ListByRole(swarmName, agentSpec.Name)
			for i := 0; i < excess && i < len(instances); i++ {
				inst := instances[len(instances)-1-i]
				slog.Info("lifecycle: terminating excess instance",
					"id", inst.ID, "role", agentSpec.Name)

				_ = m.registry.Deregister(ctx, swarmName, inst.ID)
				_ = m.pool.Terminate(ctx, inst.ID)

				if m.hub != nil {
					m.hub.Broadcast(swarmName, sse.Event{
						Type: "agent_terminated",
						Data: map[string]string{"agentId": inst.ID, "role": agentSpec.Name},
					})
				}
			}
		}
	}

	return nil
}

// reconcileLoop runs Reconcile every 5 seconds and performs health checks.
func (m *Manager) reconcileLoop(ctx context.Context) {
	ticker := time.NewTicker(reconcileInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			slog.Info("lifecycle: reconciliation loop stopped")
			return
		case <-ticker.C:
			m.reconcileTick(ctx)
		}
	}
}

func (m *Manager) reconcileTick(ctx context.Context) {
	swarms, err := m.store.ListSwarms(ctx)
	if err != nil {
		slog.Error("lifecycle: reconcile tick list swarms", "error", err)
		return
	}

	for _, sw := range swarms {
		if sw.Status != domain.SwarmStatusRunning {
			continue
		}

		// Health check all instances (with startup grace period)
		instances := m.pool.ListBySwarm(sw.Name)
		for _, inst := range instances {
			healthy := m.pool.HealthCheck(ctx, inst)
			if healthy {
				health := domain.AgentHealth{
					AgentID:      inst.ID,
					HealthScore:  1.0,
					QueueDepth:   0,
					ContextUsed:  0,
					CostSession:  0,
					LastReported: time.Now().UTC(),
				}
				_ = m.registry.Heartbeat(ctx, sw.Name, health)
				_ = m.registry.UpdateStatus(ctx, sw.Name, inst.ID, domain.AgentStatusOnline)
			} else {
				// Give containers 60s to start before terminating them
				age := time.Since(inst.CreatedAt)
				if age < 60*time.Second {
					slog.Debug("lifecycle: instance still starting, skipping health check",
						"id", inst.ID, "role", inst.Role, "age", age.Round(time.Second))
					continue
				}
				slog.Warn("lifecycle: instance unhealthy after grace period, replacing",
					"id", inst.ID, "role", inst.Role, "age", age.Round(time.Second))
				_ = m.registry.UpdateStatus(ctx, sw.Name, inst.ID, domain.AgentStatusError)
				_ = m.registry.Deregister(ctx, sw.Name, inst.ID)
				_ = m.pool.Terminate(ctx, inst.ID)

				if m.hub != nil {
					m.hub.Broadcast(sw.Name, sse.Event{
						Type: "agent_unhealthy",
						Data: map[string]string{"agentId": inst.ID, "role": inst.Role},
					})
				}
			}
		}

		// Reconcile to replace any terminated instances
		if err := m.Reconcile(ctx, sw.Name, sw.Spec); err != nil {
			slog.Error("lifecycle: reconcile tick", "swarm", sw.Name, "error", err)
		}
	}
}
