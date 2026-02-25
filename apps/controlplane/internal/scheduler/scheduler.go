package scheduler

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/nats-io/nats.go/jetstream"

	"github.com/openswarm/openswarm/internal/bus"
	"github.com/openswarm/openswarm/internal/domain"
	"github.com/openswarm/openswarm/internal/registry"
	"github.com/openswarm/openswarm/internal/store"
)

type Scheduler struct {
	store    *store.Store
	registry *registry.Registry
	bus      *bus.Bus
	cancel   context.CancelFunc
}

func New(st *store.Store, reg *registry.Registry, b *bus.Bus) *Scheduler {
	return &Scheduler{store: st, registry: reg, bus: b}
}

func (s *Scheduler) Start(ctx context.Context) error {
	ctx, s.cancel = context.WithCancel(ctx)
	_, err := s.bus.QueueSubscribe("TASKS", "scheduler", "swarm.*.task.submit", func(msg jetstream.Msg) {
		s.handleTask(ctx, msg)
	})
	if err != nil {
		return fmt.Errorf("scheduler: subscribe: %w", err)
	}
	slog.Info("scheduler: started, consuming swarm.*.task.submit")
	return nil
}

func (s *Scheduler) Stop() {
	if s.cancel != nil {
		s.cancel()
	}
}

func (s *Scheduler) handleTask(ctx context.Context, msg jetstream.Msg) {
	var task domain.Task
	if err := json.Unmarshal(msg.Data(), &task); err != nil {
		slog.Error("scheduler: unmarshal task", "error", err)
		_ = msg.Term()
		return
	}

	slog.Info("scheduler: received task", "id", task.ID, "swarm", task.SwarmName, "role", task.AgentRole)

	agents, err := s.registry.ListAgentsByRole(ctx, task.SwarmName, task.AgentRole)
	if err != nil {
		slog.Error("scheduler: list agents", "error", err)
		_ = msg.NakWithDelay(2 * time.Second)
		return
	}

	agent := pickAgent(agents)
	if agent == nil {
		slog.Warn("scheduler: no available agent", "swarm", task.SwarmName, "role", task.AgentRole)
		_ = msg.NakWithDelay(3 * time.Second)
		return
	}

	if err := s.store.UpdateTaskStatus(ctx, task.ID, domain.TaskStatusAssigned, agent.ID); err != nil {
		slog.Error("scheduler: update task status", "error", err)
		_ = msg.NakWithDelay(2 * time.Second)
		return
	}

	_ = s.registry.UpdateStatus(ctx, task.SwarmName, agent.ID, domain.AgentStatusBusy)

	task.AssignedAgent = agent.ID
	task.Status = domain.TaskStatusAssigned
	assignSubject := fmt.Sprintf("swarm.%s.task.assign.%s", task.SwarmName, agent.ID)
	if err := s.bus.PublishJSON(ctx, assignSubject, &task); err != nil {
		slog.Error("scheduler: publish assignment", "error", err)
		_ = msg.NakWithDelay(2 * time.Second)
		return
	}

	slog.Info("scheduler: task assigned", "task", task.ID, "agent", agent.ID)
	_ = msg.Ack()
}

func pickAgent(agents []domain.Agent) *domain.Agent {
	for i := range agents {
		if agents[i].Status == domain.AgentStatusOnline {
			return &agents[i]
		}
	}
	for i := range agents {
		if agents[i].Status == domain.AgentStatusBusy {
			return &agents[i]
		}
	}
	return nil
}
