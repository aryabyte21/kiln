package executor

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"math/rand"
	"strings"
	"time"

	"github.com/nats-io/nats.go/jetstream"

	"github.com/openswarm/openswarm/internal/budget"
	"github.com/openswarm/openswarm/internal/bus"
	"github.com/openswarm/openswarm/internal/domain"
	"github.com/openswarm/openswarm/internal/registry"
	"github.com/openswarm/openswarm/internal/sse"
	"github.com/openswarm/openswarm/internal/store"
)

type Executor struct {
	store    *store.Store
	registry *registry.Registry
	bus      *bus.Bus
	budget   *budget.Tracker
	hub      *sse.Hub
	cancel   context.CancelFunc
}

func New(st *store.Store, reg *registry.Registry, b *bus.Bus, bt *budget.Tracker, hub *sse.Hub) *Executor {
	return &Executor{store: st, registry: reg, bus: b, budget: bt, hub: hub}
}

func (e *Executor) Start(ctx context.Context) error {
	ctx, e.cancel = context.WithCancel(ctx)

	_, err := e.bus.QueueSubscribe("TASKS", "executor", "swarm.*.task.assign.>", func(msg jetstream.Msg) {
		e.handleAssignment(ctx, msg)
	})
	if err != nil {
		return fmt.Errorf("executor: subscribe assignments: %w", err)
	}

	_, err = e.bus.QueueSubscribe("PIPELINE", "executor", "swarm.*.pipeline.>", func(msg jetstream.Msg) {
		e.handlePipeline(ctx, msg)
	})
	if err != nil {
		return fmt.Errorf("executor: subscribe pipeline: %w", err)
	}

	slog.Info("executor: started")
	return nil
}

func (e *Executor) Stop() {
	if e.cancel != nil {
		e.cancel()
	}
}

func (e *Executor) handleAssignment(ctx context.Context, msg jetstream.Msg) {
	var task domain.Task
	if err := json.Unmarshal(msg.Data(), &task); err != nil {
		slog.Error("executor: unmarshal task", "error", err)
		_ = msg.Term()
		return
	}

	slog.Info("executor: executing task", "id", task.ID, "role", task.AgentRole)

	// Check budget
	budgetState, err := e.budget.GetBudget(ctx, task.SwarmName)
	if err != nil {
		slog.Error("executor: get budget", "error", err)
	}
	if budgetState != nil && budgetState.IsBankrupt() {
		slog.Warn("executor: budget bankrupt", "swarm", task.SwarmName)
		_ = e.store.UpdateTaskStatus(ctx, task.ID, domain.TaskStatusBankrupt, "")
		_ = msg.Ack()
		return
	}

	_ = e.store.UpdateTaskStatus(ctx, task.ID, domain.TaskStatusRunning, task.AssignedAgent)

	// Broadcast task running event to dashboard
	e.hub.Broadcast(task.SwarmName, sse.Event{
		Type: "task_running",
		Data: map[string]string{"taskId": task.ID, "agentRole": task.AgentRole, "agentId": task.AssignedAgent},
	})

	// Simulate LLM execution
	delay := time.Duration(200+rand.Intn(600)) * time.Millisecond
	time.Sleep(delay)

	output := generateMockOutput(task.AgentRole, task.Input)
	inputTokens, outputTokens := estimateTokens(task.Input, output)
	totalTokens := inputTokens + outputTokens

	agent, _ := e.registry.GetAgent(ctx, task.SwarmName, task.AssignedAgent)
	model := "claude-sonnet-4-6"
	if agent != nil {
		model = agent.Model
	}
	costUSD := calculateCost(model, inputTokens, outputTokens)
	latencyMs := delay.Milliseconds()

	if err := e.store.UpdateTaskResult(ctx, task.ID, output, totalTokens, costUSD, latencyMs, ""); err != nil {
		slog.Error("executor: update result", "error", err)
	}
	_ = e.store.UpdateTaskStatus(ctx, task.ID, domain.TaskStatusCompleted, task.AssignedAgent)

	if _, err := e.budget.RecordCost(ctx, task.SwarmName, costUSD); err != nil {
		slog.Error("executor: record cost", "error", err)
		_ = msg.NakWithDelay(2 * time.Second)
		return
	}

	if task.AssignedAgent != "" {
		if err := e.registry.UpdateStatus(ctx, task.SwarmName, task.AssignedAgent, domain.AgentStatusOnline); err != nil {
			slog.Error("executor: reset agent status", "error", err, "agent", task.AssignedAgent)
		}
	}

	// Broadcast task completion to dashboard
	e.hub.Broadcast(task.SwarmName, sse.Event{
		Type: "task_completed",
		Data: map[string]interface{}{
			"taskId":    task.ID,
			"agentRole": task.AgentRole,
			"agentId":   task.AssignedAgent,
			"tokens":    totalTokens,
			"costUsd":   costUSD,
			"latencyMs": latencyMs,
			"output":    output,
		},
	})

	// Broadcast updated budget to dashboard
	if budgetAfter, err := e.budget.GetBudget(ctx, task.SwarmName); err == nil {
		e.hub.Broadcast(task.SwarmName, sse.Event{
			Type: "budget_update",
			Data: budgetAfter,
		})
	}

	e.triggerDownstream(ctx, task, output)

	slog.Info("executor: task completed", "id", task.ID, "tokens", totalTokens, "cost", costUSD, "latency_ms", latencyMs)
	_ = msg.Ack()
}

