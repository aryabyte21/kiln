# Real Execution Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the entire simulation layer with real OpenClaw orchestration — real Docker containers, real LLM calls via Ollama, real token counts, real latency.

**Architecture:** Control plane spawns OpenClaw Gateway Docker containers dynamically via Docker SDK. Each container connects to a shared Ollama instance for LLM inference. The lifecycle manager reconciles desired state (swarm.yaml replicas) with actual state (running containers) every 5 seconds. The executor sends real HTTP requests to OpenClaw's `/v1/chat/completions` endpoint and records real token usage.

**Tech Stack:** Go 1.23, Docker SDK (`github.com/docker/docker`), OpenClaw Gateway (Docker image `openclawai/openclaw:latest`), Ollama (`ollama/ollama`), existing PostgreSQL/Redis/NATS infrastructure.

---

## Pre-requisites

Before starting, ensure:

- Docker Desktop running with enough memory (recommend 12GB+ allocated)
- `ollama pull qwen2.5:7b` completed (or `llama3.2:3b` for lighter option)
- `docker pull openclawai/openclaw:latest` completed
- All existing tests pass: `cd apps/controlplane && go test ./...`

---

### Task 1: Add `soul` Field to Domain Types

**Files:**

- Modify: `apps/controlplane/internal/domain/agent.go`
- Test: manual compile check

**Step 1: Add Soul field to AgentSpec**

In `apps/controlplane/internal/domain/agent.go`, add the `Soul` field to `AgentSpec`:

```go
type AgentSpec struct {
	Name      string        `json:"name" yaml:"name"`
	Replicas  ReplicaSpec   `json:"replicas" yaml:"replicas"`
	Model     string        `json:"model" yaml:"model"`
	Soul      string        `json:"soul,omitempty" yaml:"soul,omitempty"` // Inline SOUL.md content for the agent
	Skills    []string      `json:"skills,omitempty" yaml:"skills,omitempty"`
	Policy    string        `json:"policy,omitempty" yaml:"policy,omitempty"`
	DependsOn []string      `json:"dependsOn,omitempty" yaml:"dependsOn,omitempty"`
	Genome    *GenomeConfig `json:"genome,omitempty" yaml:"genome,omitempty"`
	Resources *ResourceSpec `json:"resources,omitempty" yaml:"resources,omitempty"`
}
```

**Step 2: Add ContainerID field to Agent**

In the same file, add `ContainerID` to `Agent` struct for tracking the Docker container:

```go
type Agent struct {
	ID           string            `json:"id"`
	SwarmName    string            `json:"swarmName"`
	Role         string            `json:"role"`
	Status       AgentStatus       `json:"status"`
	Model        string            `json:"model"`
	OpenClawAddr string            `json:"openclawAddr"`
	ContainerID  string            `json:"containerId,omitempty"` // Docker container ID
	ConfigHash   string            `json:"configHash"`
	Labels       map[string]string `json:"labels,omitempty"`
	RegisteredAt time.Time         `json:"registeredAt"`
	LastSeen     time.Time         `json:"lastSeen"`
}
```

**Step 3: Verify it compiles**

Run: `cd /Users/pinetortoise/Desktop/CS5224/apps/controlplane && go build ./...`
Expected: SUCCESS (no errors)

**Step 4: Update registry serialisation**

In `apps/controlplane/internal/registry/registry.go`, add `containerId` to `agentToMap` and `agentFromMap`:

In `agentToMap`, add:

```go
"containerId": a.ContainerID,
```

In `agentFromMap`, add:

```go
a.ContainerID = m["containerId"]
```

**Step 5: Verify tests pass**

Run: `cd /Users/pinetortoise/Desktop/CS5224/apps/controlplane && go test ./...`
Expected: All tests pass.

---

### Task 2: Add Ollama Service to Docker Compose

**Files:**

- Modify: `docker-compose.yml`

**Step 1: Add ollama service**

Add the following service to `docker-compose.yml` between `nats` and `prometheus`:

```yaml
ollama:
  image: ollama/ollama
  container_name: openswarm-ollama
  ports:
    - '11434:11434'
  volumes:
    - ollama-data:/root/.ollama
  healthcheck:
    test: ['CMD', 'curl', '-f', 'http://localhost:11434/api/tags']
    interval: 10s
    timeout: 5s
    retries: 5
```

