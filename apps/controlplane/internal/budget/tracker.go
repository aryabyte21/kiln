package budget

import (
	"context"
	"fmt"
	"log/slog"
	"strconv"
	"strings"

	"github.com/redis/go-redis/v9"
)

type BudgetState struct {
	Total     float64 `json:"total"`
	Spent     float64 `json:"spent"`
	TaskCount int     `json:"taskCount"`
	AlertAt   int     `json:"alertAt"`
	HardStop  int     `json:"hardStop"`
	Percent   float64 `json:"percent"`
}

func (b BudgetState) IsBankrupt() bool {
	if b.Total <= 0 {
		return false
	}
	return (b.Spent / b.Total * 100) >= float64(b.HardStop)
}

func (b BudgetState) ShouldAlert() bool {
	if b.Total <= 0 {
		return false
	}
	return (b.Spent / b.Total * 100) >= float64(b.AlertAt)
}

type Tracker struct {
	rdb *redis.Client
}

func New(ctx context.Context, redisURL string) (*Tracker, error) {
	opts, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, fmt.Errorf("budget: parse redis url: %w", err)
	}
	rdb := redis.NewClient(opts)
	if err := rdb.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("budget: redis ping: %w", err)
	}
	return &Tracker{rdb: rdb}, nil
}

func (t *Tracker) Close() error {
	return t.rdb.Close()
}

func budgetKey(swarm string) string {
	return fmt.Sprintf("osw:{%s}:budget", swarm)
}

func (t *Tracker) InitBudget(ctx context.Context, swarm string, totalStr string, alertAt, hardStop int) error {
	total := parseDollarAmount(totalStr)
	key := budgetKey(swarm)
	pipe := t.rdb.Pipeline()
	pipe.HSet(ctx, key, map[string]interface{}{
		"total":     total,
		"spent":     0.0,
		"taskCount": 0,
		"alertAt":   alertAt,
		"hardStop":  hardStop,
	})
	_, err := pipe.Exec(ctx)
	if err != nil {
		return fmt.Errorf("budget: init %s: %w", swarm, err)
	}
	slog.Info("budget: initialized", "swarm", swarm, "total", total)
	return nil
}

func (t *Tracker) RecordCost(ctx context.Context, swarm string, costUSD float64) (*BudgetState, error) {
	key := budgetKey(swarm)
	pipe := t.rdb.Pipeline()
	pipe.HIncrByFloat(ctx, key, "spent", costUSD)
	pipe.HIncrBy(ctx, key, "taskCount", 1)
	_, err := pipe.Exec(ctx)
	if err != nil {
		return nil, fmt.Errorf("budget: record cost %s: %w", swarm, err)
	}
	return t.GetBudget(ctx, swarm)
}

func (t *Tracker) GetBudget(ctx context.Context, swarm string) (*BudgetState, error) {
	key := budgetKey(swarm)
	m, err := t.rdb.HGetAll(ctx, key).Result()
	if err != nil {
		return nil, fmt.Errorf("budget: get %s: %w", swarm, err)
	}
	if len(m) == 0 {
		return &BudgetState{}, nil
	}
	total, _ := strconv.ParseFloat(m["total"], 64)
	spent, _ := strconv.ParseFloat(m["spent"], 64)
	taskCount, _ := strconv.Atoi(m["taskCount"])
	alertAt, _ := strconv.Atoi(m["alertAt"])
	hardStop, _ := strconv.Atoi(m["hardStop"])
	pct := 0.0
	if total > 0 {
		pct = spent / total * 100
	}
	return &BudgetState{
		Total: total, Spent: spent, TaskCount: taskCount,
		AlertAt: alertAt, HardStop: hardStop, Percent: pct,
	}, nil
}

func parseDollarAmount(s string) float64 {
	s = strings.TrimPrefix(s, "$")
	s = strings.TrimSpace(s)
	v, _ := strconv.ParseFloat(s, 64)
	return v
}
