// Package registry implements a Redis-backed agent registry for managing
// the lifecycle state, health, and discovery of agents within OpenSwarm.
package registry

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strconv"
	"time"

	"github.com/openswarm/openswarm/internal/domain"
	"github.com/redis/go-redis/v9"
)

const heartbeatTTL = 30 * time.Second

// Registry provides agent registration, discovery, and health tracking
// backed by Redis. Keys use hash-tags so all data for a single swarm
// lands on the same Redis cluster slot.
type Registry struct {
	rdb *redis.Client
}

// New creates a Registry connected to the Redis instance identified by
// redisURL (e.g. "redis://localhost:6379/0"). The connection is verified
// with a PING before returning.
func New(ctx context.Context, redisURL string) (*Registry, error) {
	opts, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, fmt.Errorf("registry: parse redis url: %w", err)
	}

	rdb := redis.NewClient(opts)

	if err := rdb.Ping(ctx).Err(); err != nil {
		_ = rdb.Close()
		return nil, fmt.Errorf("registry: redis ping: %w", err)
	}

	slog.Info("registry: connected to redis", "addr", opts.Addr)
	return &Registry{rdb: rdb}, nil
}

// Close releases the underlying Redis connection.
func (r *Registry) Close() error {
	return r.rdb.Close()
}

// Ping checks connectivity to Redis.
func (r *Registry) Ping(ctx context.Context) error {
	return r.rdb.Ping(ctx).Err()
}

// ----- key helpers --------------------------------------------------------

func agentKey(swarm, id string) string {
	return fmt.Sprintf("osw:{%s}:registry:%s", swarm, id)
}

func swarmIndexKey(swarm string) string {
	return fmt.Sprintf("osw:{%s}:registry:index", swarm)
}

func roleIndexKey(swarm, role string) string {
	return fmt.Sprintf("osw:{%s}:registry:role:%s", swarm, role)
}

func heartbeatKey(swarm, id string) string {
	return fmt.Sprintf("osw:{%s}:heartbeat:%s", swarm, id)
}

// ----- agent serialisation ------------------------------------------------

func agentToMap(a domain.Agent) map[string]interface{} {
	m := map[string]interface{}{
		"id":           a.ID,
		"swarmName":    a.SwarmName,
		"role":         a.Role,
		"status":       string(a.Status),
		"model":        a.Model,
		"openclawAddr": a.OpenClawAddr,
		"configHash":   a.ConfigHash,
		"registeredAt": a.RegisteredAt.Format(time.RFC3339Nano),
		"lastSeen":     a.LastSeen.Format(time.RFC3339Nano),
	}
	if len(a.Labels) > 0 {
		labelsJSON, _ := json.Marshal(a.Labels)
		m["labels"] = string(labelsJSON)
	}
	return m
}

func agentFromMap(m map[string]string) (*domain.Agent, error) {
	a := &domain.Agent{
		ID:           m["id"],
		SwarmName:    m["swarmName"],
		Role:         m["role"],
		Status:       domain.AgentStatus(m["status"]),
		Model:        m["model"],
		OpenClawAddr: m["openclawAddr"],
		ConfigHash:   m["configHash"],
	}

	var err error
	if a.RegisteredAt, err = time.Parse(time.RFC3339Nano, m["registeredAt"]); err != nil {
		return nil, fmt.Errorf("registry: parse registeredAt: %w", err)
	}
	if a.LastSeen, err = time.Parse(time.RFC3339Nano, m["lastSeen"]); err != nil {
		return nil, fmt.Errorf("registry: parse lastSeen: %w", err)
	}

	if raw, ok := m["labels"]; ok && raw != "" {
		labels := make(map[string]string)
		if err := json.Unmarshal([]byte(raw), &labels); err != nil {
			return nil, fmt.Errorf("registry: parse labels: %w", err)
		}
		a.Labels = labels
	}

	return a, nil
}

// ----- health serialisation -----------------------------------------------

func healthToMap(h domain.AgentHealth) map[string]interface{} {
	return map[string]interface{}{
		"agentId":      h.AgentID,
		"contextUsed":  h.ContextUsed,
		"queueDepth":   h.QueueDepth,
		"healthScore":  h.HealthScore,
		"costSession":  h.CostSession,
		"currentTask":  h.CurrentTask,
		"lastReported": h.LastReported.Format(time.RFC3339Nano),
	}
}