Add `ollama-data:` to the `volumes:` section at the bottom.

**Step 2: Create the Docker network**

Add a `networks` section so dynamically spawned OpenClaw containers can reach Ollama:

```yaml
networks:
  openswarm:
    driver: bridge
```

And add `networks: [openswarm]` to every service (postgres, redis, nats, ollama).

**Step 3: Verify docker compose config is valid**

Run: `cd /Users/pinetortoise/Desktop/CS5224 && docker compose config --quiet`
Expected: No errors

**Step 4: Start Ollama and verify health**

Run: `docker compose up -d ollama && sleep 10 && curl -s http://localhost:11434/api/tags | head -c 200`
Expected: JSON response listing available models (possibly empty list)

**Step 5: Pull model into Ollama (if not already done)**

Run: `docker compose exec ollama ollama pull qwen2.5:7b`
Expected: Model downloads and becomes available (may take several minutes)

---

### Task 3: Create Instance Pool Package

This is the core new package. It manages OpenClaw Docker containers.

**Files:**

- Create: `apps/controlplane/internal/pool/pool.go`
- Create: `apps/controlplane/internal/pool/pool_test.go`

**Step 1: Add Docker SDK dependency**

Run: `cd /Users/pinetortoise/Desktop/CS5224/apps/controlplane && go get github.com/docker/docker/client github.com/docker/docker/api/types github.com/docker/docker/api/types/container github.com/docker/go-connections/nat`
Expected: Dependencies added to go.mod

**Step 2: Write the Instance type and Pool interface**

Create `apps/controlplane/internal/pool/pool.go`:

