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
	"github.com/openswarm/openswarm/internal/budget"
	"github.com/openswarm/openswarm/internal/bus"
	"github.com/openswarm/openswarm/internal/executor"
	"github.com/openswarm/openswarm/internal/genetics"
	"github.com/openswarm/openswarm/internal/lifecycle"
	"github.com/openswarm/openswarm/internal/registry"
	"github.com/openswarm/openswarm/internal/scheduler"
	"github.com/openswarm/openswarm/internal/sse"
	"github.com/openswarm/openswarm/internal/store"
)

var version = "0.1.0-dev"

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

	// Lifecycle manager — registers agents from existing swarms
	lm := lifecycle.New(st, reg)

	// Scheduler — picks agents for pending tasks
	sched := scheduler.New(st, reg, msgBus)

	// Executor — runs tasks (mock LLM) and triggers downstream pipeline
	exec := executor.New(st, reg, msgBus, bt, hub)

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
		OpenClawToken:     getEnv("OPENCLAW_TOKEN", ""),
	}

	server := api.NewServer(cfg, st, reg, msgBus, hub, bt, lm, ge)

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
	startSSEBridge(msgBus, hub)

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

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		slog.Error("shutdown error", "error", err)
	}

	fmt.Println("OpenSwarm control plane stopped.")
}

// startSSEBridge subscribes to NATS events and broadcasts them to SSE clients.
func startSSEBridge(msgBus *bus.Bus, hub *sse.Hub) {
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
		slog.Error("sse bridge: subscribe heartbeats", "error", err)
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
		slog.Error("sse bridge: subscribe agent register", "error", err)
	}

	slog.Info("sse bridge: started")
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
