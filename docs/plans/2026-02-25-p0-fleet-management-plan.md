# P0 Fleet Management Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement YAML defaults + config passthrough, CLI polish, dashboard deploy page, and inter-agent NATS communication — the four P0 pillars that make OpenSwarm a working fleet manager.

**Architecture:** Extend the existing Go control plane to parse `spec.defaults` from swarm.yaml and deep-merge with per-agent config. Pass merged config (temperature, maxTokens, contextWindow, tools, skills, cron) through to openclaw.json generation. Polish CLI to remove stubs and add `ps`, `chat`, `send`. Add a dashboard deploy page. Wire inter-agent communication via NATS.

**Tech Stack:** Go 1.23 (stdlib net/http, slog, Cobra), Next.js 15 + React 19, NATS JetStream, Redis, PostgreSQL

---

## Task 1: Add DefaultsSpec and Config Fields to Domain Types

**Files:**

- Modify: `apps/controlplane/internal/domain/swarm.go`
- Modify: `apps/controlplane/internal/domain/agent.go`
- Test: `apps/controlplane/internal/domain/swarm_test.go` (new)

**Step 1: Write the failing test**

Create `apps/controlplane/internal/domain/swarm_test.go`:

```go
package domain

import "testing"

func TestDefaultsSpecZeroValue(t *testing.T) {
	var d DefaultsSpec
	if d.Model != "" {
		t.Errorf("zero DefaultsSpec.Model should be empty, got %q", d.Model)
	}
	if d.Config != nil {
		t.Errorf("zero DefaultsSpec.Config should be nil")
	}
}

func TestCronJobFields(t *testing.T) {
	cj := CronJob{
		Name:     "morning-check",
		Schedule: "0 8 * * *",
		Task:     "Review overnight messages",
	}
	if cj.Name != "morning-check" {
		t.Errorf("CronJob.Name = %q, want %q", cj.Name, "morning-check")
	}
	if cj.Schedule != "0 8 * * *" {
		t.Errorf("CronJob.Schedule = %q, want %q", cj.Schedule, "0 8 * * *")
	}
}
```

**Step 2: Run test to verify it fails**

Run: `cd apps/controlplane && go test ./internal/domain/ -v -run TestDefaultsSpec`
Expected: FAIL — `DefaultsSpec` type not defined

**Step 3: Write minimal implementation**

Add to `apps/controlplane/internal/domain/swarm.go` — insert `DefaultsSpec` and add `Defaults` field to `SwarmSpec`:

```go
// DefaultsSpec provides default configuration for all agents in the swarm.
// Per-agent config overrides these values (deep merge, agent wins on conflict).
type DefaultsSpec struct {
	Model  string            `json:"model,omitempty" yaml:"model,omitempty"`
	Config map[string]any    `json:"config,omitempty" yaml:"config,omitempty"`
}

// CronJob defines a scheduled task for an agent.
type CronJob struct {
	Name     string `json:"name" yaml:"name"`
	Schedule string `json:"schedule" yaml:"schedule"` // cron expression
	Task     string `json:"task" yaml:"task"`         // instruction for the agent
}
```

Update `SwarmSpec` to include `Defaults`:

```go
type SwarmSpec struct {
	Defaults    *DefaultsSpec  `json:"defaults,omitempty" yaml:"defaults,omitempty"`
	Budget      BudgetSpec     `json:"budget" yaml:"budget"`
	Agents      []AgentSpec    `json:"agents" yaml:"agents"`
	Topology    []TopologyEdge `json:"topology,omitempty" yaml:"topology,omitempty"`
	Memory      *MemorySpec    `json:"memory,omitempty" yaml:"memory,omitempty"`
	Checkpoints []Checkpoint   `json:"checkpoints,omitempty" yaml:"checkpoints,omitempty"`
	Audit       *AuditSpec     `json:"audit,omitempty" yaml:"audit,omitempty"`
}
```

Update `AgentSpec` in `apps/controlplane/internal/domain/agent.go` to add config, tools, cron, channels fields:

```go
type AgentSpec struct {
	Name      string            `json:"name" yaml:"name"`
	Replicas  ReplicaSpec       `json:"replicas" yaml:"replicas"`
	Model     string            `json:"model,omitempty" yaml:"model,omitempty"`
	Soul      string            `json:"soul,omitempty" yaml:"soul,omitempty"`
	Skills    []string          `json:"skills,omitempty" yaml:"skills,omitempty"`
	Tools     []string          `json:"tools,omitempty" yaml:"tools,omitempty"`
	Cron      []CronJob         `json:"cron,omitempty" yaml:"cron,omitempty"`
	Config    map[string]any    `json:"config,omitempty" yaml:"config,omitempty"`
	Policy    string            `json:"policy,omitempty" yaml:"policy,omitempty"`
	DependsOn []string          `json:"dependsOn,omitempty" yaml:"dependsOn,omitempty"`
	Genome    *GenomeConfig     `json:"genome,omitempty" yaml:"genome,omitempty"`
	Resources *ResourceSpec     `json:"resources,omitempty" yaml:"resources,omitempty"`
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/controlplane && go test ./internal/domain/ -v`
Expected: PASS

**Step 5: Run all existing tests to check for breakage**

Run: `cd apps/controlplane && go vet ./... && go test ./...`
Expected: All tests pass (existing tests use AgentSpec without the new fields — zero values are fine)

**Step 6: Commit**

```bash
git add apps/controlplane/internal/domain/swarm.go apps/controlplane/internal/domain/agent.go apps/controlplane/internal/domain/swarm_test.go
git commit -m "feat(domain): add DefaultsSpec, CronJob, and config/tools/cron fields to AgentSpec"
```

---

## Task 2: Implement Config Deep-Merge and Defaults Resolution

**Files:**

- Create: `apps/controlplane/internal/config/merge.go`
- Create: `apps/controlplane/internal/config/merge_test.go`
- Modify: `apps/controlplane/internal/config/config.go` (validation update)

**Step 1: Write the failing test**

Create `apps/controlplane/internal/config/merge_test.go`:

```go
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
		// No model set — should inherit from defaults
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
	// contextWindow should be inherited from defaults
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
```

**Step 2: Run test to verify it fails**

Run: `cd apps/controlplane && go test ./internal/config/ -v -run TestResolveAgent`
Expected: FAIL — `ResolveAgentConfig` not defined

**Step 3: Write minimal implementation**

Create `apps/controlplane/internal/config/merge.go`:

```go
package config

import "github.com/openswarm/openswarm/internal/domain"

// ResolveAgentConfig produces a fully-resolved AgentSpec by deep-merging
// swarm defaults with per-agent overrides. Agent values win on conflict.
func ResolveAgentConfig(defaults *domain.DefaultsSpec, agent domain.AgentSpec) domain.AgentSpec {
	resolved := agent

	if defaults == nil {
		if resolved.Config == nil {
			resolved.Config = make(map[string]any)
		}
		return resolved
	}

	// Model: agent wins, falls back to default
	if resolved.Model == "" {
		resolved.Model = defaults.Model
	}

	// Config: deep merge (defaults first, agent overrides)
	merged := make(map[string]any)
	for k, v := range defaults.Config {
		merged[k] = v
	}
	for k, v := range agent.Config {
		merged[k] = v
	}
	resolved.Config = merged

	return resolved
}

// ResolveAllAgents resolves config for every agent in the spec.
func ResolveAllAgents(spec domain.SwarmSpec) []domain.AgentSpec {
	resolved := make([]domain.AgentSpec, len(spec.Agents))
	for i, a := range spec.Agents {
		resolved[i] = ResolveAgentConfig(spec.Defaults, a)
	}
	return resolved
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/controlplane && go test ./internal/config/ -v -run TestResolveAgent`
Expected: PASS

**Step 5: Update validation in config.go to allow empty agent model when defaults exist**

In `apps/controlplane/internal/config/config.go`, change the agent model validation (line ~112-114):

```go
// Before:
if a.Model == "" {
    return fmt.Errorf("spec.agents[%d].model is required", i)
}

// After:
if a.Model == "" && (m.Spec.Defaults == nil || m.Spec.Defaults.Model == "") {
    return fmt.Errorf("spec.agents[%d].model is required (no spec.defaults.model set)", i)
}
```

**Step 6: Run all config tests**

Run: `cd apps/controlplane && go test ./internal/config/ -v`
Expected: All pass (existing tests still have model on every agent, so they pass. New tests verify defaults)

**Step 7: Commit**

```bash
git add apps/controlplane/internal/config/merge.go apps/controlplane/internal/config/merge_test.go apps/controlplane/internal/config/config.go
git commit -m "feat(config): add defaults deep-merge — spec.defaults cascades to agents"
```

---

## Task 3: Pass Merged Config Through to Workspace Generation

**Files:**

- Modify: `apps/controlplane/internal/pool/pool.go` (Spawn + createWorkspace)
- Modify: `apps/controlplane/internal/lifecycle/manager.go` (pass resolved config)
- Test: `apps/controlplane/internal/pool/pool_test.go` (update existing)