```go
package pool

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/network"
	dockerclient "github.com/docker/docker/client"
	"github.com/docker/go-connections/nat"
)

// Instance represents a running OpenClaw Gateway container.
type Instance struct {
	ID          string // Docker container ID (short)
	Role        string
	SwarmName   string
	Addr        string // host:port reachable from control plane
	Port        int    // mapped host port
	ContainerID string // full Docker container ID
	CreatedAt   time.Time
}

// Config holds pool configuration.
type Config struct {
	OpenClawImage string // default: "openclawai/openclaw:latest"
	OllamaURL     string // e.g. "http://ollama:11434/v1"
	GatewayToken  string // OPENCLAW_GATEWAY_TOKEN
	NetworkName   string // Docker network to attach containers to
	Model         string // e.g. "qwen2.5:7b"
	WorkspaceDir  string // base dir for agent workspaces (default: /tmp/openswarm-workspaces)
}

// Pool manages OpenClaw Gateway Docker containers.
type Pool struct {
	cfg       Config
	docker    *dockerclient.Client
	mu        sync.Mutex
	instances map[string]*Instance // keyed by instance ID
	nextPort  int                  // next available host port
}

// New creates a Pool connected to the local Docker daemon.
func New(cfg Config) (*Pool, error) {
	if cfg.OpenClawImage == "" {
		cfg.OpenClawImage = "openclawai/openclaw:latest"
	}
	if cfg.OllamaURL == "" {
		cfg.OllamaURL = "http://ollama:11434/v1"
	}
	if cfg.NetworkName == "" {
		cfg.NetworkName = "openswarm"
	}
	if cfg.WorkspaceDir == "" {
		cfg.WorkspaceDir = "/tmp/openswarm-workspaces"
	}
	if cfg.Model == "" {
		cfg.Model = "qwen2.5:7b"
	}

	cli, err := dockerclient.NewClientWithOpts(dockerclient.FromEnv, dockerclient.WithAPIVersionNegotiation())
	if err != nil {
		return nil, fmt.Errorf("pool: docker client: %w", err)
	}

	return &Pool{
		cfg:       cfg,
		docker:    cli,
		instances: make(map[string]*Instance),
		nextPort:  18800, // start above the default 18789
	}, nil
}

// Spawn creates a new OpenClaw container for the given role with the specified SOUL.md content.
func (p *Pool) Spawn(ctx context.Context, swarmName, role, soulMD string) (*Instance, error) {
	p.mu.Lock()
	hostPort := p.nextPort
	p.nextPort++
	p.mu.Unlock()

	// 1. Create workspace directory with SOUL.md and settings.json
	workDir, err := p.createWorkspace(swarmName, role, hostPort, soulMD)
	if err != nil {
		return nil, fmt.Errorf("pool: create workspace: %w", err)
	}

	// 2. Create container
	containerPort := "18789/tcp"
	hostBinding := fmt.Sprintf("%d", hostPort)

	containerCfg := &container.Config{
		Image: p.cfg.OpenClawImage,
		Env: []string{
			fmt.Sprintf("OPENCLAW_GATEWAY_TOKEN=%s", p.cfg.GatewayToken),
			"OPENCLAW_GATEWAY_PORT=18789",
		},
		ExposedPorts: nat.PortSet{
			nat.Port(containerPort): struct{}{},
		},
		Labels: map[string]string{
			"openswarm.swarm": swarmName,
			"openswarm.role":  role,
			"managed-by":      "openswarm",
		},
	}

	hostCfg := &container.HostConfig{
		PortBindings: nat.PortMap{
			nat.Port(containerPort): []nat.PortBinding{
				{HostIP: "0.0.0.0", HostPort: hostBinding},
			},
		},
		Binds: []string{
			fmt.Sprintf("%s:/root/.openclaw", workDir),
		},
	}

	networkCfg := &network.NetworkingConfig{
		EndpointsConfig: map[string]*network.EndpointSettings{
			p.cfg.NetworkName: {},
		},
	}

	containerName := fmt.Sprintf("osw-%s-%s-%d", swarmName, role, hostPort)

	resp, err := p.docker.ContainerCreate(ctx, containerCfg, hostCfg, networkCfg, nil, containerName)
	if err != nil {
		return nil, fmt.Errorf("pool: create container: %w", err)
	}

	// 3. Start container
	if err := p.docker.ContainerStart(ctx, resp.ID, container.StartOptions{}); err != nil {
		// Clean up on failure
		_ = p.docker.ContainerRemove(ctx, resp.ID, container.RemoveOptions{Force: true})
		return nil, fmt.Errorf("pool: start container: %w", err)
	}

	inst := &Instance{
		ID:          resp.ID[:12],
		Role:        role,
		SwarmName:   swarmName,
		Addr:        fmt.Sprintf("localhost:%d", hostPort),
		Port:        hostPort,
		ContainerID: resp.ID,
		CreatedAt:   time.Now().UTC(),
	}

	p.mu.Lock()
	p.instances[inst.ID] = inst
	p.mu.Unlock()

	slog.Info("pool: spawned instance", "id", inst.ID, "role", role, "addr", inst.Addr)
	return inst, nil
}

// Terminate gracefully stops and removes a container.
func (p *Pool) Terminate(ctx context.Context, instanceID string) error {
	p.mu.Lock()
	inst, ok := p.instances[instanceID]
	if !ok {
		p.mu.Unlock()
		return fmt.Errorf("pool: instance %s not found", instanceID)
	}
	delete(p.instances, instanceID)
	p.mu.Unlock()

	timeout := 10 // seconds
	if err := p.docker.ContainerStop(ctx, inst.ContainerID, container.StopOptions{Timeout: &timeout}); err != nil {
		slog.Warn("pool: stop container failed, forcing", "id", instanceID, "error", err)
	}

	if err := p.docker.ContainerRemove(ctx, inst.ContainerID, container.RemoveOptions{Force: true}); err != nil {
		return fmt.Errorf("pool: remove container %s: %w", instanceID, err)
	}

	// Clean up workspace
	workDir := filepath.Join(p.cfg.WorkspaceDir, instanceID)
	_ = os.RemoveAll(workDir)

	slog.Info("pool: terminated instance", "id", instanceID, "role", inst.Role)
	return nil
}

// HealthCheck pings the OpenClaw health endpoint.
func (p *Pool) HealthCheck(ctx context.Context, inst *Instance) bool {
	url := fmt.Sprintf("http://%s/healthz", inst.Addr)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return false
	}

	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode == http.StatusOK
}

// ListByRole returns all instances for a given swarm and role.
func (p *Pool) ListByRole(swarmName, role string) []*Instance {
	p.mu.Lock()
	defer p.mu.Unlock()

	var result []*Instance
	for _, inst := range p.instances {
		if inst.SwarmName == swarmName && inst.Role == role {
			result = append(result, inst)
		}
	}
	return result
}

// ListBySwarm returns all instances for a given swarm.
func (p *Pool) ListBySwarm(swarmName string) []*Instance {
	p.mu.Lock()
	defer p.mu.Unlock()

	var result []*Instance
	for _, inst := range p.instances {
		if inst.SwarmName == swarmName {
			result = append(result, inst)
		}
	}
	return result
}

// CountByRole returns how many instances exist for a given swarm and role.
func (p *Pool) CountByRole(swarmName, role string) int {
	return len(p.ListByRole(swarmName, role))
}

// Get returns an instance by ID.
func (p *Pool) Get(instanceID string) (*Instance, bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	inst, ok := p.instances[instanceID]
	return inst, ok
}

// TerminateAll stops all managed containers. Used during shutdown.
func (p *Pool) TerminateAll(ctx context.Context) {
	p.mu.Lock()
	ids := make([]string, 0, len(p.instances))
	for id := range p.instances {
		ids = append(ids, id)
	}
	p.mu.Unlock()

	for _, id := range ids {
		if err := p.Terminate(ctx, id); err != nil {
			slog.Error("pool: terminate on shutdown", "id", id, "error", err)
		}
	}
}

// RecoverExisting discovers and re-tracks OpenClaw containers that were
// previously spawned by OpenSwarm (identified by the "managed-by=openswarm" label).
func (p *Pool) RecoverExisting(ctx context.Context) error {
	containers, err := p.docker.ContainerList(ctx, container.ListOptions{})
	if err != nil {
		return fmt.Errorf("pool: list containers: %w", err)
	}

	for _, c := range containers {
		if c.Labels["managed-by"] != "openswarm" {
			continue
		}
		swarm := c.Labels["openswarm.swarm"]
		role := c.Labels["openswarm.role"]
		if swarm == "" || role == "" {
			continue
		}

		// Find the mapped port
		var hostPort int
		for _, port := range c.Ports {
			if port.PrivatePort == 18789 {
				hostPort = int(port.PublicPort)
				break
			}
		}
		if hostPort == 0 {
			continue
		}

		inst := &Instance{
			ID:          c.ID[:12],
			Role:        role,
			SwarmName:   swarm,
			Addr:        fmt.Sprintf("localhost:%d", hostPort),
			Port:        hostPort,
			ContainerID: c.ID,
			CreatedAt:   time.Unix(c.Created, 0),
		}

		p.mu.Lock()
		p.instances[inst.ID] = inst
		if hostPort >= p.nextPort {
			p.nextPort = hostPort + 1
		}
		p.mu.Unlock()

		slog.Info("pool: recovered existing instance", "id", inst.ID, "role", role, "addr", inst.Addr)
	}

	return nil
}

// Close releases the Docker client.
func (p *Pool) Close() error {
	return p.docker.Close()
}

// createWorkspace generates the workspace directory with SOUL.md and settings.json.
func (p *Pool) createWorkspace(swarmName, role string, port int, soulMD string) (string, error) {
	instanceDir := filepath.Join(p.cfg.WorkspaceDir, fmt.Sprintf("%s-%s-%d", swarmName, role, port))
	if err := os.MkdirAll(instanceDir, 0o755); err != nil {
		return "", fmt.Errorf("create workspace dir: %w", err)
	}

	// Write SOUL.md
	if soulMD == "" {
		soulMD = fmt.Sprintf("You are a %s agent in the %s swarm. Complete tasks assigned to you thoroughly and accurately.", role, swarmName)
	}
	if err := os.WriteFile(filepath.Join(instanceDir, "SOUL.md"), []byte(soulMD), 0o644); err != nil {
		return "", fmt.Errorf("write SOUL.md: %w", err)
	}

	// Write settings.json pointing to Ollama
	settings := map[string]interface{}{
		"models": map[string]interface{}{
			"providers": map[string]interface{}{
				"ollama": map[string]interface{}{
					"baseUrl": p.cfg.OllamaURL,
					"api":     "openai-completions",
					"apiKey":  "ollama-local",
				},
			},
		},
		"agents": map[string]interface{}{
			"defaults": map[string]interface{}{
				"model": map[string]interface{}{
					"primary": fmt.Sprintf("ollama/%s", p.cfg.Model),
				},
			},
		},
	}

	settingsJSON, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return "", fmt.Errorf("marshal settings: %w", err)
	}
	if err := os.WriteFile(filepath.Join(instanceDir, "settings.json"), settingsJSON, 0o644); err != nil {
		return "", fmt.Errorf("write settings.json: %w", err)
	}

	return instanceDir, nil
}
```