func healthFromMap(m map[string]string) (*domain.AgentHealth, error) {
	h := &domain.AgentHealth{
		AgentID:     m["agentId"],
		CurrentTask: m["currentTask"],
	}

	var err error
	if h.ContextUsed, err = strconv.Atoi(m["contextUsed"]); err != nil {
		return nil, fmt.Errorf("registry: parse contextUsed: %w", err)
	}
	if h.QueueDepth, err = strconv.Atoi(m["queueDepth"]); err != nil {
		return nil, fmt.Errorf("registry: parse queueDepth: %w", err)
	}
	if h.HealthScore, err = strconv.ParseFloat(m["healthScore"], 64); err != nil {
		return nil, fmt.Errorf("registry: parse healthScore: %w", err)
	}
	if h.CostSession, err = strconv.ParseFloat(m["costSession"], 64); err != nil {
		return nil, fmt.Errorf("registry: parse costSession: %w", err)
	}
	if h.LastReported, err = time.Parse(time.RFC3339Nano, m["lastReported"]); err != nil {
		return nil, fmt.Errorf("registry: parse lastReported: %w", err)
	}
	return h, nil
}

// ----- public API ---------------------------------------------------------

// Register atomically stores the agent record and adds it to the swarm
// and role indexes.
func (r *Registry) Register(ctx context.Context, agent domain.Agent) error {
	key := agentKey(agent.SwarmName, agent.ID)
	sIdx := swarmIndexKey(agent.SwarmName)
	rIdx := roleIndexKey(agent.SwarmName, agent.Role)

	pipe := r.rdb.Pipeline()
	pipe.HSet(ctx, key, agentToMap(agent))
	pipe.SAdd(ctx, sIdx, agent.ID)
	pipe.SAdd(ctx, rIdx, agent.ID)

	if _, err := pipe.Exec(ctx); err != nil {
		return fmt.Errorf("registry: register agent %s: %w", agent.ID, err)
	}

	slog.Info("registry: agent registered",
		"agent", agent.ID, "swarm", agent.SwarmName, "role", agent.Role)
	return nil
}

// Deregister removes an agent record, its heartbeat, and its membership
// from the swarm and role indexes.
func (r *Registry) Deregister(ctx context.Context, swarmName, agentID string) error {
	// We need the agent record to know which role index to clean up.
	agent, err := r.GetAgent(ctx, swarmName, agentID)
	if err != nil {
		return fmt.Errorf("registry: deregister lookup: %w", err)
	}

	pipe := r.rdb.Pipeline()
	pipe.Del(ctx, agentKey(swarmName, agentID))
	pipe.Del(ctx, heartbeatKey(swarmName, agentID))
	pipe.SRem(ctx, swarmIndexKey(swarmName), agentID)
	pipe.SRem(ctx, roleIndexKey(swarmName, agent.Role), agentID)

	if _, err := pipe.Exec(ctx); err != nil {
		return fmt.Errorf("registry: deregister agent %s: %w", agentID, err)
	}

	slog.Info("registry: agent deregistered",
		"agent", agentID, "swarm", swarmName)
	return nil
}

// UpdateStatus changes the status field of an existing agent record.
func (r *Registry) UpdateStatus(ctx context.Context, swarmName, agentID string, status domain.AgentStatus) error {
	key := agentKey(swarmName, agentID)

	exists, err := r.rdb.Exists(ctx, key).Result()
	if err != nil {
		return fmt.Errorf("registry: update status check: %w", err)
	}
	if exists == 0 {
		return fmt.Errorf("registry: agent %s not found in swarm %s", agentID, swarmName)
	}

	if err := r.rdb.HSet(ctx, key, "status", string(status)).Err(); err != nil {
		return fmt.Errorf("registry: update status for %s: %w", agentID, err)
	}

	slog.Info("registry: agent status updated",
		"agent", agentID, "swarm", swarmName, "status", status)
	return nil
}

