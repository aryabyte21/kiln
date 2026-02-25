// Package audit provides a tamper-evident, hash-chained audit log for
// all significant actions in an OpenSwarm deployment. Each audit event
// includes the SHA-256 hash of the previous event for the same agent,
// forming a verifiable per-agent chain.
package audit

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/openswarm/openswarm/internal/bus"
	"github.com/openswarm/openswarm/internal/domain"
	"github.com/openswarm/openswarm/internal/sse"
	"github.com/openswarm/openswarm/internal/store"
)

// Logger is the audit event processor. It computes hash chains,
// persists events to TimescaleDB, publishes to NATS, and broadcasts
// to SSE for real-time dashboard updates.
type Logger struct {
	store *store.Store
	bus   *bus.Bus
	hub   *sse.Hub

	// Per-agent last hash for chain continuity.
	// Protected by mu.
	chains map[string]string
	mu     sync.RWMutex

	// Buffered channel for async event processing
	ch     chan domain.AuditEvent
	cancel context.CancelFunc
	wg     sync.WaitGroup
}

// New creates an audit logger with the given dependencies.
func New(st *store.Store, b *bus.Bus, hub *sse.Hub) *Logger {
	return &Logger{
		store:  st,
		bus:    b,
		hub:    hub,
		chains: make(map[string]string),
		ch:     make(chan domain.AuditEvent, 1024),
	}
}

// Start begins the background event processor. Events submitted via Log()
// are buffered in a channel and processed sequentially to preserve hash
// chain ordering per agent.
func (l *Logger) Start(ctx context.Context) error {
	ctx, l.cancel = context.WithCancel(ctx)

	l.wg.Add(1)
	go func() {
		defer l.wg.Done()
		l.processLoop(ctx)
	}()

	slog.Info("audit: logger started")
	return nil
}

// Stop gracefully shuts down the logger, draining buffered events.
func (l *Logger) Stop() {
	if l.cancel != nil {
		l.cancel()
	}
	close(l.ch)
	l.wg.Wait()
	slog.Info("audit: logger stopped")
}

// Log submits an audit event for async processing. The event's Time,
// PrevHash, and EventHash fields are filled in by the logger.
// The caller should populate SwarmName, AgentID, TaskID, Action,
// TokensUsed, CostUSD, and Metadata.
func (l *Logger) Log(event domain.AuditEvent) {
	select {
	case l.ch <- event:
	default:
		slog.Warn("audit: event channel full, dropping event",
			"action", event.Action, "agent", event.AgentID)
	}
}

// processLoop drains the event channel and persists events with hash chains.
func (l *Logger) processLoop(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			// Drain remaining events
			for len(l.ch) > 0 {
				event, ok := <-l.ch
				if !ok {
					return
				}
				l.processEvent(context.Background(), event)
			}
			return
		case event, ok := <-l.ch:
			if !ok {
				return
			}
			l.processEvent(ctx, event)
		}
	}
}

// processEvent fills in hash chain fields, persists the event, and broadcasts it.
func (l *Logger) processEvent(ctx context.Context, event domain.AuditEvent) {
	// Set timestamp
	if event.Time.IsZero() {
		event.Time = time.Now()
	}

	// Default agentID for non-agent events
	if event.AgentID == "" {
		event.AgentID = "system"
	}

	// Get the previous hash for this agent's chain
	l.mu.Lock()
	event.PrevHash = l.chains[event.AgentID]
	event.EventHash = computeHash(event)
	l.chains[event.AgentID] = event.EventHash
	l.mu.Unlock()

	// 1. Persist to TimescaleDB
	if err := l.store.InsertAuditEvent(ctx, &event); err != nil {
		slog.Error("audit: persist event failed", "error", err, "action", event.Action)
	}

	// 2. Publish to NATS for downstream consumers
	if l.bus != nil && event.SwarmName != "" {
		subject := fmt.Sprintf("swarm.%s.audit.event", event.SwarmName)
		if err := l.bus.PublishJSON(ctx, subject, event); err != nil {
			slog.Error("audit: publish to NATS failed", "error", err, "subject", subject)
		}
	}

	// 3. Broadcast to SSE for dashboard
	if l.hub != nil && event.SwarmName != "" {
		l.hub.Broadcast(event.SwarmName, sse.Event{
			Type: "audit_event",
			Data: event,
		})
	}
}