**Step 3: Verify it compiles**

Run: `cd /Users/pinetortoise/Desktop/CS5224/apps/controlplane && go build ./internal/pool/`
Expected: SUCCESS

**Step 4: Write unit test for workspace creation**

Create `apps/controlplane/internal/pool/pool_test.go`:

```go
package pool

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCreateWorkspace(t *testing.T) {
	tmpDir := t.TempDir()
	p := &Pool{
		cfg: Config{
			OllamaURL:    "http://ollama:11434/v1",
			Model:        "qwen2.5:7b",
			WorkspaceDir: tmpDir,
		},
	}

	dir, err := p.createWorkspace("test-swarm", "summarizer", 18800, "You are a test agent.")
	if err != nil {
		t.Fatalf("createWorkspace: %v", err)
	}

	// Verify SOUL.md exists with correct content
	soulPath := filepath.Join(dir, "SOUL.md")
	soulBytes, err := os.ReadFile(soulPath)
	if err != nil {
		t.Fatalf("read SOUL.md: %v", err)
	}
	if string(soulBytes) != "You are a test agent." {
		t.Errorf("SOUL.md = %q, want %q", string(soulBytes), "You are a test agent.")
	}

	// Verify settings.json exists and contains ollama URL
	settingsPath := filepath.Join(dir, "settings.json")
	settingsBytes, err := os.ReadFile(settingsPath)
	if err != nil {
		t.Fatalf("read settings.json: %v", err)
	}
	settingsStr := string(settingsBytes)
	if !contains(settingsStr, "ollama:11434") {
		t.Errorf("settings.json missing ollama URL: %s", settingsStr)
	}
	if !contains(settingsStr, "qwen2.5:7b") {
		t.Errorf("settings.json missing model: %s", settingsStr)
	}
}

func TestCreateWorkspaceDefaultSoul(t *testing.T) {
	tmpDir := t.TempDir()
	p := &Pool{
		cfg: Config{
			OllamaURL:    "http://ollama:11434/v1",
			Model:        "qwen2.5:7b",
			WorkspaceDir: tmpDir,
		},
	}

	dir, err := p.createWorkspace("my-swarm", "fetcher", 18801, "")
	if err != nil {
		t.Fatalf("createWorkspace: %v", err)
	}

	soulBytes, err := os.ReadFile(filepath.Join(dir, "SOUL.md"))
	if err != nil {
		t.Fatalf("read SOUL.md: %v", err)
	}
	if !contains(string(soulBytes), "fetcher") || !contains(string(soulBytes), "my-swarm") {
		t.Errorf("default SOUL.md should mention role and swarm, got: %s", string(soulBytes))
	}
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > 0 && containsHelper(s, substr))
}

func containsHelper(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
```

