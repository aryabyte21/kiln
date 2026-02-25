package pool

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
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

	dir, err := p.createWorkspace("test-swarm", "summarizer", 18800, "You are a test agent.", llmCfg)
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

	dir, err := p.createWorkspace("my-swarm", "fetcher", 18801, "", llmCfg)
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
