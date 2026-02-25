package api

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"

	"github.com/openswarm/openswarm/internal/budget"
	"github.com/openswarm/openswarm/internal/bus"
	"github.com/openswarm/openswarm/internal/config"
	"github.com/openswarm/openswarm/internal/domain"
	"github.com/openswarm/openswarm/internal/genetics"
	"github.com/openswarm/openswarm/internal/lifecycle"
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
}

// NewServer creates a new API server with the given dependencies.
func NewServer(cfg Config, st *store.Store, reg *registry.Registry, b *bus.Bus, hub *sse.Hub, bt *budget.Tracker, lm *lifecycle.Manager, ge *genetics.Engine) *Server {
	return &Server{
		config:    cfg,
		store:     st,
		registry:  reg,
		bus:       b,
		hub:       hub,
		budget:    bt,
		lifecycle: lm,
		genetics:  ge,
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
