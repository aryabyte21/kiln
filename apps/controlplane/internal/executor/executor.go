package executor

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/nats-io/nats.go/jetstream"

	"github.com/openswarm/openswarm/internal/budget"
	"github.com/openswarm/openswarm/internal/bus"
	"github.com/openswarm/openswarm/internal/domain"
	"github.com/openswarm/openswarm/internal/pool"
	"github.com/openswarm/openswarm/internal/registry"
	"github.com/openswarm/openswarm/internal/sse"
	"github.com/openswarm/openswarm/internal/store"
)

// Config holds executor configuration.
type Config struct {
	GatewayToken string        // Bearer token for OpenClaw instances
	HTTPTimeout  time.Duration // Timeout for LLM calls (default 120s)
}

// Executor sends tasks to real OpenClaw instances via HTTP.
type Executor struct {
	store    *store.Store
	registry *registry.Registry
	pool     *pool.Pool
	bus      *bus.Bus
	budget   *budget.Tracker
	hub      *sse.Hub
	cfg      Config
	client   *http.Client
	cancel   context.CancelFunc
}

// New creates an Executor that sends real HTTP requests to OpenClaw.
func New(st *store.Store, reg *registry.Registry, p *pool.Pool, b *bus.Bus, bt *budget.Tracker, hub *sse.Hub, cfg Config) *Executor {
	if cfg.HTTPTimeout == 0 {
		cfg.HTTPTimeout = 120 * time.Second
	}
	return &Executor{
		store:    st,
		registry: reg,
		pool:     p,
		bus:      b,
		budget:   bt,
		hub:      hub,
		cfg:      cfg,
		client:   &http.Client{Timeout: cfg.HTTPTimeout},
	}
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

	slog.Info("executor: started (real OpenClaw mode)")
	return nil
}

func (e *Executor) Stop() {
	if e.cancel != nil {
		e.cancel()
	}
}

// handleAssignment receives an assigned task and executes it via a real OpenClaw instance.
func (e *Executor) handleAssignment(ctx context.Context, msg jetstream.Msg) {
	var task domain.Task
	if err := json.Unmarshal(msg.Data(), &task); err != nil {
		slog.Error("executor: unmarshal task", "error", err)
		_ = msg.Term()
		return
	}

	slog.Info("executor: executing task", "id", task.ID, "role", task.AgentRole, "agent", task.AssignedAgent)

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

	// Broadcast task running event
	e.hub.Broadcast(task.SwarmName, sse.Event{
		Type: "task_running",
		Data: map[string]string{"taskId": task.ID, "agentRole": task.AgentRole, "agentId": task.AssignedAgent},
	})

	// Find the OpenClaw instance address
	addr, err := e.resolveAgentAddr(ctx, task)
	if err != nil {
		slog.Error("executor: resolve agent addr", "error", err)
		_ = e.store.UpdateTaskResult(ctx, task.ID, "", 0, 0, 0, err.Error())
		_ = e.store.UpdateTaskStatus(ctx, task.ID, domain.TaskStatusFailed, task.AssignedAgent)
		_ = msg.Ack()
		return
	}

	// Execute REAL LLM call via OpenClaw HTTP API
	start := time.Now()
	result, err := e.callOpenClaw(ctx, addr, task.Input)
	latencyMs := time.Since(start).Milliseconds()

	if err != nil {
		slog.Error("executor: openclaw call failed", "id", task.ID, "addr", addr, "error", err)
		_ = e.store.UpdateTaskResult(ctx, task.ID, "", 0, 0, latencyMs, err.Error())
		_ = e.store.UpdateTaskStatus(ctx, task.ID, domain.TaskStatusFailed, task.AssignedAgent)

		e.hub.Broadcast(task.SwarmName, sse.Event{
			Type: "task_failed",
			Data: map[string]interface{}{
				"taskId":    task.ID,
				"agentRole": task.AgentRole,
				"error":     err.Error(),
				"latencyMs": latencyMs,
			},
		})
		_ = msg.Ack()
		return
	}

	// Record real results
	output := result.Content
	totalTokens := result.Usage.TotalTokens
	costUSD := estimateCost(result.Model, result.Usage.PromptTokens, result.Usage.CompletionTokens)

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

	// Broadcast task completion with REAL data
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
			"model":     result.Model,
		},
	})

	// Broadcast updated budget
	if budgetAfter, err := e.budget.GetBudget(ctx, task.SwarmName); err == nil {
		e.hub.Broadcast(task.SwarmName, sse.Event{
			Type: "budget_update",
			Data: budgetAfter,
		})
	}

	e.triggerDownstream(ctx, task, output)

	slog.Info("executor: task completed",
		"id", task.ID, "tokens", totalTokens, "cost", costUSD,
		"latency_ms", latencyMs, "model", result.Model)
	_ = msg.Ack()
}

