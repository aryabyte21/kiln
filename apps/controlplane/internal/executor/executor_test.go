package executor

import (
	"testing"
)

func TestEstimateCost(t *testing.T) {
	// Nominal cost tracking: $0.001 per 1K tokens
	cost := estimateCost("qwen2.5:7b", 100, 200)
	if cost <= 0 {
		t.Error("expected positive nominal cost")
	}
	// 300 tokens * 0.001 / 1000 = 0.0000003
	expected := 0.0003
	if cost < expected*0.9 || cost > expected*1.1 {
		t.Errorf("cost = %f, expected ~%f", cost, expected)
	}
}

func TestEstimateCost_ZeroTokens(t *testing.T) {
	cost := estimateCost("qwen2.5:7b", 0, 0)
	if cost != 0 {
		t.Errorf("expected zero cost for zero tokens, got %f", cost)
	}
}

func TestOpenClawResponseParsing(t *testing.T) {
	// Verify the response struct can hold all fields
	resp := OpenClawResponse{
		Content: "test output",
		Model:   "qwen2.5:7b",
	}
	resp.Usage.PromptTokens = 10
	resp.Usage.CompletionTokens = 20
	resp.Usage.TotalTokens = 30

	if resp.Content != "test output" {
		t.Errorf("Content = %q, want %q", resp.Content, "test output")
	}
	if resp.Usage.TotalTokens != 30 {
		t.Errorf("TotalTokens = %d, want 30", resp.Usage.TotalTokens)
	}
}
