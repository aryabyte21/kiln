package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/openswarm/openswarm/internal/api"
	"github.com/openswarm/openswarm/internal/bus"
	"github.com/openswarm/openswarm/internal/registry"
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

	// Redis
	reg, err := registry.New(ctx, redisURL)
	if err != nil {
		slog.Error("failed to connect to Redis", "error", err)
		os.Exit(1)
	}
	defer reg.Close()

	// NATS
	msgBus, err := bus.New(ctx, natsURL)
	if err != nil {
		slog.Error("failed to connect to NATS", "error", err)
		os.Exit(1)
	}
	defer msgBus.Close()

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

	server := api.NewServer(cfg, st, reg, msgBus)

	httpServer := &http.Server{
		Addr:         ":" + port,
		Handler:      server.Router(),
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 0, // SSE requires no write timeout
		IdleTimeout:  60 * time.Second,
	}

	// -----------------------------------------------------------------------
	// Start serving
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

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		slog.Error("shutdown error", "error", err)
	}

	fmt.Println("OpenSwarm control plane stopped.")
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