**Step 5: Run the pool tests**

Run: `cd /Users/pinetortoise/Desktop/CS5224/apps/controlplane && go test ./internal/pool/ -v`
Expected: PASS (2 tests)

---

### Task 4: Rewrite Lifecycle Manager — Reconciliation Loop

**Files:**

- Modify: `apps/controlplane/internal/lifecycle/manager.go`

**Step 1: Rewrite manager.go with real reconciliation**

Replace the entire contents of `apps/controlplane/internal/lifecycle/manager.go`:

```go
package lifecycle

import (
	"context"
	"crypto/sha256"
	"fmt"
	"log/slog"
	"time"

	"github.com/openswarm/openswarm/internal/domain"
	"github.com/openswarm/openswarm/internal/pool"
	"github.com/openswarm/openswarm/internal/registry"
	"github.com/openswarm/openswarm/internal/sse"
	"github.com/openswarm/openswarm/internal/store"
)

const (
	reconcileInterval = 5 * time.Second
	healthCheckTimeout = 3 * time.Second
)

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

// Start begins the reconciliation loop and recovers any existing containers.
func (m *Manager) Start(ctx context.Context) error {
	ctx, m.cancel = context.WithCancel(ctx)

	// Recover containers from a previous run
	if err := m.pool.RecoverExisting(ctx); err != nil {
		slog.Warn("lifecycle: recover existing containers", "error", err)
	}

	// Register agents for all running swarms on startup
	swarms, err := m.store.ListSwarms(ctx)
	if err != nil {
		return fmt.Errorf("lifecycle: list swarms: %w", err)
	}
	for _, sw := range swarms {
		if sw.Status == domain.SwarmStatusRunning {
			if err := m.Reconcile(ctx, sw.Name, sw.Spec); err != nil {
				slog.Error("lifecycle: initial reconcile", "swarm", sw.Name, "error", err)
			}
		}
	}

	go m.reconcileLoop(ctx)
	slog.Info("lifecycle: manager started with reconciliation loop")
	return nil
}

// Stop halts the reconciliation loop. Does NOT terminate containers
// (call pool.TerminateAll separately during shutdown).
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
			inst, err := m.pool.Spawn(ctx, swarmName, agentSpec.Name, agentSpec.Soul)
			if err != nil {
				slog.Error("lifecycle: spawn failed", "role", agentSpec.Name, "error", err)
				break // Don't keep trying if Docker is unhappy
			}

			// Register in Redis registry
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

		// Scale down: drain + terminate excess instances
		if actual > desired {
			excess := actual - desired
			instances := m.pool.ListByRole(swarmName, agentSpec.Name)
			for i := 0; i < excess && i < len(instances); i++ {
				inst := instances[len(instances)-1-i] // terminate newest first (LIFO)
				slog.Info("lifecycle: terminating excess instance",
					"id", inst.ID, "role", agentSpec.Name)

				if err := m.registry.Deregister(ctx, swarmName, inst.ID); err != nil {
					slog.Error("lifecycle: deregister excess", "id", inst.ID, "error", err)
				}
				if err := m.pool.Terminate(ctx, inst.ID); err != nil {
					slog.Error("lifecycle: terminate excess", "id", inst.ID, "error", err)
				}

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

		// Health check all instances
		instances := m.pool.ListBySwarm(sw.Name)
		for _, inst := range instances {
			healthy := m.pool.HealthCheck(ctx, inst)
			if healthy {
				// Update registry heartbeat with real health data
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
				slog.Warn("lifecycle: instance unhealthy, replacing",
					"id", inst.ID, "role", inst.Role)
				// Mark as error, then reconcile will spawn a replacement
				_ = m.registry.UpdateStatus(ctx, sw.Name, inst.ID, domain.AgentStatusError)

				// Terminate the unhealthy instance
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

		// Run reconciliation to ensure desired = actual
		if err := m.Reconcile(ctx, sw.Name, sw.Spec); err != nil {
			slog.Error("lifecycle: reconcile tick", "swarm", sw.Name, "error", err)
		}
	}
}

// generateAgentID creates a deterministic agent ID from swarm + role + index.
func generateAgentID(swarm, role string, index int) string {
	h := sha256.Sum256([]byte(fmt.Sprintf("%s/%s/%d", swarm, role, index)))
	return fmt.Sprintf("%x", h[:16])
}
```

