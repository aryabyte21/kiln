package api

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"time"

	"github.com/openswarm/openswarm/internal/budget"
	"github.com/openswarm/openswarm/internal/bus"
	"github.com/openswarm/openswarm/internal/config"
	"github.com/openswarm/openswarm/internal/domain"
	"github.com/openswarm/openswarm/internal/genetics"
	"github.com/openswarm/openswarm/internal/lifecycle"
	"github.com/openswarm/openswarm/internal/pool"
	"github.com/openswarm/openswarm/internal/registry"
	"github.com/openswarm/openswarm/internal/sse"
	"github.com/openswarm/openswarm/internal/store"
)

// Config holds all configuration for the API server.
type Config struct {
	Version           string
	DatabaseURL       string
	RedisURL          string
	NatsURL           string
	OpenClawInstances string
	OpenClawToken     string
}

// Server is the OpenSwarm control plane HTTP server.
type Server struct {
	config    Config
	store     *store.Store
	registry  *registry.Registry
	bus       *bus.Bus
	hub       *sse.Hub
	budget    *budget.Tracker
	lifecycle *lifecycle.Manager
	genetics  *genetics.Engine
	pool      *pool.Pool
}

// NewServer creates a new API server with the given dependencies.
func NewServer(cfg Config, st *store.Store, reg *registry.Registry, b *bus.Bus, hub *sse.Hub, bt *budget.Tracker, lm *lifecycle.Manager, ge *genetics.Engine, p *pool.Pool) *Server {
	return &Server{
		config:    cfg,
		store:     st,
		registry:  reg,
		bus:       b,
		hub:       hub,
		budget:    bt,
		lifecycle: lm,
		genetics:  ge,
		pool:      p,
	}
}

// Router returns the HTTP handler with all routes registered.
func (s *Server) Router() http.Handler {
	mux := http.NewServeMux()

	// Health check
	mux.HandleFunc("GET /healthz", s.handleHealthz)

	// Swarm lifecycle
	mux.HandleFunc("POST /api/v1/swarms", s.handleCreateSwarm)
	mux.HandleFunc("GET /api/v1/swarms", s.handleListSwarms)
	mux.HandleFunc("GET /api/v1/swarms/{name}", s.handleGetSwarm)
	mux.HandleFunc("DELETE /api/v1/swarms/{name}", s.handleDeleteSwarm)

	// Agent management
	mux.HandleFunc("GET /api/v1/swarms/{name}/agents", s.handleListAgents)
	mux.HandleFunc("GET /api/v1/swarms/{name}/agents/{id}", s.handleGetAgent)
	mux.HandleFunc("POST /api/v1/swarms/{name}/agents/{role}/scale", s.handleScaleAgent)

	// Tasks
	mux.HandleFunc("POST /api/v1/swarms/{name}/tasks", s.handleSubmitTask)
	mux.HandleFunc("GET /api/v1/swarms/{name}/tasks", s.handleListTasks)
	mux.HandleFunc("GET /api/v1/swarms/{name}/tasks/{id}", s.handleGetTask)

	// Budget
	mux.HandleFunc("GET /api/v1/swarms/{name}/budget", s.handleGetBudget)

	// Audit
	mux.HandleFunc("GET /api/v1/swarms/{name}/audit", s.handleGetAudit)
	mux.HandleFunc("GET /api/v1/swarms/{name}/audit/verify", s.handleVerifyAudit)

	// Genetics
	mux.HandleFunc("GET /api/v1/swarms/{name}/genomes", s.handleListGenomes)
	mux.HandleFunc("POST /api/v1/swarms/{name}/genomes/evolve", s.handleEvolveGenomes)
	mux.HandleFunc("GET /api/v1/swarms/{name}/genomes/{id}", s.handleGetGenome)

	// Policies
	mux.HandleFunc("POST /api/v1/policies", s.handleCreatePolicy)
	mux.HandleFunc("GET /api/v1/policies", s.handleListPolicies)
	mux.HandleFunc("GET /api/v1/policies/{name}", s.handleGetPolicy)

	// Containers (Docker)
	mux.HandleFunc("GET /api/v1/swarms/{name}/containers", s.handleListContainers)
	mux.HandleFunc("GET /api/v1/containers/{id}", s.handleGetContainer)
	mux.HandleFunc("POST /api/v1/containers/{id}/chat", s.handleContainerChat)
	mux.HandleFunc("/api/v1/containers/{id}/ui/", s.handleContainerUIProxy)
	mux.HandleFunc("/api/v1/containers/{id}/ui", s.handleContainerUIRedirect)
	mux.HandleFunc("/ws/containers/{id}", s.handleContainerWSProxy) // WebSocket gateway for OpenClaw UI

	// Settings (LLM providers, platform config)
	mux.HandleFunc("GET /api/v1/settings", s.handleGetSettings)
	mux.HandleFunc("PUT /api/v1/settings", s.handleSaveSettings)
	mux.HandleFunc("GET /api/v1/providers", s.handleListProviders)

	// Prometheus metrics
	mux.HandleFunc("GET /metrics", s.handleMetrics)

	// SSE event stream
	mux.HandleFunc("GET /api/v1/swarms/{name}/events", s.handleSSEEvents)

	return corsMiddleware(mux)
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

func (s *Server) handleHealthz(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{
		"status":  "ok",
		"service": "openswarm-controller",
		"version": s.config.Version,
	})
}