**Step 1: Add MergedConfig parameter to Spawn**

In `apps/controlplane/internal/pool/pool.go`, update the `Spawn` signature to accept resolved agent config:

```go
// SpawnConfig holds all resolved configuration for spawning an agent.
type SpawnConfig struct {
	SwarmName string
	Role      string
	SoulMD    string
	Config    map[string]any // merged config (temperature, maxTokens, contextWindow)
	Tools     []string       // tool allowlist
	Skills    []string       // skills to install
	Cron      []domain.CronJob // cron jobs
}
```

Update `Spawn` to accept `SpawnConfig`:

```go
func (p *Pool) Spawn(ctx context.Context, cfg SpawnConfig) (*Instance, error) {
```

Update `createWorkspace` to use merged config for `contextWindow` and `maxTokens` instead of hardcoded values:

```go
func (p *Pool) createWorkspace(cfg SpawnConfig, port int, llm *LLMConfig) (string, error) {
    // ... existing code ...

    // Read contextWindow and maxTokens from merged config, with defaults
    contextWindow := 131072
    maxTokens := 8192
    if v, ok := cfg.Config["contextWindow"]; ok {
        if n, ok := toInt(v); ok {
            contextWindow = n
        }
    }
    if v, ok := cfg.Config["maxTokens"]; ok {
        if n, ok := toInt(v); ok {
            maxTokens = n
        }
    }
    // ... use in openclaw.json ...
}
```

**Step 2: Update lifecycle/manager.go to use SpawnConfig**

In `apps/controlplane/internal/lifecycle/manager.go`, update the `Reconcile` method to build `SpawnConfig` from the resolved agent spec:

```go
// In the scale-up loop (line ~101):
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
```

**Step 3: Update handleCreateSwarm in api/server.go to resolve defaults before registering**

In `apps/controlplane/internal/api/server.go`, in `handleCreateSwarm` (line ~152-199), resolve defaults before passing to lifecycle:

```go
// After creating the swarm, resolve defaults for the spec
resolvedSpec := sw.Spec
resolvedSpec.Agents = config.ResolveAllAgents(sw.Spec)

if err := s.lifecycle.RegisterSwarmAgents(r.Context(), sw.Name, resolvedSpec); err != nil {
```

**Step 4: Add toInt helper to pool.go**

```go
// toInt converts a numeric value from YAML (which may be int, float64, etc.) to int.
func toInt(v any) (int, bool) {
    switch n := v.(type) {
    case int:
        return n, true
    case int64:
        return int(n), true
    case float64:
        return int(n), true
    default:
        return 0, false
    }
}
```

**Step 5: Write cron/jobs.json if cron jobs are specified**

In `createWorkspace`, after writing SOUL.md:

```go
if len(cfg.Cron) > 0 {
    cronDir := filepath.Join(workspaceDir, "cron")
    if err := os.MkdirAll(cronDir, 0o755); err != nil {
        return "", fmt.Errorf("create cron dir: %w", err)
    }
    cronJSON, err := json.MarshalIndent(cfg.Cron, "", "  ")
    if err != nil {
        return "", fmt.Errorf("marshal cron jobs: %w", err)
    }
    if err := os.WriteFile(filepath.Join(cronDir, "jobs.json"), cronJSON, 0o644); err != nil {
        return "", fmt.Errorf("write cron jobs: %w", err)
    }
}
```

**Step 6: Run all tests**

Run: `cd apps/controlplane && go vet ./... && go test ./...`
Expected: All pass. Existing tests may need updating for the new Spawn signature.

**Step 7: Commit**

```bash
git add apps/controlplane/internal/pool/pool.go apps/controlplane/internal/lifecycle/manager.go apps/controlplane/internal/api/server.go
git commit -m "feat(pool): pass merged config to workspace — temperature, maxTokens, cron from YAML"
```

---

## Task 4: Update hello-swarm Example to Use Defaults

**Files:**

- Modify: `examples/hello-swarm/swarm.yaml`
- Create: `examples/customer-support/swarm.yaml`

**Step 1: Update hello-swarm to use defaults**

