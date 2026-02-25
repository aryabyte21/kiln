package pool

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/docker/docker/api/types/container"
	dockernetwork "github.com/docker/docker/api/types/network"
	dockerclient "github.com/docker/docker/client"
	"github.com/docker/go-connections/nat"
)

// Instance represents a running OpenClaw Gateway container.
type Instance struct {
	ID          string    // Docker container ID (short, 12 chars)
	Role        string
	SwarmName   string
	Addr        string    // host:port reachable from control plane
	Port        int       // mapped host port
	ContainerID string    // full Docker container ID
	CreatedAt   time.Time
}

// Config holds pool configuration.
type Config struct {
	OpenClawImage string // default: "openclaw:local"
	GatewayToken  string // OPENCLAW_GATEWAY_TOKEN
	NetworkName   string // Docker network to attach containers to
	Model         string // e.g. "groq/llama-3.3-70b-versatile"
	LLMProvider   string // "groq" (default), "openrouter", "ollama", etc.
	LLMBaseURL    string // e.g. "https://api.groq.com/openai/v1"
	LLMApiKey     string // API key for the LLM provider
	WorkspaceDir  string // base dir for agent workspaces
}

// LLMConfig holds resolved LLM provider settings for an OpenClaw container.
type LLMConfig struct {
	Provider string
	BaseURL  string
	APIKey   string
	Model    string
	APIType  string
}

// SettingsReader provides LLM configuration. Pool calls this on every Spawn()
// to get the latest user-configured provider from the database.
type SettingsReader func(ctx context.Context) (*LLMConfig, error)

// Pool manages OpenClaw Gateway Docker containers.
type Pool struct {
	cfg            Config
	docker         *dockerclient.Client
	mu             sync.Mutex
	instances      map[string]*Instance // keyed by short instance ID
	nextPort       int                  // next available host port for mapping
	settingsReader SettingsReader
}

// New creates a Pool connected to the local Docker daemon.
// The optional settingsReader is called on each Spawn() to get the latest LLM config from the DB.
func New(cfg Config, settingsReader ...SettingsReader) (*Pool, error) {
	if cfg.OpenClawImage == "" {
		cfg.OpenClawImage = "openclaw:local"
	}
	if cfg.GatewayToken == "" {
		cfg.GatewayToken = "openswarm-secret"
	}
	if cfg.NetworkName == "" {
		cfg.NetworkName = "openswarm"
	}
	if cfg.WorkspaceDir == "" {
		cfg.WorkspaceDir = "/tmp/openswarm-workspaces"
	}
	if cfg.LLMProvider == "" {
		cfg.LLMProvider = "groq"
	}
	if cfg.LLMBaseURL == "" {
		cfg.LLMBaseURL = "https://api.groq.com/openai/v1"
	}
	if cfg.Model == "" {
		cfg.Model = "llama-3.3-70b-versatile"
	}

	cli, err := dockerclient.NewClientWithOpts(dockerclient.FromEnv, dockerclient.WithAPIVersionNegotiation())
	if err != nil {
		return nil, fmt.Errorf("pool: docker client: %w", err)
	}

	pool := &Pool{
		cfg:       cfg,
		docker:    cli,
		instances: make(map[string]*Instance),
		nextPort:  18800,
	}
	if len(settingsReader) > 0 {
		pool.settingsReader = settingsReader[0]
	}

	// Ensure the Docker network exists (create if missing)
	if err := pool.ensureNetwork(context.Background()); err != nil {
		slog.Warn("pool: could not ensure docker network, containers may fail to start", "network", cfg.NetworkName, "error", err)
	}

	return pool, nil
}

// ensureNetwork creates the Docker network if it doesn't already exist.
func (p *Pool) ensureNetwork(ctx context.Context) error {
	_, err := p.docker.NetworkInspect(ctx, p.cfg.NetworkName, dockernetwork.InspectOptions{})
	if err == nil {
		slog.Info("pool: docker network already exists", "network", p.cfg.NetworkName)
		return nil
	}

	slog.Info("pool: creating docker network", "network", p.cfg.NetworkName)
	_, err = p.docker.NetworkCreate(ctx, p.cfg.NetworkName, dockernetwork.CreateOptions{
		Driver: "bridge",
		Labels: map[string]string{
			"managed-by": "openswarm",
		},
	})
	if err != nil {
		return fmt.Errorf("create network %s: %w", p.cfg.NetworkName, err)
	}
	slog.Info("pool: docker network created", "network", p.cfg.NetworkName)
	return nil
}