// OpenClawResponse holds the parsed response from OpenClaw's /v1/chat/completions.
type OpenClawResponse struct {
	Content string
	Model   string
	Usage   struct {
		PromptTokens     int
		CompletionTokens int
		TotalTokens      int
	}
}

// callOpenClaw sends a real HTTP request to an OpenClaw instance's
// OpenAI-compatible /v1/chat/completions endpoint.
func (e *Executor) callOpenClaw(ctx context.Context, addr, input string) (*OpenClawResponse, error) {
	url := fmt.Sprintf("http://%s/v1/chat/completions", addr)

	body := map[string]interface{}{
		"model": "openclaw",
		"messages": []map[string]string{
			{"role": "user", "content": input},
		},
		"stream": false,
	}

	bodyJSON, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(bodyJSON))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if e.cfg.GatewayToken != "" {
		req.Header.Set("Authorization", "Bearer "+e.cfg.GatewayToken)
	}

	resp, err := e.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("http call to %s: %w", addr, err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("openclaw %s returned %d: %s", addr, resp.StatusCode, string(respBody))
	}

	// Parse OpenAI-compatible response
	var chatResp struct {
		ID      string `json:"id"`
		Model   string `json:"model"`
		Choices []struct {
			Message struct {
				Role    string `json:"role"`
				Content string `json:"content"`
			} `json:"message"`
			FinishReason string `json:"finish_reason"`
		} `json:"choices"`
		Usage struct {
			PromptTokens     int `json:"prompt_tokens"`
			CompletionTokens int `json:"completion_tokens"`
			TotalTokens      int `json:"total_tokens"`
		} `json:"usage"`
	}

	if err := json.Unmarshal(respBody, &chatResp); err != nil {
		return nil, fmt.Errorf("parse response: %w (body: %.200s)", err, string(respBody))
	}

	content := ""
	if len(chatResp.Choices) > 0 {
		content = chatResp.Choices[0].Message.Content
	}

	return &OpenClawResponse{
		Content: content,
		Model:   chatResp.Model,
		Usage: struct {
			PromptTokens     int
			CompletionTokens int
			TotalTokens      int
		}{
			PromptTokens:     chatResp.Usage.PromptTokens,
			CompletionTokens: chatResp.Usage.CompletionTokens,
			TotalTokens:      chatResp.Usage.TotalTokens,
		},
	}, nil
}

// resolveAgentAddr finds the OpenClaw instance address for the assigned agent.
func (e *Executor) resolveAgentAddr(ctx context.Context, task domain.Task) (string, error) {
	// Try the registry first (has OpenClawAddr from when container was spawned)
	if task.AssignedAgent != "" {
		agent, err := e.registry.GetAgent(ctx, task.SwarmName, task.AssignedAgent)
		if err == nil && agent.OpenClawAddr != "" {
			return agent.OpenClawAddr, nil
		}
	}

	// Fallback: pick any available instance for this role from the pool
	instances := e.pool.ListByRole(task.SwarmName, task.AgentRole)
	if len(instances) == 0 {
		return "", fmt.Errorf("no instances available for role %s in swarm %s", task.AgentRole, task.SwarmName)
	}
	return instances[0].Addr, nil
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

// estimateCost calculates approximate cost based on model and token usage.
// For local Ollama models, cost is effectively $0 but we track nominal cost for metrics.
func estimateCost(model string, inputTokens, outputTokens int) float64 {
	// Nominal rate: $0.001 per 1K tokens (for tracking purposes with local models)
	return float64(inputTokens+outputTokens) * 0.001 / 1000.0
}
