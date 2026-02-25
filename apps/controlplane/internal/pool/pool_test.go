package pool

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/openswarm/openswarm/internal/domain"
)

func TestCreateWorkspace(t *testing.T) {
	tmpDir := t.TempDir()
	p := &Pool{cfg: Config{WorkspaceDir: tmpDir}}

	llmCfg := &LLMConfig{
		Provider: "groq",
		BaseURL:  "https://api.groq.com/openai/v1",
		APIKey:   "test-key-123",
		Model:    "llama-3.3-70b-versatile",
		APIType:  "openai-completions",
	}

	cfg := SpawnConfig{
		SwarmName: "test-swarm",
		Role:      "summarizer",
		SoulMD:    "You are a test agent.",
		Config:    map[string]any{},
	}

	dir, err := p.createWorkspace(cfg, 18800, llmCfg)
	if err != nil {
		t.Fatalf("createWorkspace: %v", err)
	}

	// SOUL.md should be in workspace subdirectory
	soulBytes, err := os.ReadFile(filepath.Join(dir, "workspace", "SOUL.md"))
	if err != nil {
		t.Fatalf("read SOUL.md: %v", err)
	}
	if string(soulBytes) != "You are a test agent." {
		t.Errorf("SOUL.md = %q, want %q", string(soulBytes), "You are a test agent.")
	}

	// openclaw.json should exist (not settings.json)
	configBytes, err := os.ReadFile(filepath.Join(dir, "openclaw.json"))
	if err != nil {
		t.Fatalf("read openclaw.json: %v", err)
	}
	configStr := string(configBytes)
	if !strings.Contains(configStr, "api.groq.com") {
		t.Errorf("openclaw.json missing groq URL: %s", configStr)
	}
	if !strings.Contains(configStr, "llama-3.3-70b-versatile") {
		t.Errorf("openclaw.json missing model: %s", configStr)
	}
	if !strings.Contains(configStr, "test-key-123") {
		t.Errorf("openclaw.json missing API key: %s", configStr)
	}
	if !strings.Contains(configStr, "chatCompletions") {
		t.Errorf("openclaw.json missing chatCompletions endpoint config: %s", configStr)
	}
	if !strings.Contains(configStr, "dangerouslyAllowHostHeaderOriginFallback") {
		t.Errorf("openclaw.json missing controlUi config: %s", configStr)
	}
}

func TestCreateWorkspaceDefaultSoul(t *testing.T) {
	tmpDir := t.TempDir()
	p := &Pool{cfg: Config{WorkspaceDir: tmpDir}}

	llmCfg := &LLMConfig{
		Provider: "groq",
		BaseURL:  "https://api.groq.com/openai/v1",
		APIKey:   "test-key",
		Model:    "llama-3.3-70b-versatile",
		APIType:  "openai-completions",
	}

	cfg := SpawnConfig{
		SwarmName: "my-swarm",
		Role:      "fetcher",
		SoulMD:    "",
		Config:    map[string]any{},
	}

	dir, err := p.createWorkspace(cfg, 18801, llmCfg)
	if err != nil {
		t.Fatalf("createWorkspace: %v", err)
	}

	soulBytes, err := os.ReadFile(filepath.Join(dir, "workspace", "SOUL.md"))
	if err != nil {
		t.Fatalf("read SOUL.md: %v", err)
	}
	soul := string(soulBytes)
	if !strings.Contains(soul, "fetcher") || !strings.Contains(soul, "my-swarm") {
		t.Errorf("default SOUL.md should mention role and swarm, got: %s", soul)
	}
}

func TestCreateWorkspaceCustomContextAndTokens(t *testing.T) {
	tmpDir := t.TempDir()
	p := &Pool{cfg: Config{WorkspaceDir: tmpDir}}

	llmCfg := &LLMConfig{
		Provider: "groq",
		BaseURL:  "https://api.groq.com/openai/v1",
		APIKey:   "test-key",
		Model:    "llama-3.3-70b-versatile",
		APIType:  "openai-completions",
	}

	cfg := SpawnConfig{
		SwarmName: "custom-swarm",
		Role:      "writer",
		SoulMD:    "Test agent.",
		Config: map[string]any{
			"contextWindow": 65536,
			"maxTokens":     4096,
		},
	}

	dir, err := p.createWorkspace(cfg, 18802, llmCfg)
	if err != nil {
		t.Fatalf("createWorkspace: %v", err)
	}

	configBytes, err := os.ReadFile(filepath.Join(dir, "openclaw.json"))
	if err != nil {
		t.Fatalf("read openclaw.json: %v", err)
	}
	configStr := string(configBytes)
	if !strings.Contains(configStr, "65536") {
		t.Errorf("openclaw.json should contain custom contextWindow 65536: %s", configStr)
	}
	if !strings.Contains(configStr, "4096") {
		t.Errorf("openclaw.json should contain custom maxTokens 4096: %s", configStr)
	}
}

func TestCreateWorkspaceCronJobs(t *testing.T) {
	tmpDir := t.TempDir()
	p := &Pool{cfg: Config{WorkspaceDir: tmpDir}}

	llmCfg := &LLMConfig{
		Provider: "groq",
		BaseURL:  "https://api.groq.com/openai/v1",
		APIKey:   "test-key",
		Model:    "llama-3.3-70b-versatile",
		APIType:  "openai-completions",
	}

	cfg := SpawnConfig{
		SwarmName: "cron-swarm",
		Role:      "scheduler",
		SoulMD:    "Test agent.",
		Config:    map[string]any{},
		Cron: []domain.CronJob{
			{Name: "daily-summary", Schedule: "0 9 * * *", Task: "Summarize daily news"},
		},
	}

	dir, err := p.createWorkspace(cfg, 18803, llmCfg)
	if err != nil {
		t.Fatalf("createWorkspace: %v", err)
	}

	cronBytes, err := os.ReadFile(filepath.Join(dir, "workspace", "cron", "jobs.json"))
	if err != nil {
		t.Fatalf("read cron/jobs.json: %v", err)
	}

	var jobs []domain.CronJob
	if err := json.Unmarshal(cronBytes, &jobs); err != nil {
		t.Fatalf("unmarshal cron jobs: %v", err)
	}
	if len(jobs) != 1 {
		t.Fatalf("expected 1 cron job, got %d", len(jobs))
	}
	if jobs[0].Name != "daily-summary" {
		t.Errorf("expected cron job name 'daily-summary', got %q", jobs[0].Name)
	}
}

func TestToInt(t *testing.T) {
	tests := []struct {
		name    string
		input   any
		wantVal int
		wantOk  bool
	}{
		{"int", 42, 42, true},
		{"int64", int64(100), 100, true},
		{"float64", float64(65536), 65536, true},
		{"string", "bad", 0, false},
		{"nil", nil, 0, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, ok := toInt(tt.input)
			if ok != tt.wantOk || got != tt.wantVal {
				t.Errorf("toInt(%v) = (%d, %v), want (%d, %v)", tt.input, got, ok, tt.wantVal, tt.wantOk)
			}
		})
	}
}
