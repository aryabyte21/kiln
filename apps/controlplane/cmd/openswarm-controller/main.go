package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/nats-io/nats.go/jetstream"

	"github.com/openswarm/openswarm/internal/api"
	"github.com/openswarm/openswarm/internal/audit"
	"github.com/openswarm/openswarm/internal/budget"
	"github.com/openswarm/openswarm/internal/bus"
	"github.com/openswarm/openswarm/internal/executor"
	"github.com/openswarm/openswarm/internal/genetics"
	"github.com/openswarm/openswarm/internal/lifecycle"
	"github.com/openswarm/openswarm/internal/pool"
	"github.com/openswarm/openswarm/internal/registry"
	"github.com/openswarm/openswarm/internal/scheduler"
	"github.com/openswarm/openswarm/internal/sse"
	"github.com/openswarm/openswarm/internal/store"
)

var version = "0.1.1-dev"

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
	slog.SetDefault(logger)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	port := getEnv("PORT", "9090")
	databaseURL := getEnv("DATABASE_URL", "postgres://openswarm:openswarm@localhost:5432/openswarm?sslmode=disable")
	redisURL := getEnv("REDIS_URL", "redis://localhost:6379")
	natsURL := getEnv("NATS_URL", "nats://localhost:4222")

	// -----------------------------------------------------------------------
	// Connect to infrastructure
	// -----------------------------------------------------------------------

	// PostgreSQL
	st, err := store.New(ctx, databaseURL)
	if err != nil {
		slog.Error("failed to connect to PostgreSQL", "error", err)
		os.Exit(1)
	}
	defer st.Close()
	slog.Info("connected to PostgreSQL")

	// Run migrations
	if err := st.RunMigrations(ctx); err != nil {
		slog.Error("failed to run migrations", "error", err)
		os.Exit(1)
	}
	slog.Info("database migrations applied")

	// Redis (agent registry)
	reg, err := registry.New(ctx, redisURL)
	if err != nil {
		slog.Error("failed to connect to Redis", "error", err)
		os.Exit(1)
	}
	defer reg.Close()

	// NATS JetStream
	msgBus, err := bus.New(ctx, natsURL)
	if err != nil {
		slog.Error("failed to connect to NATS", "error", err)
		os.Exit(1)
	}
	defer msgBus.Close()

	// Budget tracker (Redis-backed)
	bt, err := budget.New(ctx, redisURL)
	if err != nil {
		slog.Error("failed to create budget tracker", "error", err)
		os.Exit(1)
	}
	defer bt.Close()

	// -----------------------------------------------------------------------
	// Create subsystems
	// -----------------------------------------------------------------------

	// SSE event hub
	hub := sse.NewHub()

	// Settings reader: pool calls this on every Spawn() to get LLM config from DB
	settingsReader := func(readCtx context.Context) (*pool.LLMConfig, error) {
		settings, err := st.GetSettings(readCtx, "global")
		if err != nil {
			return nil, err
		}
		if settings.LLM.Provider == "" || settings.LLM.APIKey == "" {
			return nil, fmt.Errorf("no LLM provider configured")
		}
		return &pool.LLMConfig{
			Provider: settings.LLM.Provider,
			BaseURL:  settings.LLM.BaseURL,
			APIKey:   settings.LLM.APIKey,
			Model:    settings.LLM.Model,
			APIType:  settings.LLM.APIType,
		}, nil
	}

	// Container pool — manages OpenClaw Gateway Docker containers
	instancePool, err := pool.New(pool.Config{
		OpenClawImage: getEnv("OPENCLAW_IMAGE", "openclaw:local"),
		GatewayToken:  getEnv("OPENCLAW_GATEWAY_TOKEN", "openswarm-secret"),
		NetworkName:   getEnv("DOCKER_NETWORK", "openswarm"),
		LLMProvider:   getEnv("LLM_PROVIDER", "groq"),
		LLMBaseURL:    getEnv("LLM_BASE_URL", "https://api.groq.com/openai"),
		LLMApiKey:     getEnv("LLM_API_KEY", ""),
		Model:         getEnv("LLM_MODEL", "llama-3.3-70b-versatile"),
		WorkspaceDir:  getEnv("WORKSPACE_DIR", "/tmp/openswarm-workspaces"),
	}, settingsReader)
	if err != nil {
		slog.Error("failed to create container pool", "error", err)
		os.Exit(1)
	}
	defer instancePool.Close()

	// Recover any existing OpenSwarm-managed containers from a previous run
	// (e.g. after hot-reload restart via air)
	if err := instancePool.RecoverExisting(ctx); err != nil {
		slog.Warn("failed to recover existing containers", "error", err)
	}

	// Audit logger — hash-chained tamper-evident audit trail
	// Must be created before executor (executor emits audit events)
	auditLog := audit.New(st, msgBus, hub)
	if err := auditLog.LoadChains(ctx); err != nil {
		slog.Warn("audit: failed to load existing chains (OK on first run)", "error", err)
	}

	// Lifecycle manager — reconciles desired vs actual agent state
	lm := lifecycle.New(st, reg, instancePool, hub)

	// Scheduler — picks agents for pending tasks
	sched := scheduler.New(st, reg, msgBus)

	// Executor — sends tasks to real OpenClaw instances via HTTP
	exec := executor.New(st, reg, instancePool, msgBus, bt, hub, auditLog, executor.Config{
		GatewayToken: getEnv("OPENCLAW_GATEWAY_TOKEN", "openswarm-secret"),
	})

	// Genetics engine — agent genome tracking and evolution
	ge := genetics.New(st)

	// -----------------------------------------------------------------------
	// Build the API server
	// -----------------------------------------------------------------------

	cfg := api.Config{
		Version:           version,
		DatabaseURL:       databaseURL,
		RedisURL:          redisURL,
		NatsURL:           natsURL,
		OpenClawInstances: getEnv("OPENCLAW_INSTANCES", "localhost:18789"),
		OpenClawToken:     getEnv("OPENCLAW_GATEWAY_TOKEN", "openswarm-secret"),
	}

	server := api.NewServer(cfg, st, reg, msgBus, hub, bt, lm, ge, instancePool, auditLog)

	httpServer := &http.Server{
		Addr:         ":" + port,
		Handler:      server.Router(),
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 0, // SSE requires no write timeout
		IdleTimeout:  60 * time.Second,
	}

	// -----------------------------------------------------------------------
	// Start subsystems
	// -----------------------------------------------------------------------

	if err := auditLog.Start(ctx); err != nil {
		slog.Error("failed to start audit logger", "error", err)
		os.Exit(1)
	}

	if err := lm.Start(ctx); err != nil {
		slog.Error("failed to start lifecycle manager", "error", err)
		os.Exit(1)
	}

	if err := sched.Start(ctx); err != nil {
		slog.Error("failed to start scheduler", "error", err)
		os.Exit(1)
	}

	if err := exec.Start(ctx); err != nil {
		slog.Error("failed to start executor", "error", err)
		os.Exit(1)
	}

	// NATS-to-SSE bridge: forward real-time events to dashboard clients
	if err := startSSEBridge(msgBus, hub); err != nil {
		slog.Error("failed to start SSE bridge", "error", err)
		os.Exit(1)
	}

	// -----------------------------------------------------------------------
	// Start HTTP server
	// -----------------------------------------------------------------------

	go func() {
		slog.Info("OpenSwarm control plane starting", "port", port, "version", version)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("server error", "error", err)
			os.Exit(1)
		}
	}()

	<-ctx.Done()
	slog.Info("shutting down gracefully...")

	// Stop subsystems in reverse order
	exec.Stop()
	sched.Stop()
	lm.Stop()
	auditLog.Stop()
	// In dev mode (air hot reload), keep containers alive so they can be recovered on restart
	if os.Getenv("DEV_KEEP_CONTAINERS") != "true" {
		instancePool.TerminateAll(context.Background())
	} else {
		slog.Info("dev mode: keeping containers alive for recovery on next restart")
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		slog.Error("shutdown error", "error", err)
	}

	fmt.Println("OpenSwarm control plane stopped.")
}