// computeHash calculates the SHA-256 hash of an audit event, incorporating
// all significant fields plus the previous hash to form the chain link.
func computeHash(e domain.AuditEvent) string {
	// Deterministic serialization: concatenate all fields in fixed order
	data := fmt.Sprintf("%s|%s|%s|%s|%s|%d|%f|%s|%s|%s",
		e.Time.UTC().Format(time.RFC3339Nano),
		e.SwarmName,
		e.AgentID,
		e.TaskID,
		e.Action,
		e.TokensUsed,
		e.CostUSD,
		e.InputHash,
		e.OutputHash,
		e.PrevHash,
	)
	h := sha256.Sum256([]byte(data))
	return fmt.Sprintf("%x", h)
}

// LoadChains reads the last audit event hash for each agent from the
// database so the hash chain can resume correctly after a restart.
func (l *Logger) LoadChains(ctx context.Context) error {
	chains, err := l.store.GetLastAuditHashes(ctx)
	if err != nil {
		return fmt.Errorf("audit: load chains: %w", err)
	}
	l.mu.Lock()
	for agentID, hash := range chains {
		l.chains[agentID] = hash
	}
	l.mu.Unlock()
	slog.Info("audit: loaded hash chains", "agents", len(chains))
	return nil
}

// VerifyChain checks the hash chain integrity for a given agent.
// It re-computes each event's hash from its fields + prev_hash and
// verifies it matches the stored event_hash.
func (l *Logger) VerifyChain(ctx context.Context, swarmName, agentID string) (*domain.AuditChainResult, error) {
	events, err := l.store.ListAuditEventsByAgent(ctx, swarmName, agentID)
	if err != nil {
		return nil, fmt.Errorf("audit: verify chain: %w", err)
	}

	result := &domain.AuditChainResult{
		Valid:      true,
		EventCount: len(events),
	}

	if len(events) == 0 {
		return result, nil
	}

	result.FirstEvent = events[0].EventHash
	result.LastEvent = events[len(events)-1].EventHash

	prevHash := ""
	for i, e := range events {
		// Verify the prev_hash link
		if e.PrevHash != prevHash {
			result.Valid = false
			result.BrokenAt = i + 1
			result.BrokenHash = e.EventHash
			result.Error = fmt.Sprintf("event %d: expected prevHash %q, got %q", i, prevHash, e.PrevHash)
			return result, nil
		}

		// Recompute and verify the event hash
		expected := computeHash(e)
		if e.EventHash != expected {
			result.Valid = false
			result.BrokenAt = i + 1
			result.BrokenHash = e.EventHash
			result.Error = fmt.Sprintf("event %d: hash mismatch (computed %q, stored %q)", i, expected, e.EventHash)
			return result, nil
		}

		prevHash = e.EventHash
	}

	return result, nil
}

// VerifySwarm verifies chains for ALL agents in a swarm.
func (l *Logger) VerifySwarm(ctx context.Context, swarmName string) (map[string]*domain.AuditChainResult, error) {
	agentIDs, err := l.store.ListAuditAgentIDs(ctx, swarmName)
	if err != nil {
		return nil, fmt.Errorf("audit: list agent IDs: %w", err)
	}

	results := make(map[string]*domain.AuditChainResult, len(agentIDs))
	for _, id := range agentIDs {
		r, err := l.VerifyChain(ctx, swarmName, id)
		if err != nil {
			results[id] = &domain.AuditChainResult{
				Valid: false,
				Error: err.Error(),
			}
			continue
		}
		results[id] = r
	}
	return results, nil
}

// Helper to hash arbitrary content (for input/output hashing)
func HashContent(content string) string {
	if content == "" {
		return ""
	}
	h := sha256.Sum256([]byte(content))
	return fmt.Sprintf("%x", h)
}

// Helper to create a metadata map from key-value pairs.
func Meta(kvs ...string) map[string]string {
	m := make(map[string]string, len(kvs)/2)
	for i := 0; i+1 < len(kvs); i += 2 {
		m[kvs[i]] = kvs[i+1]
	}
	return m
}

// MarshalMetadata converts a metadata map to a JSON byte slice.
func MarshalMetadata(m map[string]string) []byte {
	if m == nil {
		return []byte("{}")
	}
	b, err := json.Marshal(m)
	if err != nil {
		return []byte("{}")
	}
	return b
}