// ---------------------------------------------------------------------------
// Swarms
// ---------------------------------------------------------------------------

func (s *Server) handleCreateSwarm(w http.ResponseWriter, r *http.Request) {
	var manifest domain.SwarmManifest
	if err := json.NewDecoder(r.Body).Decode(&manifest); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body: " + err.Error()})
		return
	}

	sw := &domain.Swarm{
		Name:   manifest.Metadata.Name,
		Status: domain.SwarmStatusPending,
		Spec:   manifest.Spec,
	}

	// Upsert: if the swarm already exists, terminate its containers and delete it first
	if existing, err := s.store.GetSwarmByName(r.Context(), sw.Name); err == nil && existing != nil {
		slog.Info("swarm already exists, replacing", "name", sw.Name)
		// Terminate any running containers
		instances := s.pool.ListBySwarm(sw.Name)
		for _, inst := range instances {
			_ = s.registry.Deregister(r.Context(), sw.Name, inst.ID)
			_ = s.pool.Terminate(r.Context(), inst.ID)
		}
		_ = s.store.DeleteSwarm(r.Context(), sw.Name)
	}

	if err := s.store.CreateSwarm(r.Context(), sw); err != nil {
		slog.Error("create swarm failed", "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	// Initialize budget tracking in Redis
	if err := s.budget.InitBudget(r.Context(), sw.Name,
		sw.Spec.Budget.Total, sw.Spec.Budget.AlertAt, sw.Spec.Budget.HardStop); err != nil {
		slog.Error("init budget failed", "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to initialize budget: " + err.Error()})
		return
	}

	// Register agents and start the swarm
	if err := s.lifecycle.RegisterSwarmAgents(r.Context(), sw.Name, sw.Spec); err != nil {
		slog.Error("register agents failed", "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to register agents: " + err.Error()})
		return
	}

	// Broadcast swarm creation to SSE clients
	s.hub.Broadcast(sw.Name, sse.Event{
		Type: "swarm_created",
		Data: sw,
	})

	slog.Info("swarm created", "name", sw.Name, "id", sw.ID)
	writeJSON(w, http.StatusCreated, sw)
}

func (s *Server) handleListSwarms(w http.ResponseWriter, r *http.Request) {
	swarms, err := s.store.ListSwarms(r.Context())
	if err != nil {
		slog.Error("list swarms failed", "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if swarms == nil {
		swarms = []domain.Swarm{}
	}
	writeJSON(w, http.StatusOK, swarms)
}

func (s *Server) handleGetSwarm(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	sw, err := s.store.GetSwarmByName(r.Context(), name)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, sw)
}