// startSSEBridge subscribes to NATS events and broadcasts them to SSE clients.
func startSSEBridge(msgBus *bus.Bus, hub *sse.Hub) error {
	// Bridge agent heartbeats → SSE (dashboard shows live agent status)
	if _, err := msgBus.Subscribe("swarm.*.agent.heartbeat", func(msg jetstream.Msg) {
		swarm := extractSwarmFromSubject(msg.Subject())
		if swarm == "" {
			return
		}
		hub.Broadcast(swarm, sse.Event{
			Type: "agent_heartbeat",
			Data: json.RawMessage(msg.Data()),
		})
	}); err != nil {
		return fmt.Errorf("sse bridge: subscribe heartbeats: %w", err)
	}

	// Bridge agent register/deregister → SSE
	if _, err := msgBus.Subscribe("swarm.*.agent.register", func(msg jetstream.Msg) {
		swarm := extractSwarmFromSubject(msg.Subject())
		if swarm == "" {
			return
		}
		hub.Broadcast(swarm, sse.Event{
			Type: "agent_registered",
			Data: json.RawMessage(msg.Data()),
		})
	}); err != nil {
		return fmt.Errorf("sse bridge: subscribe agent register: %w", err)
	}

	slog.Info("sse bridge: started")
	return nil
}

// extractSwarmFromSubject returns the swarm name from subjects like "swarm.{name}.task.submit".
func extractSwarmFromSubject(subject string) string {
	parts := strings.SplitN(subject, ".", 3)
	if len(parts) < 2 {
		return ""
	}
	return parts[1]
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