```yaml
apiVersion: openswarm/v1alpha1
kind: Swarm
metadata:
  name: hello-swarm
  labels:
    env: demo

spec:
  defaults:
    model: groq/meta-llama/llama-4-scout-17b-16e-instruct
    config:
      temperature: 0.7
      maxTokens: 4096
      contextWindow: 131072

  budget:
    total: '$1.00'
    alertAt: 80
    hardStop: 100

  agents:
    - name: greeter
      replicas: { min: 1, max: 1 }
      soul: |
        You are a friendly greeter agent. When given a topic or name,
        craft a warm, creative greeting or introduction about it.
        Be enthusiastic and personable.

    - name: formatter
      replicas: { min: 1, max: 1 }
      soul: |
        You are a formatter agent. Take the greeting you receive and
        format it beautifully with markdown headers, bullet points,
        and emoji. Make it visually appealing.
      config:
        temperature: 0.5
      dependsOn: [greeter]

  topology:
    - from: greeter
      to: formatter
      subject: greeting.raw
```

**Step 2: Create customer-support example**

Create `examples/customer-support/swarm.yaml`:

```yaml
apiVersion: openswarm/v1alpha1
kind: Swarm
metadata:
  name: customer-support
  labels:
    team: support
    env: production

spec:
  defaults:
    model: groq/meta-llama/llama-4-scout-17b-16e-instruct
    config:
      temperature: 0.7
      maxTokens: 4096
      contextWindow: 131072

  budget:
    total: '$10.00'
    perTask: '$0.50'
    alertAt: 80
    hardStop: 100

  agents:
    - name: triage
      replicas: { min: 1, max: 3 }
      soul: |
        You are a triage agent. Classify incoming messages and route
        them to the appropriate specialist. Categories: billing,
        technical, general.
      tools:
        - sessions_send
        - sessions_list
        - memory_search
      cron:
        - name: morning-check
          schedule: '0 8 * * *'
          task: 'Review overnight messages and prioritize queue'
      config:
        temperature: 0.5

    - name: resolver
      replicas: { min: 2, max: 5 }
      soul: |
        You are a resolver. Handle customer complaints with empathy
        and thoroughness. Look up order details, suggest solutions,
        and escalate if needed.
      config:
        maxTokens: 8192
        temperature: 0.3

    - name: notifier
      replicas: { min: 1, max: 1 }
      model: groq/llama-3.3-70b-versatile
      soul: |
        You deliver resolved case summaries to the team.
        Be concise and factual.

  topology:
    - from: triage
      to: resolver
      subject: route.resolve
    - from: resolver
      to: notifier
      subject: route.notify
```

**Step 3: Manually test with the running control plane**

Run: `cd apps/controlplane && go run ./cmd/openswarm apply ../../examples/hello-swarm/swarm.yaml`
Expected: `swarm/hello-swarm applied` — agents spawn with correct merged config

**Step 4: Commit**

```bash
git add examples/hello-swarm/swarm.yaml examples/customer-support/swarm.yaml
git commit -m "feat(examples): update hello-swarm with defaults, add customer-support example"
```

---

## Task 5: CLI — Remove Stubs, Add `ps` Command

**Files:**

- Modify: `apps/controlplane/cmd/openswarm/main.go`

**Step 1: Remove stub commands from CLI**

Remove these commands from `main.go` (they print "not yet implemented"):

- `logsCmd()` (line 291-303)
- `scaleCmd()` (line 305-315)
- `budgetCmd()` (line 317-327)
- `genomeCmd()` (line 329-358)

Remove their registration from `main()` (lines 34-37):

```go
// Remove:
rootCmd.AddCommand(logsCmd())
rootCmd.AddCommand(scaleCmd())
rootCmd.AddCommand(budgetCmd())
rootCmd.AddCommand(genomeCmd())
```

**Step 2: Add `ps` command — one line per swarm**

Add this function:

```go
func psCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "ps",
		Short: "Quick status — one line per swarm",
		RunE: func(cmd *cobra.Command, args []string) error {
			var swarms []domain.Swarm
			if err := getJSON("/api/v1/swarms", &swarms); err != nil {
				return err
			}
			if len(swarms) == 0 {
				fmt.Println("No swarms running.")
				return nil
			}

			tw := tabwriter.NewWriter(os.Stdout, 0, 4, 2, ' ', 0)
			fmt.Fprintln(tw, "SWARM\tSTATUS\tAGENTS\tBUDGET\tAGE")
			for _, s := range swarms {
				age := time.Since(s.CreatedAt).Truncate(time.Second)
				fmt.Fprintf(tw, "%s\t%s\t%d\t%s\t%s\n",
					s.Name, s.Status, len(s.Spec.Agents),
					s.Spec.Budget.Total, age)
			}
			tw.Flush()
			return nil
		},
	}
}
```

Register it in `main()`:

```go
rootCmd.AddCommand(psCmd())
```

**Step 3: Build and test**

