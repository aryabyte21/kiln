package executor

import (
	"strings"
	"testing"
)

func TestGenerateMockOutput(t *testing.T) {
	output := generateMockOutput("researcher", "Research quantum computing")
	if output == "" {
		t.Fatal("expected non-empty output")
	}
	if !strings.Contains(output, "researcher") {
		t.Error("expected output to reference agent role")
	}
}

func TestGenerateMockOutput_UnknownRole(t *testing.T) {
	output := generateMockOutput("unknown-agent", "do something")
	if output == "" {
		t.Fatal("expected non-empty output for unknown role")
	}
}

func TestEstimateTokens(t *testing.T) {
	input, output := estimateTokens("short input", "This is a somewhat longer output from the agent.")
	if input <= 0 || output <= 0 {
		t.Errorf("expected positive token counts, got input=%d output=%d", input, output)
	}
}

func TestCalculateCost(t *testing.T) {
	cost := calculateCost("claude-sonnet-4-6", 100, 200)
	if cost <= 0 {
		t.Error("expected positive cost")
	}
	costHaiku := calculateCost("claude-haiku-4-5-20251001", 100, 200)
	if costHaiku >= cost {
		t.Error("expected haiku to be cheaper than sonnet")
	}
}

func TestCalculateCost_DefaultsSonnet(t *testing.T) {
	cost1 := calculateCost("claude-sonnet-4-6", 100, 200)
	cost2 := calculateCost("unknown-model-xyz", 100, 200)
	if cost1 != cost2 {
		t.Error("unknown model should default to sonnet pricing")
	}
}