// Heartbeat writes health metrics for the given agent and refreshes the
// TTL so the heartbeat key auto-expires after 30 seconds of silence.
// It also bumps the LastSeen timestamp on the main agent record.
func (r *Registry) Heartbeat(ctx context.Context, swarmName string, health domain.AgentHealth) error {
	hbKey := heartbeatKey(swarmName, health.AgentID)
	aKey := agentKey(swarmName, health.AgentID)
	now := time.Now().UTC()

	pipe := r.rdb.Pipeline()
	pipe.HSet(ctx, hbKey, healthToMap(health))
	pipe.Expire(ctx, hbKey, heartbeatTTL)
	pipe.HSet(ctx, aKey, "lastSeen", now.Format(time.RFC3339Nano))

	if _, err := pipe.Exec(ctx); err != nil {
		return fmt.Errorf("registry: heartbeat for %s: %w", health.AgentID, err)
	}
	return nil
}

// GetAgent returns the agent record for a single agent in the given swarm.
func (r *Registry) GetAgent(ctx context.Context, swarmName, agentID string) (*domain.Agent, error) {
	m, err := r.rdb.HGetAll(ctx, agentKey(swarmName, agentID)).Result()
	if err != nil {
		return nil, fmt.Errorf("registry: get agent %s: %w", agentID, err)
	}
	if len(m) == 0 {
		return nil, fmt.Errorf("registry: agent %s not found in swarm %s", agentID, swarmName)
	}
	return agentFromMap(m)
}

// ListAgentsBySwarm returns every agent registered in the given swarm.
func (r *Registry) ListAgentsBySwarm(ctx context.Context, swarmName string) ([]domain.Agent, error) {
	ids, err := r.rdb.SMembers(ctx, swarmIndexKey(swarmName)).Result()
	if err != nil {
		return nil, fmt.Errorf("registry: list swarm %s: %w", swarmName, err)
	}
	return r.fetchAgents(ctx, swarmName, ids)
}

// ListAgentsByRole returns every agent in the given swarm that has the
// specified role.
func (r *Registry) ListAgentsByRole(ctx context.Context, swarmName, role string) ([]domain.Agent, error) {
	ids, err := r.rdb.SMembers(ctx, roleIndexKey(swarmName, role)).Result()
	if err != nil {
		return nil, fmt.Errorf("registry: list role %s in swarm %s: %w", role, swarmName, err)
	}
	return r.fetchAgents(ctx, swarmName, ids)
}

// GetHealth returns the most recent health metrics for an agent, or nil
// if the heartbeat has expired.
func (r *Registry) GetHealth(ctx context.Context, swarmName, agentID string) (*domain.AgentHealth, error) {
	m, err := r.rdb.HGetAll(ctx, heartbeatKey(swarmName, agentID)).Result()
	if err != nil {
		return nil, fmt.Errorf("registry: get health %s: %w", agentID, err)
	}
	if len(m) == 0 {
		return nil, nil // heartbeat expired or never recorded
	}
	return healthFromMap(m)
}

// ----- internal helpers ---------------------------------------------------

// fetchAgents uses a pipeline to HGETALL every agent key in a single
// round-trip, then deserialises each result.
func (r *Registry) fetchAgents(ctx context.Context, swarmName string, ids []string) ([]domain.Agent, error) {
	if len(ids) == 0 {
		return nil, nil
	}

	pipe := r.rdb.Pipeline()
	cmds := make([]*redis.MapStringStringCmd, len(ids))
	for i, id := range ids {
		cmds[i] = pipe.HGetAll(ctx, agentKey(swarmName, id))
	}
	if _, err := pipe.Exec(ctx); err != nil {
		return nil, fmt.Errorf("registry: fetch agents pipeline: %w", err)
	}

	agents := make([]domain.Agent, 0, len(ids))
	for _, cmd := range cmds {
		m, err := cmd.Result()
		if err != nil {
			return nil, fmt.Errorf("registry: fetch agents result: %w", err)
		}
		if len(m) == 0 {
			continue // stale index entry; agent key was deleted
		}
		a, err := agentFromMap(m)
		if err != nil {
			return nil, err
		}
		agents = append(agents, *a)
	}
	return agents, nil
}