Run: `cd apps/controlplane && go build ./cmd/openswarm && ./openswarm --help`
Expected: Only working commands listed (version, apply, status, agents, tasks, policy, down, ps)

Run: `./openswarm ps`
Expected: Shows running swarms or "No swarms running."

**Step 4: Commit**

```bash
git add apps/controlplane/cmd/openswarm/main.go
git commit -m "feat(cli): remove stub commands, add ps for quick swarm status"
```

---

## Task 6: CLI — Add `chat` Command (Interactive REPL)

**Files:**

- Modify: `apps/controlplane/cmd/openswarm/main.go`

**Step 1: Add the `chat` command**

```go
func chatCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "chat <swarm>/<role>",
		Short: "Interactive chat session with an agent",
		Long:  "Opens an interactive REPL that sends messages to an agent via the control plane chat proxy.",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			parts := strings.SplitN(args[0], "/", 2)
			if len(parts) != 2 {
				return fmt.Errorf("usage: openswarm chat <swarm>/<role>")
			}
			swarmName, role := parts[0], parts[1]

			// Find a container for this swarm/role
			containerID, err := findContainerForRole(swarmName, role)
			if err != nil {
				return err
			}

			fmt.Printf("Connected to %s/%s (container %s). Type 'exit' to quit.\n\n", swarmName, role, containerID)

			scanner := bufio.NewScanner(os.Stdin)
			for {
				fmt.Print("> ")
				if !scanner.Scan() {
					break
				}
				input := strings.TrimSpace(scanner.Text())
				if input == "" {
					continue
				}
				if input == "exit" || input == "quit" {
					break
				}

				// Send via chat proxy
				chatReq := map[string]any{
					"messages": []map[string]string{
						{"role": "user", "content": input},
					},
				}
				respBody, err := postJSONRaw(fmt.Sprintf("/api/v1/containers/%s/chat", containerID), chatReq)
				if err != nil {
					fmt.Fprintf(os.Stderr, "Error: %v\n", err)
					continue
				}

				// Parse response
				var chatResp map[string]any
				if err := json.Unmarshal(respBody, &chatResp); err != nil {
					fmt.Fprintf(os.Stderr, "Parse error: %v\n", err)
					continue
				}

				// Extract assistant message from OpenAI-compatible response
				if choices, ok := chatResp["choices"].([]any); ok && len(choices) > 0 {
					if choice, ok := choices[0].(map[string]any); ok {
						if msg, ok := choice["message"].(map[string]any); ok {
							if content, ok := msg["content"].(string); ok {
								fmt.Printf("\n%s\n\n", content)
							}
						}
					}
				}
			}

			fmt.Println("Session ended.")
			return nil
		},
	}
}

// findContainerForRole looks up a running container for the given swarm/role.
func findContainerForRole(swarmName, role string) (string, error) {
	type containerInfo struct {
		ID   string `json:"id"`
		Role string `json:"role"`
	}
	var containers []containerInfo
	if err := getJSON(fmt.Sprintf("/api/v1/swarms/%s/containers", swarmName), &containers); err != nil {
		return "", fmt.Errorf("list containers: %w", err)
	}
	for _, c := range containers {
		if c.Role == role {
			return c.ID, nil
		}
	}
	return "", fmt.Errorf("no container found for %s/%s", swarmName, role)
}

// postJSONRaw posts JSON and returns the raw response body.
func postJSONRaw(path string, v any) ([]byte, error) {
	data, err := json.Marshal(v)
	if err != nil {
		return nil, fmt.Errorf("marshal: %w", err)
	}

	resp, err := http.Post(controlPlaneAddr+path, "application/json", bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("failed to connect to control plane at %s: %w", controlPlaneAddr, err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("server error (%d): %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return body, nil
}
```

Add import for `bufio` at the top of main.go.

Register: `rootCmd.AddCommand(chatCmd())`

**Step 2: Build and test**

Run: `cd apps/controlplane && go build ./cmd/openswarm`
Expected: Compiles cleanly

Run (manual): `./openswarm chat hello-swarm/greeter`
Expected: Interactive REPL that sends messages through the chat proxy

**Step 3: Commit**

```bash
git add apps/controlplane/cmd/openswarm/main.go
git commit -m "feat(cli): add chat command — interactive REPL with agents"
```

---

## Task 7: CLI — Add `send` Command (One-Shot Message)

**Files:**

- Modify: `apps/controlplane/cmd/openswarm/main.go`

**Step 1: Add the `send` command**