**Step 2: Verify it compiles**

Run: `cd /Users/pinetortoise/Desktop/CS5224/apps/controlplane && go build ./internal/lifecycle/`
Expected: SUCCESS (may need to fix import paths)

---

### Task 5: Rewrite Executor — Real HTTP Calls to OpenClaw

**Files:**

- Modify: `apps/controlplane/internal/executor/executor.go`

**Step 1: Rewrite executor.go with real HTTP client**

Replace the entire contents of `apps/controlplane/internal/executor/executor.go`:

```go
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

	slog.Info("executor: started (real mode)")
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

	// Execute real LLM call
	start := time.Now()
	result, err := e.callOpenClaw(ctx, addr, task.Input)
	latencyMs := time.Since(start).Milliseconds()

	if err != nil {
		slog.Error("executor: openclaw call failed", "id", task.ID, "error", err)
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

	// Calculate cost based on real token usage (Ollama is free, but track for metrics)
	costUSD := estimateCost(result.Model, result.Usage.PromptTokens, result.Usage.CompletionTokens)

	output := result.Content
	totalTokens := result.Usage.TotalTokens

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

	// Broadcast task completion
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

// callOpenClaw sends a real HTTP request to an OpenClaw instance.
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
		return nil, fmt.Errorf("http call: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("openclaw returned %d: %s", resp.StatusCode, string(respBody))
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
		return nil, fmt.Errorf("parse response: %w (body: %s)", err, string(respBody))
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
	// Try the registry first (contains the OpenClawAddr)
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

	// Return the first available instance
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
// For local Ollama models, cost is effectively $0 but we track for metrics.
func estimateCost(model string, inputTokens, outputTokens int) float64 {
	// Local Ollama models have zero API cost.
	// We assign a nominal cost to keep the budget tracking meaningful for demos.
	// $0.001 per 1K tokens (nominal rate for tracking purposes)
	return float64(inputTokens+outputTokens) * 0.001 / 1000.0
}
```