// Spawn creates a new OpenClaw Gateway container for the given role.
func (p *Pool) Spawn(ctx context.Context, swarmName, role, soulMD string) (*Instance, error) {
	p.mu.Lock()
	hostPort := p.nextPort
	p.nextPort++
	p.mu.Unlock()

	// Read latest LLM settings from DB (if settingsReader is configured)
	llmCfg := &LLMConfig{
		Provider: p.cfg.LLMProvider,
		BaseURL:  p.cfg.LLMBaseURL,
		APIKey:   p.cfg.LLMApiKey,
		Model:    p.cfg.Model,
		APIType:  "openai-completions",
	}
	if p.settingsReader != nil {
		if dbCfg, err := p.settingsReader(ctx); err == nil && dbCfg.APIKey != "" {
			llmCfg = dbCfg
			slog.Info("pool: using DB settings for LLM", "provider", dbCfg.Provider, "model", dbCfg.Model)
		}
	}

	// Create workspace with openclaw.json config + SOUL.md
	workDir, err := p.createWorkspace(swarmName, role, hostPort, soulMD, llmCfg)
	if err != nil {
		return nil, fmt.Errorf("pool: create workspace: %w", err)
	}

	containerPort := "18789/tcp"
	hostBinding := fmt.Sprintf("%d", hostPort)

	// The state dir inside the container where openclaw.json lives.
	// OPENCLAW_STATE_DIR tells OpenClaw where to find openclaw.json.
	containerStateDir := "/home/node/.openclaw"

	containerCfg := &container.Config{
		Image: p.cfg.OpenClawImage,
		Env: []string{
			fmt.Sprintf("OPENCLAW_GATEWAY_TOKEN=%s", p.cfg.GatewayToken),
			fmt.Sprintf("OPENCLAW_STATE_DIR=%s", containerStateDir),
			"HOME=/home/node",
			"NODE_ENV=production",
			"TERM=xterm-256color",
		},
		ExposedPorts: nat.PortSet{
			nat.Port(containerPort): struct{}{},
		},
		Labels: map[string]string{
			"openswarm.swarm": swarmName,
			"openswarm.role":  role,
			"managed-by":      "openswarm",
		},
		Cmd: []string{
			"node", "openclaw.mjs", "gateway",
			"--allow-unconfigured",
			"--bind", "lan",
			"--port", "18789",
		},
	}

	hostCfg := &container.HostConfig{
		PortBindings: nat.PortMap{
			nat.Port(containerPort): []nat.PortBinding{
				{HostIP: "0.0.0.0", HostPort: hostBinding},
			},
		},
		Binds: []string{
			fmt.Sprintf("%s:%s", workDir, containerStateDir),
		},
		// Enable host.docker.internal for macOS/Windows Docker Desktop
		// so containers can reach the host's Ollama instance
		ExtraHosts: []string{"host.docker.internal:host-gateway"},
	}

	networkCfg := &dockernetwork.NetworkingConfig{
		EndpointsConfig: map[string]*dockernetwork.EndpointSettings{
			p.cfg.NetworkName: {},
		},
	}

	containerName := fmt.Sprintf("osw-%s-%s-%d", swarmName, role, hostPort)

	resp, err := p.docker.ContainerCreate(ctx, containerCfg, hostCfg, networkCfg, nil, containerName)
	if err != nil {
		return nil, fmt.Errorf("pool: create container: %w", err)
	}

	if err := p.docker.ContainerStart(ctx, resp.ID, container.StartOptions{}); err != nil {
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

	timeout := 10
	if err := p.docker.ContainerStop(ctx, inst.ContainerID, container.StopOptions{Timeout: &timeout}); err != nil {
		slog.Warn("pool: stop container failed, forcing", "id", instanceID, "error", err)
	}

	if err := p.docker.ContainerRemove(ctx, inst.ContainerID, container.RemoveOptions{Force: true}); err != nil {
		return fmt.Errorf("pool: remove container %s: %w", instanceID, err)
	}

	workDir := filepath.Join(p.cfg.WorkspaceDir, fmt.Sprintf("%s-%s-%d", inst.SwarmName, inst.Role, inst.Port))
	_ = os.RemoveAll(workDir)

	slog.Info("pool: terminated instance", "id", instanceID, "role", inst.Role)
	return nil
}

// HealthCheck pings the OpenClaw Gateway health endpoint.
// OpenClaw exposes /v1/chat/completions (POST) but we use a lightweight
// TCP connect + GET to the root to verify the process is up.
func (p *Pool) HealthCheck(ctx context.Context, inst *Instance) bool {
	// Try the OpenClaw /healthz first (may not exist on all versions)
	url := fmt.Sprintf("http://%s/healthz", inst.Addr)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return false
	}

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		// Fallback: check if the port is responsive at all (any HTTP response)
		fallbackURL := fmt.Sprintf("http://%s/", inst.Addr)
		fallbackReq, reqErr := http.NewRequestWithContext(ctx, http.MethodGet, fallbackURL, nil)
		if reqErr != nil {
			return false
		}
		fallbackResp, fallbackErr := client.Do(fallbackReq)
		if fallbackErr != nil {
			return false
		}
		defer fallbackResp.Body.Close()
		// Any response means the Gateway process is up
		return true
	}
	defer resp.Body.Close()
	return resp.StatusCode == http.StatusOK || resp.StatusCode == http.StatusNotFound
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