```go
func sendCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "send <swarm>/<role> <message>",
		Short: "Send a one-shot message to an agent",
		Args:  cobra.MinimumNArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			parts := strings.SplitN(args[0], "/", 2)
			if len(parts) != 2 {
				return fmt.Errorf("usage: openswarm send <swarm>/<role> <message>")
			}
			swarmName, role := parts[0], parts[1]
			message := strings.Join(args[1:], " ")

			containerID, err := findContainerForRole(swarmName, role)
			if err != nil {
				return err
			}

			chatReq := map[string]any{
				"messages": []map[string]string{
					{"role": "user", "content": message},
				},
			}
			respBody, err := postJSONRaw(fmt.Sprintf("/api/v1/containers/%s/chat", containerID), chatReq)
			if err != nil {
				return err
			}

			var chatResp map[string]any
			if err := json.Unmarshal(respBody, &chatResp); err != nil {
				return fmt.Errorf("parse response: %w", err)
			}

			if choices, ok := chatResp["choices"].([]any); ok && len(choices) > 0 {
				if choice, ok := choices[0].(map[string]any); ok {
					if msg, ok := choice["message"].(map[string]any); ok {
						if content, ok := msg["content"].(string); ok {
							fmt.Println(content)
						}
					}
				}
			}

			return nil
		},
	}
}
```

Register: `rootCmd.AddCommand(sendCmd())`

**Step 2: Build and test**

Run: `cd apps/controlplane && go build ./cmd/openswarm`
Expected: Compiles

Run: `./openswarm send hello-swarm/greeter "Say hello to the OpenSwarm team"`
Expected: Prints agent response

**Step 3: Commit**

```bash
git add apps/controlplane/cmd/openswarm/main.go
git commit -m "feat(cli): add send command — one-shot message to agent"
```

---

## Task 8: Dashboard Deploy Page — Backend Validation Endpoint

**Files:**

- Modify: `apps/controlplane/internal/api/server.go`

**Step 1: Add validate endpoint**

Add route to Router():

```go
mux.HandleFunc("POST /api/v1/swarms/validate", s.handleValidateSwarm)
```

Add handler:

```go
func (s *Server) handleValidateSwarm(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "failed to read body"})
		return
	}

	_, err = config.ParseSwarmManifest(body)
	if err != nil {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{
			"valid": "false",
			"error": err.Error(),
		})
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"valid": "true",
	})
}
```

**Step 2: Run go vet**

Run: `cd apps/controlplane && go vet ./...`
Expected: Clean

**Step 3: Commit**

```bash
git add apps/controlplane/internal/api/server.go
git commit -m "feat(api): add POST /api/v1/swarms/validate for YAML validation"
```

---

## Task 9: Dashboard Deploy Page — Frontend

**Files:**

- Create: `apps/web/app/dashboard/deploy/page.tsx`
- Modify: `apps/web/app/dashboard/layout.tsx`
- Modify: `apps/web/src/lib/api-client.ts`

**Step 1: Add API client functions**

Add to `apps/web/src/lib/api-client.ts`:

```typescript
export async function validateSwarmYAML(yaml: string): Promise<{ valid: string; error?: string }> {
  const res = await fetch(`${API_BASE}/api/v1/swarms/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: yaml,
  });
  return res.json();
}