func (e *Executor) handlePipeline(ctx context.Context, msg jetstream.Msg) {
	var pipelineMsg struct {
		SwarmName  string `json:"swarmName"`
		FromRole   string `json:"fromRole"`
		ToRole     string `json:"toRole"`
		Input      string `json:"input"`
		OrigTaskID string `json:"origTaskId"`
	}
	if err := json.Unmarshal(msg.Data(), &pipelineMsg); err != nil {
		slog.Error("executor: unmarshal pipeline msg", "error", err)
		_ = msg.Term()
		return
	}

	slog.Info("executor: pipeline message", "from", pipelineMsg.FromRole, "to", pipelineMsg.ToRole)

	task := &domain.Task{
		SwarmName: pipelineMsg.SwarmName,
		AgentRole: pipelineMsg.ToRole,
		Input:     pipelineMsg.Input,
		Status:    domain.TaskStatusPending,
		Metadata:  map[string]string{"upstream": pipelineMsg.FromRole, "origTask": pipelineMsg.OrigTaskID},
	}

	if err := e.store.CreateTask(ctx, task); err != nil {
		slog.Error("executor: create pipeline task", "error", err)
		_ = msg.NakWithDelay(2 * time.Second)
		return
	}

	subject := fmt.Sprintf("swarm.%s.task.submit", pipelineMsg.SwarmName)
	if err := e.bus.PublishJSON(ctx, subject, task); err != nil {
		slog.Error("executor: publish pipeline task", "error", err)
	}

	_ = msg.Ack()
}

func (e *Executor) triggerDownstream(ctx context.Context, task domain.Task, output string) {
	sw, err := e.store.GetSwarmByName(ctx, task.SwarmName)
	if err != nil {
		return
	}
	for _, edge := range sw.Spec.Topology {
		if edge.From == task.AgentRole {
			pipelineMsg := map[string]string{
				"swarmName":  task.SwarmName,
				"fromRole":   task.AgentRole,
				"toRole":     edge.To,
				"input":      output,
				"origTaskId": task.ID,
			}
			subject := fmt.Sprintf("swarm.%s.pipeline.%s", task.SwarmName, edge.Subject)
			if err := e.bus.PublishJSON(ctx, subject, pipelineMsg); err != nil {
				slog.Error("executor: publish pipeline", "subject", subject, "error", err)
			} else {
				slog.Info("executor: triggered downstream", "from", task.AgentRole, "to", edge.To)
			}
		}
	}
}

func generateMockOutput(role, input string) string {
	templates := map[string]string{
		"researcher": "Based on analysis by %s agent: Research on '%s' reveals several key findings. Multiple sources confirm significant developments. Key data points extracted and cross-referenced.",
		"writer":     "Article drafted by %s agent: Drawing from research, here is a comprehensive summary of '%s'. Findings indicate notable progress with implications for multiple stakeholders.",
		"summarizer": "Summary by %s agent: Key points regarding '%s': (1) significant recent developments, (2) measurable impact across sectors, (3) ongoing challenges requiring attention.",
		"classifier": "Classification by %s agent: Content '%s' categorized. Primary: Technology/Science. Sentiment: Positive. Relevance: 0.87.",
		"fetcher":    "Fetched by %s agent: Retrieved content for '%s'. Sources: 3 articles, 2 papers, 1 dataset. ~4,500 words.",
		"aggregator": "Aggregated by %s agent: Combined analysis of '%s'. Synthesized from 5 sources into unified report.",
		"notifier":   "Notification by %s agent: Alert prepared for '%s'. Priority: normal. Delivery: immediate.",
	}
	tmpl, ok := templates[role]
	if !ok {
		tmpl = "Processed by %s agent: Task '%s' completed successfully."
	}
	short := input
	if len(short) > 80 {
		short = short[:80] + "..."
	}
	return fmt.Sprintf(tmpl, role, short)
}

func estimateTokens(input, output string) (int, int) {
	return len(input)/4 + 10, len(output)/4 + 10
}

func calculateCost(model string, inputTokens, outputTokens int) float64 {
	type pricing struct{ input, output float64 }
	prices := map[string]pricing{
		"sonnet": {3.0, 15.0},
		"haiku":  {0.25, 1.25},
		"opus":   {15.0, 75.0},
	}
	p := pricing{3.0, 15.0}
	for key, pr := range prices {
		if strings.Contains(model, key) {
			p = pr
			break
		}
	}
	return (float64(inputTokens) * p.input / 1_000_000) + (float64(outputTokens) * p.output / 1_000_000)
}