**Step 2: Verify it compiles**

Run: `cd /Users/pinetortoise/Desktop/CS5224/apps/controlplane && go build ./internal/executor/`
Expected: SUCCESS

---

### Task 6: Wire Everything Together in main.go

**Files:**

- Modify: `apps/controlplane/cmd/openswarm-controller/main.go`

**Step 1: Update main.go to create pool and pass to subsystems**

Update the imports and subsystem creation section:

Add imports:

```go
"github.com/openswarm/openswarm/internal/pool"
```

Replace the subsystem creation block (lines ~92-106) with:

```go
// SSE event hub
hub := sse.NewHub()

// Instance pool — Docker container management for OpenClaw instances
poolCfg := pool.Config{
	OpenClawImage: getEnv("OPENCLAW_IMAGE", "openclawai/openclaw:latest"),
	OllamaURL:     getEnv("OLLAMA_URL", "http://ollama:11434/v1"),
	GatewayToken:  getEnv("OPENCLAW_TOKEN", "openswarm-secret"),
	NetworkName:   getEnv("DOCKER_NETWORK", "cs5224_openswarm"),
	Model:         getEnv("OLLAMA_MODEL", "qwen2.5:7b"),
}
instancePool, err := pool.New(poolCfg)
if err != nil {
	slog.Error("failed to create instance pool", "error", err)
	os.Exit(1)
}
defer instancePool.Close()
slog.Info("connected to Docker daemon")

// Lifecycle manager — reconciles desired vs actual container state
lm := lifecycle.New(st, reg, instancePool, hub)

// Scheduler — picks agents for pending tasks
sched := scheduler.New(st, reg, msgBus)

// Executor — sends tasks to real OpenClaw instances via HTTP
execCfg := executor.Config{
	GatewayToken: getEnv("OPENCLAW_TOKEN", "openswarm-secret"),
}
exec := executor.New(st, reg, instancePool, msgBus, bt, hub, execCfg)

// Genetics engine — agent genome tracking and evolution
ge := genetics.New(st)
```

Update the shutdown section to terminate all containers gracefully:

```go
// Stop subsystems in reverse order
exec.Stop()
sched.Stop()
lm.Stop()

// Terminate all managed containers
slog.Info("terminating all OpenClaw containers...")
instancePool.TerminateAll(context.Background())
```

**Step 2: Verify everything compiles**

Run: `cd /Users/pinetortoise/Desktop/CS5224/apps/controlplane && go build ./cmd/openswarm-controller/`
Expected: SUCCESS

**Step 3: Verify all tests still pass**

Run: `cd /Users/pinetortoise/Desktop/CS5224/apps/controlplane && go test ./...`
Expected: All tests pass (pool tests + existing tests)

---

### Task 7: Update Docker Compose Network Configuration

**Files:**

- Modify: `docker-compose.yml`

**Step 1: Full docker-compose.yml update**

The docker-compose.yml needs:

1. An `openswarm` bridge network so dynamically spawned OpenClaw containers can reach Ollama, PostgreSQL, etc.
2. All services attached to that network.
3. The Ollama service added.

Add the network to all existing services and add the new ollama service. Also add `ollama-data` to volumes.

**Step 2: Verify config**

Run: `cd /Users/pinetortoise/Desktop/CS5224 && docker compose config --quiet`
Expected: No errors

---

### Task 8: Update swarm.yaml Example with Soul Fields

**Files:**

- Modify: `examples/news-pipeline/swarm.yaml`

**Step 1: Add soul field to each agent**

Add a `soul` field to each agent in the news-pipeline swarm.yaml. Also update the model fields to use the Ollama model name:

```yaml
agents:
  - name: fetcher
    replicas: { min: 1, max: 3, scaleOn: queue_depth }
    model: qwen2.5:7b
    soul: |
      You are a news fetcher agent. Your job is to find and retrieve relevant news articles.
      Given a topic, provide a summary of 3-5 recent and relevant articles with key points.
      Be thorough but concise. Focus on factual reporting.
    skills: [web-browse, rss-reader]
    policy: fetcher-safety
    resources: { maxContextTokens: 32768, maxConcurrentTasks: 3 }

  - name: summarizer
    replicas: { min: 1, max: 2, scaleOn: token_utilization }
    model: qwen2.5:7b
    soul: |
      You are a summarizer agent. Given raw article content, produce clear, concise summaries.
      Extract the key points, main arguments, and important data.
      Keep summaries to 3-5 bullet points per article.
    policy: output-review
    dependsOn: [fetcher]

  - name: classifier
    replicas: { min: 1, max: 1 }
    model: qwen2.5:7b
    soul: |
      You are a classifier agent. Categorize summarized articles by topic, sentiment, and relevance.
      Output a structured classification with: category, sentiment (positive/negative/neutral),
      relevance score (0-1), and key tags.
    policy: default
    dependsOn: [summarizer]

  - name: aggregator
    replicas: { min: 1, max: 1 }
    model: qwen2.5:7b
    soul: |
      You are an aggregator agent. Combine classified articles into a coherent digest.
      Group by category, highlight the most important stories, and provide an executive summary.
    policy: default
    dependsOn: [classifier]

  - name: notifier
    replicas: { min: 1, max: 1 }
    model: qwen2.5:7b
    soul: |
      You are a notifier agent. Format the aggregated digest into a clean notification.
      Include a headline, brief summary, and top 3 stories. Keep it under 500 words.
    policy: default
    dependsOn: [aggregator]
```

---

### Task 9: Integration Test — End to End

**Step 1: Start infrastructure**

```bash
cd /Users/pinetortoise/Desktop/CS5224
docker compose up -d postgres redis nats ollama
# Wait for all services to be healthy
sleep 15
```

**Step 2: Verify Ollama has model**

```bash
curl -s http://localhost:11434/api/tags | python3 -m json.tool
```

Expected: Shows `qwen2.5:7b` in the list.

**Step 3: Build and start control plane**

```bash
cd /Users/pinetortoise/Desktop/CS5224/apps/controlplane
go build -o /tmp/openswarm-controller ./cmd/openswarm-controller
DOCKER_NETWORK=cs5224_default OLLAMA_URL=http://host.docker.internal:11434/v1 /tmp/openswarm-controller
```

Note: `DOCKER_NETWORK` must match the network created by docker-compose (usually `<project>_default` or the custom network name). `OLLAMA_URL` uses `host.docker.internal` for containers to reach the host's Ollama, or the ollama container name if on the same Docker network.

**Step 4: Apply a swarm (in another terminal)**

```bash
cd /Users/pinetortoise/Desktop/CS5224/apps/controlplane
go build -o /tmp/openswarm ./cmd/openswarm
/tmp/openswarm apply ../../examples/news-pipeline/swarm.yaml
```

Expected: Swarm created, containers start spawning.

**Step 5: Check Docker for running OpenClaw containers**

```bash
docker ps --filter label=managed-by=openswarm
```

Expected: Multiple containers with names like `osw-news-pipeline-fetcher-18800`.

**Step 6: Submit a task**

```bash
/tmp/openswarm tasks news-pipeline submit "What are the latest developments in AI regulation?"
```

Expected: Task is submitted, routes to a real OpenClaw instance, returns real LLM output with real token counts.

**Step 7: Verify real output**

```bash
/tmp/openswarm tasks news-pipeline
```

Expected: Task shows status=completed with real output text (not mock), real token count > 0, real latency.

---

## Success Criteria

1. `openswarm apply swarm.yaml` spawns real Docker containers (visible in `docker ps`)
2. Submit a task → get real LLM-generated text (not mock templates)
3. Token counts and latency are real measurements (not estimated)
4. Dashboard shows real data streaming via SSE
5. Kill a container manually → lifecycle manager detects and replaces it within 10 seconds
6. Scale up (increase replicas in swarm.yaml, re-apply) → new containers appear
7. `openswarm down` → all containers cleaned up

## Rollback

If real execution doesn't work (Docker SDK issues, OpenClaw image incompatibility):

- The simulation code is preserved in git history
- Can revert executor.go and lifecycle/manager.go to previous commits
- Pool package is purely additive (new package, doesn't break existing code)