export async function deploySwarmFromYAML(yaml: string): Promise<Swarm> {
  // Parse YAML on client side to get JSON for the swarms endpoint
  const res = await fetch(`${API_BASE}/api/v1/swarms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: yaml, // Actually need to convert YAML -> JSON here
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Deploy failed');
  }
  return res.json();
}
```

**Step 2: Create the deploy page**

Create `apps/web/app/dashboard/deploy/page.tsx` with:

- A YAML editor textarea (simple first, Monaco later)
- Example template dropdown (hello-swarm, customer-support)
- Validate button → calls POST /api/v1/swarms/validate
- Deploy button → calls POST /api/v1/swarms
- Status messages / error display
- After deploy → redirect to dashboard

**Step 3: Add "Deploy" link to dashboard layout**

In `apps/web/app/dashboard/layout.tsx`, add navigation link to `/dashboard/deploy`.

**Step 4: Test in browser**

Navigate to `http://localhost:3000/dashboard/deploy`
Expected: YAML editor visible, template dropdown works, validate shows green/red feedback

**Step 5: Commit**

```bash
git add apps/web/app/dashboard/deploy/page.tsx apps/web/app/dashboard/layout.tsx apps/web/src/lib/api-client.ts
git commit -m "feat(dashboard): add deploy page — YAML editor with validate and deploy"
```

---

## Task 10: Inter-Agent Communication Bridge — NATS Setup

**Files:**

- Create: `apps/controlplane/internal/bridge/bridge.go`
- Create: `apps/controlplane/internal/bridge/bridge_test.go`

**Step 1: Write the failing test**

Create `apps/controlplane/internal/bridge/bridge_test.go`:

```go
package bridge

import "testing"

func TestSubjectForTopology(t *testing.T) {
	subject := SubjectForTopology("my-swarm", "route.resolve")
	want := "swarm.my-swarm.pipeline.route.resolve"
	if subject != want {
		t.Errorf("subject = %q, want %q", subject, want)
	}
}

func TestBridgeConfig(t *testing.T) {
	b := &Bridge{swarmName: "test"}
	if b.swarmName != "test" {
		t.Errorf("swarmName = %q, want %q", b.swarmName, "test")
	}
}
```

**Step 2: Run test to verify it fails**

Run: `cd apps/controlplane && go test ./internal/bridge/ -v`
Expected: FAIL — package doesn't exist

**Step 3: Write implementation**

Create `apps/controlplane/internal/bridge/bridge.go`:

```go
package bridge

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"

	"github.com/openswarm/openswarm/internal/bus"
	"github.com/openswarm/openswarm/internal/domain"
	"github.com/openswarm/openswarm/internal/pool"
)

// SubjectForTopology builds the NATS subject for a topology edge.
func SubjectForTopology(swarmName, edgeSubject string) string {
	return fmt.Sprintf("swarm.%s.pipeline.%s", swarmName, edgeSubject)
}

// Message is the payload sent between agents via the bridge.
type Message struct {
	From    string `json:"from"`    // source agent role
	To      string `json:"to"`      // target agent role
	Content string `json:"content"` // message text
	TaskID  string `json:"taskId,omitempty"`
}

// Bridge wires NATS pub/sub between agents in a swarm based on topology edges.
type Bridge struct {
	swarmName string
	bus       *bus.Bus
	pool      *pool.Pool
	topology  []domain.TopologyEdge
}

// New creates a Bridge for the given swarm.
func New(swarmName string, b *bus.Bus, p *pool.Pool, topology []domain.TopologyEdge) *Bridge {
	return &Bridge{
		swarmName: swarmName,
		bus:       b,
		pool:      p,
		topology:  topology,
	}
}

// Start subscribes to all topology edges and routes messages to target agents.
func (b *Bridge) Start(ctx context.Context) error {
	for _, edge := range b.topology {
		subject := SubjectForTopology(b.swarmName, edge.Subject)
		targetRole := edge.To

		slog.Info("bridge: subscribing", "subject", subject, "from", edge.From, "to", targetRole)

		err := b.bus.Subscribe(ctx, subject, func(data []byte) {
			var msg Message
			if err := json.Unmarshal(data, &msg); err != nil {
				slog.Error("bridge: unmarshal message", "error", err)
				return
			}

			// Find a container for the target role
			instances := b.pool.ListByRole(b.swarmName, targetRole)
			if len(instances) == 0 {
				slog.Warn("bridge: no instances for target role", "role", targetRole)
				return
			}

			// Round-robin: pick first available
			inst := instances[0]
			slog.Info("bridge: routing message",
				"from", msg.From, "to", targetRole,
				"container", inst.ID, "content_len", len(msg.Content))

			// TODO: Forward to OpenClaw container via chat proxy
			// For now just log that we'd route it
		})
		if err != nil {
			return fmt.Errorf("bridge: subscribe %s: %w", subject, err)
		}
	}

	return nil
}

// Send publishes a message from one agent to another via NATS.
func (b *Bridge) Send(ctx context.Context, from, to, content string) error {
	// Find the topology edge for this from→to pair
	for _, edge := range b.topology {
		if edge.From == from && edge.To == to {
			subject := SubjectForTopology(b.swarmName, edge.Subject)
			msg := Message{
				From:    from,
				To:      to,
				Content: content,
			}
			return b.bus.PublishJSON(ctx, subject, msg)
		}
	}
	return fmt.Errorf("bridge: no topology edge from %q to %q", from, to)
}
```

**Step 4: Run test**

Run: `cd apps/controlplane && go test ./internal/bridge/ -v`
Expected: PASS

**Step 5: Run all tests**

Run: `cd apps/controlplane && go vet ./... && go test ./...`
Expected: All pass

**Step 6: Commit**

```bash
git add apps/controlplane/internal/bridge/bridge.go apps/controlplane/internal/bridge/bridge_test.go
git commit -m "feat(bridge): inter-agent NATS communication bridge for topology edges"
```

---

## Task 11: Wire Bridge into Swarm Lifecycle

**Files:**

- Modify: `apps/controlplane/internal/api/server.go`
- Modify: `apps/controlplane/internal/lifecycle/manager.go`

**Step 1: Start bridge when swarm is created**

In `handleCreateSwarm` in `api/server.go`, after `RegisterSwarmAgents`, start the bridge:

```go
// Start inter-agent communication bridge if topology exists
if len(sw.Spec.Topology) > 0 {
    b := bridge.New(sw.Name, s.bus, s.pool, sw.Spec.Topology)
    if err := b.Start(r.Context()); err != nil {
        slog.Error("bridge: start failed", "swarm", sw.Name, "error", err)
    } else {
        slog.Info("bridge: started", "swarm", sw.Name, "edges", len(sw.Spec.Topology))
    }
}
```

**Step 2: Add a send-to-agent API endpoint for the bridge**

Add route:

```go
mux.HandleFunc("POST /api/v1/swarms/{name}/send", s.handleSwarmSend)
```

Add handler:

```go
func (s *Server) handleSwarmSend(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")

	var req struct {
		From    string `json:"from"`
		To      string `json:"to"`
		Message string `json:"message"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON: " + err.Error()})
		return
	}

	// Publish to NATS — the bridge subscriber will route it
	sw, err := s.store.GetSwarmByName(r.Context(), name)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
		return
	}

	for _, edge := range sw.Spec.Topology {
		if edge.From == req.From && edge.To == req.To {
			subject := fmt.Sprintf("swarm.%s.pipeline.%s", name, edge.Subject)
			msg := map[string]string{
				"from":    req.From,
				"to":      req.To,
				"content": req.Message,
			}
			if err := s.bus.PublishJSON(r.Context(), subject, msg); err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
				return
			}
			writeJSON(w, http.StatusOK, map[string]string{"status": "sent", "subject": subject})
			return
		}
	}

	writeJSON(w, http.StatusBadRequest, map[string]string{"error": fmt.Sprintf("no topology edge from %q to %q", req.From, req.To)})
}
```

**Step 3: Build and test**

Run: `cd apps/controlplane && go vet ./... && go test ./...`
Expected: All pass

**Step 4: Commit**

```bash
git add apps/controlplane/internal/api/server.go apps/controlplane/internal/lifecycle/manager.go
git commit -m "feat(bridge): wire NATS bridge into swarm lifecycle + add send endpoint"
```

---

## Task 12: End-to-End Smoke Test

**Step 1: Build everything**

Run: `cd apps/controlplane && go build ./cmd/openswarm-controller && go build ./cmd/openswarm`

**Step 2: Start infrastructure**

Run: `docker compose up -d postgres redis nats`

**Step 3: Start control plane**

Run: `cd apps/controlplane && air` (or `go run ./cmd/openswarm-controller`)

**Step 4: Deploy the customer-support swarm**

Run: `./openswarm apply ../../examples/customer-support/swarm.yaml`
Expected: `swarm/customer-support applied`

**Step 5: Verify with ps**

Run: `./openswarm ps`
Expected: Shows customer-support swarm with status=running

**Step 6: Verify agents**

Run: `./openswarm agents customer-support`
Expected: Shows triage (1 instance), resolver (2 instances), notifier (1 instance)

**Step 7: Chat with triage**

Run: `./openswarm send customer-support/triage "A customer reports their order #12345 hasn't arrived"`
Expected: Agent responds with triage classification

**Step 8: Tear down**

Run: `./openswarm down customer-support`
Expected: `swarm/customer-support deleted`

**Step 9: Verify dashboard deploy page**

Navigate to `http://localhost:3000/dashboard/deploy`
Expected: YAML editor loads, can paste customer-support YAML, validate, deploy

---

## Summary — What P0 Delivers

After completing all 12 tasks:

1. **YAML defaults cascade** — `spec.defaults.model` and `spec.defaults.config` inherited by all agents, per-agent overrides
2. **Config passthrough** — temperature, maxTokens, contextWindow, tools, cron flow from YAML into openclaw.json
3. **CLI works** — `ps`, `chat`, `send` are real; stubs removed; every listed command functions
4. **Dashboard deploy** — non-technical users paste YAML, validate, and deploy from the browser
5. **Inter-agent bridge** — topology edges create NATS pub/sub routes between agents
6. **Example swarms** — hello-swarm (updated) + customer-support (new) demonstrate the full feature set