// RecoverExisting discovers and re-tracks OpenClaw containers previously
// spawned by OpenSwarm (identified by "managed-by=openswarm" label).
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

// TerminateRecovered finds and terminates all stale OpenSwarm-managed containers
// from a previous control plane run. Called on startup to ensure a clean slate.
func (p *Pool) TerminateRecovered(ctx context.Context) error {
	containers, err := p.docker.ContainerList(ctx, container.ListOptions{})
	if err != nil {
		return fmt.Errorf("pool: list containers: %w", err)
	}

	count := 0
	timeout := 10
	for _, c := range containers {
		if c.Labels["managed-by"] != "openswarm" {
			continue
		}
		slog.Info("pool: terminating stale container",
			"id", c.ID[:12],
			"role", c.Labels["openswarm.role"],
			"swarm", c.Labels["openswarm.swarm"])
		_ = p.docker.ContainerStop(ctx, c.ID, container.StopOptions{Timeout: &timeout})
		_ = p.docker.ContainerRemove(ctx, c.ID, container.RemoveOptions{Force: true})
		count++
	}

	if count > 0 {
		slog.Info("pool: cleaned up stale containers", "count", count)
	}
	return nil
}

// Close releases the Docker client.
func (p *Pool) Close() error {
	return p.docker.Close()
}

// createWorkspace generates the OpenClaw config directory with openclaw.json and SOUL.md.
// This directory is mounted into the container as OPENCLAW_STATE_DIR.
func (p *Pool) createWorkspace(swarmName, role string, port int, soulMD string, llm *LLMConfig) (string, error) {
	instanceDir := filepath.Join(p.cfg.WorkspaceDir, fmt.Sprintf("%s-%s-%d", swarmName, role, port))
	if err := os.MkdirAll(instanceDir, 0o755); err != nil {
		return "", fmt.Errorf("create workspace dir: %w", err)
	}

	// Create workspace subdirectory (OpenClaw expects this)
	workspaceDir := filepath.Join(instanceDir, "workspace")
	if err := os.MkdirAll(workspaceDir, 0o755); err != nil {
		return "", fmt.Errorf("create workspace subdir: %w", err)
	}

	// Write SOUL.md into the workspace
	if soulMD == "" {
		soulMD = fmt.Sprintf("You are a %s agent in the %s swarm. Complete tasks assigned to you thoroughly and accurately.", role, swarmName)
	}
	if err := os.WriteFile(filepath.Join(workspaceDir, "SOUL.md"), []byte(soulMD), 0o644); err != nil {
		return "", fmt.Errorf("write SOUL.md: %w", err)
	}

	// Write openclaw.json — the OpenClaw config file.
	// Config file path: OPENCLAW_STATE_DIR/openclaw.json
	// Model format: "provider/model-name" e.g. "groq/llama-3.3-70b-versatile"
	apiType := llm.APIType
	if apiType == "" {
		apiType = "openai-completions"
	}
	modelRef := fmt.Sprintf("%s/%s", llm.Provider, llm.Model)
	config := map[string]interface{}{
		"gateway": map[string]interface{}{
			"controlUi": map[string]interface{}{
				// Required for non-loopback bind (--bind lan)
				"dangerouslyAllowHostHeaderOriginFallback": true,
				// Allow token-only auth over HTTP when device identity is unavailable.
				"allowInsecureAuth": true,
				// Disable device pairing entirely — containers are behind our
				// proxy which injects the gateway token automatically.
				"dangerouslyDisableDeviceAuth": true,
			},
			"http": map[string]interface{}{
				"endpoints": map[string]interface{}{
					// Enable OpenAI-compatible /v1/chat/completions HTTP endpoint
					"chatCompletions": map[string]interface{}{"enabled": true},
				},
			},
		},
		"agents": map[string]interface{}{
			"defaults": map[string]interface{}{
				"model": map[string]interface{}{
					"primary": modelRef,
				},
			},
		},
		"models": map[string]interface{}{
			"mode": "merge",
			"providers": map[string]interface{}{
				llm.Provider: map[string]interface{}{
					"baseUrl": llm.BaseURL,
					"apiKey":  llm.APIKey,
					"api":     apiType,
					"models": []map[string]interface{}{
						{
							"id":            llm.Model,
							"name":          llm.Model,
							"reasoning":     false,
							"input":         []string{"text"},
							"cost":          map[string]interface{}{"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0},
							"contextWindow": 131072,
							"maxTokens":     8192,
						},
					},
				},
			},
		},
	}

	configJSON, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return "", fmt.Errorf("marshal openclaw.json: %w", err)
	}
	if err := os.WriteFile(filepath.Join(instanceDir, "openclaw.json"), configJSON, 0o644); err != nil {
		return "", fmt.Errorf("write openclaw.json: %w", err)
	}

	return instanceDir, nil
}