func (s *Server) handleDeleteSwarm(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if err := s.store.DeleteSwarm(r.Context(), name); err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
		return
	}
	slog.Info("swarm deleted", "name", name)
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted", "name": name})
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

func (s *Server) handleListAgents(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	agents, err := s.registry.ListAgentsBySwarm(r.Context(), name)
	if err != nil {
		slog.Error("list agents failed", "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if agents == nil {
		agents = []domain.Agent{}
	}
	writeJSON(w, http.StatusOK, agents)
}

func (s *Server) handleGetAgent(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	id := r.PathValue("id")
	agent, err := s.registry.GetAgent(r.Context(), name, id)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
		return
	}

	health, _ := s.registry.GetHealth(r.Context(), name, id)
	writeJSON(w, http.StatusOK, map[string]any{
		"agent":  agent,
		"health": health,
	})
}

func (s *Server) handleScaleAgent(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusNotImplemented, map[string]string{"error": "scaling not yet implemented"})
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

func (s *Server) handleSubmitTask(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")

	var sub domain.TaskSubmission
	if err := json.NewDecoder(r.Body).Decode(&sub); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body: " + err.Error()})
		return
	}
	sub.SwarmName = name

	// Determine agent role — if not specified, use first agent in spec
	if sub.AgentRole == "" {
		sw, err := s.store.GetSwarmByName(r.Context(), name)
		if err != nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
			return
		}
		if len(sw.Spec.Agents) > 0 {
			sub.AgentRole = sw.Spec.Agents[0].Name
		}
	}

	task := &domain.Task{
		SwarmName: sub.SwarmName,
		AgentRole: sub.AgentRole,
		Input:     sub.Input,
		Status:    domain.TaskStatusPending,
		Metadata:  sub.Metadata,
	}

	if err := s.store.CreateTask(r.Context(), task); err != nil {
		slog.Error("create task failed", "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	// Publish task to NATS for scheduler pickup
	subject := fmt.Sprintf("swarm.%s.task.submit", name)
	if err := s.bus.PublishJSON(r.Context(), subject, task); err != nil {
		slog.Error("publish task failed", "error", err, "subject", subject)
	}

	// Broadcast task creation to SSE clients
	s.hub.Broadcast(name, sse.Event{
		Type: "task_submitted",
		Data: task,
	})

	slog.Info("task submitted", "id", task.ID, "swarm", name, "role", task.AgentRole)
	writeJSON(w, http.StatusCreated, task)
}

func (s *Server) handleListTasks(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	tasks, err := s.store.ListTasksBySwarm(r.Context(), name)
	if err != nil {
		slog.Error("list tasks failed", "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if tasks == nil {
		tasks = []domain.Task{}
	}
	writeJSON(w, http.StatusOK, tasks)
}

func (s *Server) handleGetTask(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	task, err := s.store.GetTaskByID(r.Context(), id)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, task)
}

// ---------------------------------------------------------------------------
// Budget, Audit, Genetics — stubs
// ---------------------------------------------------------------------------

func (s *Server) handleGetBudget(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	state, err := s.budget.GetBudget(r.Context(), name)
	if err != nil {
		slog.Error("get budget failed", "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, state)
}
func (s *Server) handleGetAudit(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, []any{})
}
func (s *Server) handleVerifyAudit(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusNotImplemented, map[string]string{"error": "not yet implemented"})
}
func (s *Server) handleListGenomes(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	genomes, err := s.genetics.ListGenomes(r.Context(), name)
	if err != nil {
		slog.Error("list genomes failed", "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if genomes == nil {
		genomes = []genetics.Genome{}
	}
	writeJSON(w, http.StatusOK, genomes)
}

func (s *Server) handleEvolveGenomes(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")

	var req struct {
		AgentRole string `json:"agentRole"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body: " + err.Error()})
		return
	}
	if req.AgentRole == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "agentRole is required"})
		return
	}

	children, err := s.genetics.Evolve(r.Context(), name, req.AgentRole)
	if err != nil {
		slog.Error("evolve genomes failed", "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	slog.Info("genomes evolved", "swarm", name, "role", req.AgentRole, "children", len(children))
	writeJSON(w, http.StatusOK, children)
}

func (s *Server) handleGetGenome(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	genome, err := s.genetics.GetGenome(r.Context(), id)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, genome)
}

// ---------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------

func (s *Server) handleCreatePolicy(w http.ResponseWriter, r *http.Request) {
	var manifest domain.PolicyManifest
	if err := json.NewDecoder(r.Body).Decode(&manifest); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body: " + err.Error()})
		return
	}

	if _, err := config.ParsePolicyManifest(mustMarshal(manifest)); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	p := &domain.Policy{
		Name: manifest.Metadata.Name,
		Spec: manifest.Spec,
	}

	if err := s.store.CreatePolicy(r.Context(), p); err != nil {
		slog.Error("create policy failed", "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	slog.Info("policy created", "name", p.Name, "id", p.ID)
	writeJSON(w, http.StatusCreated, p)
}

func (s *Server) handleListPolicies(w http.ResponseWriter, r *http.Request) {
	policies, err := s.store.ListPolicies(r.Context())
	if err != nil {
		slog.Error("list policies failed", "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if policies == nil {
		policies = []domain.Policy{}
	}
	writeJSON(w, http.StatusOK, policies)
}

func (s *Server) handleGetPolicy(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	p, err := s.store.GetPolicyByName(r.Context(), name)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, p)
}

// ---------------------------------------------------------------------------
// Containers (Docker)
// ---------------------------------------------------------------------------

func (s *Server) handleListContainers(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	instances := s.pool.ListBySwarm(name)

	type containerInfo struct {
		ID        string    `json:"id"`
		Role      string    `json:"role"`
		Addr      string    `json:"addr"`
		Port      int       `json:"port"`
		Healthy   bool      `json:"healthy"`
		CreatedAt time.Time `json:"createdAt"`
	}

	result := make([]containerInfo, 0, len(instances))
	for _, inst := range instances {
		healthy := s.pool.HealthCheck(r.Context(), inst)
		result = append(result, containerInfo{
			ID:        inst.ID,
			Role:      inst.Role,
			Addr:      inst.Addr,
			Port:      inst.Port,
			Healthy:   healthy,
			CreatedAt: inst.CreatedAt,
		})
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleGetContainer(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	inst, ok := s.pool.Get(id)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "container not found"})
		return
	}
	healthy := s.pool.HealthCheck(r.Context(), inst)
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"id":        inst.ID,
		"role":      inst.Role,
		"swarmName": inst.SwarmName,
		"addr":      inst.Addr,
		"port":      inst.Port,
		"healthy":   healthy,
		"createdAt": inst.CreatedAt,
	})
}

// ---------------------------------------------------------------------------
// Container Chat Proxy
// ---------------------------------------------------------------------------

// handleContainerChat proxies chat requests to an OpenClaw container's
// /v1/chat/completions endpoint, injecting the gateway token automatically.
// The frontend sends: { "messages": [{"role":"user","content":"..."}] }
func (s *Server) handleContainerChat(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	inst, ok := s.pool.Get(id)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "container not found"})
		return
	}

	// Read the request body from the frontend
	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "failed to read body"})
		return
	}
	defer r.Body.Close()

	// Parse to inject model field if missing
	var chatReq map[string]interface{}
	if err := json.Unmarshal(body, &chatReq); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
		return
	}
	if _, ok := chatReq["model"]; !ok {
		chatReq["model"] = "openclaw"
	}
	if _, ok := chatReq["stream"]; !ok {
		chatReq["stream"] = false
	}
	body, _ = json.Marshal(chatReq)

	// Forward to OpenClaw container
	url := fmt.Sprintf("http://%s/v1/chat/completions", inst.Addr)
	proxyReq, err := http.NewRequestWithContext(r.Context(), http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to create proxy request"})
		return
	}
	proxyReq.Header.Set("Content-Type", "application/json")
	if s.config.OpenClawToken != "" {
		proxyReq.Header.Set("Authorization", "Bearer "+s.config.OpenClawToken)
	}

	client := &http.Client{Timeout: 120 * time.Second}
	resp, err := client.Do(proxyReq)
	if err != nil {
		slog.Error("chat proxy: http call failed", "container", id, "addr", inst.Addr, "error", err)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": fmt.Sprintf("failed to reach container: %v", err)})
		return
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	// Forward the response as-is
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.WriteHeader(resp.StatusCode)
	w.Write(respBody)
}

// ---------------------------------------------------------------------------
// Container UI Proxy — reverse-proxies the full OpenClaw WebUI with auth
// ---------------------------------------------------------------------------

func (s *Server) handleContainerUIRedirect(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	// Simple redirect to the trailing-slash version.
	// The localStorage injection happens in handleContainerUIProxy's ModifyResponse.
	http.Redirect(w, r, fmt.Sprintf("/api/v1/containers/%s/ui/", id), http.StatusTemporaryRedirect)
}

// handleContainerWSProxy is a dedicated WebSocket proxy endpoint for
// the OpenClaw control UI. The frontend JS connects to ws://{host}/ws/containers/{id}
// and we proxy it to the actual OpenClaw container with auth injected.
func (s *Server) handleContainerWSProxy(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	inst, ok := s.pool.Get(id)
	if !ok {
		http.Error(w, "container not found", http.StatusNotFound)
		return
	}

	if !isWebSocketUpgrade(r) {
		http.Error(w, "websocket upgrade required", http.StatusBadRequest)
		return
	}

	// Inject the gateway token into query params for upstream
	q := r.URL.Query()
	if s.config.OpenClawToken != "" {
		q.Set("apiKey", s.config.OpenClawToken)
	}

	s.proxyWebSocket(w, r, inst.Addr, "/", q.Encode())
}

// handleContainerUIProxy reverse-proxies all requests (HTTP + WebSocket) to
// the OpenClaw container's WebUI, injecting the gateway token automatically.
func (s *Server) handleContainerUIProxy(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	inst, ok := s.pool.Get(id)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "container not found"})
		return
	}

	// Strip the /api/v1/containers/{id}/ui prefix from the path
	prefix := fmt.Sprintf("/api/v1/containers/%s/ui", id)
	originalPath := r.URL.Path
	strippedPath := strings.TrimPrefix(originalPath, prefix)
	if strippedPath == "" {
		strippedPath = "/"
	}

	// Inject gateway token into query params
	q := r.URL.Query()
	if s.config.OpenClawToken != "" {
		q.Set("apiKey", s.config.OpenClawToken)
	}

	// WebSocket upgrade — use raw TCP hijack proxy
	if isWebSocketUpgrade(r) {
		s.proxyWebSocket(w, r, inst.Addr, strippedPath, q.Encode())
		return
	}

	// Regular HTTP — use httputil.ReverseProxy
	target, err := url.Parse(fmt.Sprintf("http://%s", inst.Addr))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "bad container addr"})
		return
	}

	// Build the WebSocket gateway URL for this container
	wsScheme := "ws"
	if r.TLS != nil {
		wsScheme = "wss"
	}
	wsGatewayURL := fmt.Sprintf("%s://%s/ws/containers/%s", wsScheme, r.Host, id)

	proxy := &httputil.ReverseProxy{
		Director: func(req *http.Request) {
			req.URL.Scheme = target.Scheme
			req.URL.Host = target.Host
			req.URL.Path = strippedPath
			req.URL.RawQuery = q.Encode()
			req.Host = target.Host

			if s.config.OpenClawToken != "" {
				req.Header.Set("Authorization", "Bearer "+s.config.OpenClawToken)
			}
		},
		ModifyResponse: func(resp *http.Response) error {
			resp.Header.Del("X-Frame-Options")
			resp.Header.Del("Content-Security-Policy")
			resp.Header.Set("Access-Control-Allow-Origin", "*")

			// For HTML responses, inject a script that pre-sets localStorage
			// with the correct gatewayUrl and token so the OpenClaw UI connects
			// through our WebSocket proxy without requiring manual pairing.
			ct := resp.Header.Get("Content-Type")
			if strings.Contains(ct, "text/html") {
				body, err := io.ReadAll(resp.Body)
				resp.Body.Close()
				if err != nil {
					return err
				}

				// Script that pre-configures OpenClaw settings in localStorage
				script := fmt.Sprintf(`<script>
(function(){
  var k="openclaw.control.settings.v1";
  var s={};
  try{s=JSON.parse(localStorage.getItem(k)||"{}")}catch(e){}
  s.gatewayUrl=%q;
  s.token=%q;
  localStorage.setItem(k,JSON.stringify(s));
})();
</script>`, wsGatewayURL, s.config.OpenClawToken)

				// Inject after <head> tag
				html := string(body)
				html = strings.Replace(html, "<head>", "<head>"+script, 1)

				resp.Body = io.NopCloser(strings.NewReader(html))
				resp.ContentLength = int64(len(html))
				resp.Header.Set("Content-Length", fmt.Sprintf("%d", len(html)))
			}

			return nil
		},
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			slog.Error("ui proxy error", "container", id, "path", strippedPath, "error", err)
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": fmt.Sprintf("proxy error: %v", err)})
		},
	}

	proxy.ServeHTTP(w, r)
}

// isWebSocketUpgrade returns true if the request is a WebSocket upgrade.
func isWebSocketUpgrade(r *http.Request) bool {
	return strings.EqualFold(r.Header.Get("Upgrade"), "websocket") &&
		strings.Contains(strings.ToLower(r.Header.Get("Connection")), "upgrade")
}

// proxyWebSocket hijacks the client connection and establishes a raw TCP
// tunnel to the upstream OpenClaw container for WebSocket traffic.
func (s *Server) proxyWebSocket(w http.ResponseWriter, r *http.Request, addr, path, rawQuery string) {
	// Connect to the upstream OpenClaw container
	upstreamConn, err := net.DialTimeout("tcp", addr, 10*time.Second)
	if err != nil {
		slog.Error("ws proxy: dial upstream", "addr", addr, "error", err)
		http.Error(w, "upstream unreachable", http.StatusBadGateway)
		return
	}
	defer upstreamConn.Close()

	// Build the upgrade request to send to upstream
	reqURL := path
	if rawQuery != "" {
		reqURL = path + "?" + rawQuery
	}

	// Write the HTTP upgrade request to upstream
	var upBuf bytes.Buffer
	fmt.Fprintf(&upBuf, "%s %s HTTP/1.1\r\n", r.Method, reqURL)
	fmt.Fprintf(&upBuf, "Host: %s\r\n", addr)
	for key, vals := range r.Header {
		// Skip hop-by-hop headers that shouldn't be forwarded as-is
		// but keep Connection and Upgrade for WebSocket
		for _, val := range vals {
			fmt.Fprintf(&upBuf, "%s: %s\r\n", key, val)
		}
	}
	if s.config.OpenClawToken != "" {
		fmt.Fprintf(&upBuf, "Authorization: Bearer %s\r\n", s.config.OpenClawToken)
	}
	fmt.Fprintf(&upBuf, "\r\n")

	if _, err := upstreamConn.Write(upBuf.Bytes()); err != nil {
		slog.Error("ws proxy: write upgrade", "error", err)
		http.Error(w, "upstream write failed", http.StatusBadGateway)
		return
	}

	// Read the upstream response
	upReader := bufio.NewReader(upstreamConn)
	upResp, err := http.ReadResponse(upReader, r)
	if err != nil {
		slog.Error("ws proxy: read upstream response", "error", err)
		http.Error(w, "upstream response failed", http.StatusBadGateway)
		return
	}

	if upResp.StatusCode != http.StatusSwitchingProtocols {
		slog.Error("ws proxy: upstream rejected upgrade", "status", upResp.StatusCode)
		w.WriteHeader(upResp.StatusCode)
		io.Copy(w, upResp.Body)
		upResp.Body.Close()
		return
	}

	// Hijack the client connection
	hj, ok := w.(http.Hijacker)
	if !ok {
		slog.Error("ws proxy: response writer does not support hijack")
		http.Error(w, "hijack not supported", http.StatusInternalServerError)
		return
	}
	clientConn, clientBuf, err := hj.Hijack()
	if err != nil {
		slog.Error("ws proxy: hijack failed", "error", err)
		return
	}
	defer clientConn.Close()

	// Forward the 101 Switching Protocols response to the client
	var respBuf bytes.Buffer
	fmt.Fprintf(&respBuf, "HTTP/1.1 101 Switching Protocols\r\n")
	for key, vals := range upResp.Header {
		for _, val := range vals {
			fmt.Fprintf(&respBuf, "%s: %s\r\n", key, val)
		}
	}
	fmt.Fprintf(&respBuf, "\r\n")
	clientBuf.Write(respBuf.Bytes())
	clientBuf.Flush()

	// Bidirectional copy: client <-> upstream
	done := make(chan struct{}, 2)
	go func() {
		io.Copy(upstreamConn, clientConn)
		done <- struct{}{}
	}()
	go func() {
		// Drain any buffered data from the upstream reader first
		if upReader.Buffered() > 0 {
			buffered := make([]byte, upReader.Buffered())
			upReader.Read(buffered)
			clientConn.Write(buffered)
		}
		io.Copy(clientConn, upstreamConn)
		done <- struct{}{}
	}()

	// Wait for either direction to close
	<-done
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

func (s *Server) handleMetrics(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain")
	fmt.Fprintln(w, "# OpenSwarm metrics placeholder")
}

// ---------------------------------------------------------------------------
// SSE Events
// ---------------------------------------------------------------------------

func (s *Server) handleSSEEvents(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	s.hub.ServeSwarm(w, r, name)
}

// Hub returns the SSE hub for external integration (e.g. NATS bridge).
func (s *Server) Hub() *sse.Hub {
	return s.hub
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func mustMarshal(v any) []byte {
	data, _ := json.Marshal(v)
	return data
}

// ---------------------------------------------------------------------------
// Settings (LLM providers, platform config)
// ---------------------------------------------------------------------------

func (s *Server) handleGetSettings(w http.ResponseWriter, r *http.Request) {
	settings, err := s.store.GetSettings(r.Context(), "global")
	if err != nil {
		// Return empty settings if none exist yet
		writeJSON(w, http.StatusOK, domain.PlatformSettings{})
		return
	}
	// Mask the API key for security (show last 4 chars only)
	if len(settings.LLM.APIKey) > 4 {
		settings.LLM.APIKey = "***" + settings.LLM.APIKey[len(settings.LLM.APIKey)-4:]
	}
	writeJSON(w, http.StatusOK, settings)
}

func (s *Server) handleSaveSettings(w http.ResponseWriter, r *http.Request) {
	var incoming domain.PlatformSettings
	if err := json.NewDecoder(r.Body).Decode(&incoming); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON: " + err.Error()})
		return
	}

	// If the API key is masked (starts with ***), keep the existing key
	if len(incoming.LLM.APIKey) > 0 && incoming.LLM.APIKey[:3] == "***" {
		existing, err := s.store.GetSettings(r.Context(), "global")
		if err == nil {
			incoming.LLM.APIKey = existing.LLM.APIKey
		}
	}

	// Auto-fill baseURL and apiType for known providers
	for _, kp := range domain.KnownProviders {
		if kp.ID == incoming.LLM.Provider {
			if incoming.LLM.BaseURL == "" {
				incoming.LLM.BaseURL = kp.BaseURL
			}
			if incoming.LLM.APIType == "" {
				incoming.LLM.APIType = kp.APIType
			}
			break
		}
	}

	if err := s.store.SaveSettings(r.Context(), "global", &incoming); err != nil {
		slog.Error("save settings failed", "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	slog.Info("settings saved", "provider", incoming.LLM.Provider, "model", incoming.LLM.Model)
	writeJSON(w, http.StatusOK, map[string]string{"status": "saved"})
}

func (s *Server) handleListProviders(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, domain.KnownProviders)
}
