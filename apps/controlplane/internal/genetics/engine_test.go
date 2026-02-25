package genetics

import (
	"math"
	"testing"
)

const epsilon = 1e-6

func almostEqual(a, b float64) bool {
	return math.Abs(a-b) < epsilon
}

// ---------------------------------------------------------------------------
// ComputeFitness tests
// ---------------------------------------------------------------------------

func TestComputeFitness(t *testing.T) {
	// Known scenario: moderate performance
	// errorRate=0.1, avgLatencyMs=500, avgCostUSD=0.01, tasksCompleted=5
	//
	// reliability = 1 - 0.1 = 0.9
	// speed = 1 / (1 + 500/1000) = 1/1.5 = 0.6667
	// cost = 1 / (1 + 0.01*100) = 1/2 = 0.5
	// experience = min(5/10, 1.0) = 0.5
	//
	// score = 0.4*0.9 + 0.3*0.6667 + 0.2*0.5 + 0.1*0.5
	//       = 0.36 + 0.2 + 0.1 + 0.05 = 0.71
	score := ComputeFitness(5, 500, 0.01, 0.1)
	expected := 0.4*0.9 + 0.3*(1.0/(1.0+500.0/1000.0)) + 0.2*0.5 + 0.1*0.5

	if !almostEqual(score, expected) {
		t.Errorf("ComputeFitness(5, 500, 0.01, 0.1) = %f, want %f", score, expected)
	}
}

func TestComputeFitness_PerfectScore(t *testing.T) {
	// Perfect: no errors, zero latency, zero cost, 10+ tasks
	// reliability = 1.0
	// speed = 1 / (1 + 0) = 1.0
	// cost = 1 / (1 + 0) = 1.0
	// experience = min(10/10, 1.0) = 1.0
	// score = 0.4 + 0.3 + 0.2 + 0.1 = 1.0
	score := ComputeFitness(10, 0, 0.0, 0.0)
	if !almostEqual(score, 1.0) {
		t.Errorf("ComputeFitness perfect = %f, want 1.0", score)
	}

	// More than 10 tasks should still cap experience at 1.0
	score2 := ComputeFitness(100, 0, 0.0, 0.0)
	if !almostEqual(score2, 1.0) {
		t.Errorf("ComputeFitness perfect (100 tasks) = %f, want 1.0", score2)
	}
}

func TestComputeFitness_WorstCase(t *testing.T) {
	// Worst: 100% error rate, high latency, high cost, zero tasks
	// reliability = 1 - 1.0 = 0.0
	// speed = 1 / (1 + 10000/1000) = 1/11 = 0.0909
	// cost = 1 / (1 + 10.0*100) = 1/1001 = ~0.001
	// experience = min(0/10, 1.0) = 0.0
	score := ComputeFitness(0, 10000, 10.0, 1.0)

	expected := 0.4*0.0 + 0.3*(1.0/11.0) + 0.2*(1.0/1001.0) + 0.1*0.0
	if !almostEqual(score, expected) {
		t.Errorf("ComputeFitness worst case = %f, want %f", score, expected)
	}

	// Score should be quite low
	if score > 0.1 {
		t.Errorf("ComputeFitness worst case = %f, expected < 0.1", score)
	}
}

func TestComputeFitness_ZeroTasks(t *testing.T) {
	// Zero tasks, no errors, some latency and cost
	score := ComputeFitness(0, 1000, 0.05, 0.0)
	// reliability = 1.0
	// speed = 1 / (1 + 1) = 0.5
	// cost = 1 / (1 + 5) = ~0.1667
	// experience = 0
	expected := 0.4*1.0 + 0.3*0.5 + 0.2*(1.0/6.0) + 0.1*0.0
	if !almostEqual(score, expected) {
		t.Errorf("ComputeFitness zero tasks = %f, want %f", score, expected)
	}
}

// ---------------------------------------------------------------------------
// CrossoverGenes tests
// ---------------------------------------------------------------------------

func TestCrossoverGenes(t *testing.T) {
	p1 := GeneSet{
		SystemPrompt: "You are a researcher",
		Temperature:  0.7,
		TopP:         0.9,
		Model:        "claude-sonnet",
		Skills:       []string{"search", "summarize"},
		MaxTokens:    4096,
	}
	p2 := GeneSet{
		SystemPrompt: "You are a writer",
		Temperature:  0.3,
		TopP:         0.7,
		Model:        "claude-haiku",
		Skills:       []string{"summarize", "write"},
		MaxTokens:    2048,
	}

	// Parent 1 has higher fitness
	child := CrossoverGenes(p1, p2, 0.8, 0.6)

	// SystemPrompt and Model should come from fitter parent (p1)
	if child.SystemPrompt != "You are a researcher" {
		t.Errorf("SystemPrompt = %q, want %q", child.SystemPrompt, "You are a researcher")
	}
	if child.Model != "claude-sonnet" {
		t.Errorf("Model = %q, want %q", child.Model, "claude-sonnet")
	}

	// Temperature should be approximately average (0.7+0.3)/2 = 0.5, ± small noise
	if child.Temperature < 0.0 || child.Temperature > 2.0 {
		t.Errorf("Temperature = %f, out of bounds [0.0, 2.0]", child.Temperature)
	}
	if math.Abs(child.Temperature-0.5) > 0.1 {
		t.Errorf("Temperature = %f, expected close to 0.5 (average)", child.Temperature)
	}

	// TopP should be approximately average (0.9+0.7)/2 = 0.8, ± small noise
	if child.TopP < 0.0 || child.TopP > 1.0 {
		t.Errorf("TopP = %f, out of bounds [0.0, 1.0]", child.TopP)
	}
	if math.Abs(child.TopP-0.8) > 0.1 {
		t.Errorf("TopP = %f, expected close to 0.8 (average)", child.TopP)
	}

	// MaxTokens should be average (4096+2048)/2 = 3072
	if child.MaxTokens != 3072 {
		t.Errorf("MaxTokens = %d, want 3072", child.MaxTokens)
	}

	// Skills should be union: {search, summarize, write}
	skillSet := make(map[string]bool)
	for _, sk := range child.Skills {
		skillSet[sk] = true
	}
	if len(child.Skills) != 3 {
		t.Errorf("Skills count = %d, want 3 (union)", len(child.Skills))
	}
	for _, expected := range []string{"search", "summarize", "write"} {
		if !skillSet[expected] {
			t.Errorf("Skills missing %q", expected)
		}
	}
}

func TestCrossoverGenes_SecondParentFitter(t *testing.T) {
	p1 := GeneSet{
		SystemPrompt: "Parent A",
		Model:        "model-a",
		Temperature:  0.5,
		TopP:         0.5,
		MaxTokens:    1000,
	}
	p2 := GeneSet{
		SystemPrompt: "Parent B",
		Model:        "model-b",
		Temperature:  0.5,
		TopP:         0.5,
		MaxTokens:    2000,
	}

	// Parent 2 is fitter
	child := CrossoverGenes(p1, p2, 0.3, 0.9)

	if child.SystemPrompt != "Parent B" {
		t.Errorf("SystemPrompt = %q, want %q (fitter parent)", child.SystemPrompt, "Parent B")
	}
	if child.Model != "model-b" {
		t.Errorf("Model = %q, want %q (fitter parent)", child.Model, "model-b")
	}
}

func TestCrossoverGenes_EqualFitness(t *testing.T) {
	p1 := GeneSet{
		SystemPrompt: "Equal A",
		Model:        "model-equal",
		Temperature:  0.5,
		TopP:         0.5,
		MaxTokens:    1000,
	}
	p2 := GeneSet{
		SystemPrompt: "Equal B",
		Model:        "model-other",
		Temperature:  0.5,
		TopP:         0.5,
		MaxTokens:    1000,
	}

	// Equal fitness: p1 wins (>= comparison)
	child := CrossoverGenes(p1, p2, 0.5, 0.5)
	if child.SystemPrompt != "Equal A" {
		t.Errorf("SystemPrompt = %q, want %q (first parent on tie)", child.SystemPrompt, "Equal A")
	}
}

// ---------------------------------------------------------------------------
// MutateGenes tests
// ---------------------------------------------------------------------------

func TestMutateGenes_BoundsRespected(t *testing.T) {
	// Run mutation many times to verify bounds are always respected
	genes := GeneSet{
		SystemPrompt: "Test prompt",
		Temperature:  1.0,
		TopP:         0.5,
		Model:        "test-model",
		Skills:       []string{"skill-a"},
		MaxTokens:    1024,
	}

	for i := 0; i < 200; i++ {
		mutated := MutateGenes(genes)

		if mutated.Temperature < 0.0 || mutated.Temperature > 2.0 {
			t.Fatalf("Iteration %d: Temperature = %f, out of bounds [0.0, 2.0]", i, mutated.Temperature)
		}
		if mutated.TopP < 0.0 || mutated.TopP > 1.0 {
			t.Fatalf("Iteration %d: TopP = %f, out of bounds [0.0, 1.0]", i, mutated.TopP)
		}
	}
}

func TestMutateGenes_PreservesNonMutatedFields(t *testing.T) {
	genes := GeneSet{
		SystemPrompt: "Preserved prompt",
		Temperature:  0.7,
		TopP:         0.9,
		Model:        "preserved-model",
		Skills:       []string{"skill-x", "skill-y"},
		MaxTokens:    2048,
	}

	mutated := MutateGenes(genes)

	// These fields should never mutate
	if mutated.SystemPrompt != genes.SystemPrompt {
		t.Errorf("SystemPrompt mutated from %q to %q", genes.SystemPrompt, mutated.SystemPrompt)
	}
	if mutated.Model != genes.Model {
		t.Errorf("Model mutated from %q to %q", genes.Model, mutated.Model)
	}
	if mutated.MaxTokens != genes.MaxTokens {
		t.Errorf("MaxTokens mutated from %d to %d", genes.MaxTokens, mutated.MaxTokens)
	}
	if len(mutated.Skills) != len(genes.Skills) {
		t.Errorf("Skills count changed from %d to %d", len(genes.Skills), len(mutated.Skills))
	}
}

func TestMutateGenes_EdgeCases(t *testing.T) {
	// Temperature at boundary 0.0 should not go below
	genes := GeneSet{Temperature: 0.0, TopP: 0.0}
	for i := 0; i < 100; i++ {
		mutated := MutateGenes(genes)
		if mutated.Temperature < 0.0 {
			t.Fatalf("Temperature went below 0: %f", mutated.Temperature)
		}
		if mutated.TopP < 0.0 {
			t.Fatalf("TopP went below 0: %f", mutated.TopP)
		}
	}

	// Temperature at boundary 2.0 should not go above
	genes2 := GeneSet{Temperature: 2.0, TopP: 1.0}
	for i := 0; i < 100; i++ {
		mutated := MutateGenes(genes2)
		if mutated.Temperature > 2.0 {
			t.Fatalf("Temperature went above 2.0: %f", mutated.Temperature)
		}
		if mutated.TopP > 1.0 {
			t.Fatalf("TopP went above 1.0: %f", mutated.TopP)
		}
	}
}

func TestMutateGenes_DoesNotAliasSkills(t *testing.T) {
	genes := GeneSet{
		Skills: []string{"a", "b", "c"},
	}
	mutated := MutateGenes(genes)

	// Modifying the mutated skills should not affect original
	if len(mutated.Skills) > 0 {
		mutated.Skills[0] = "modified"
	}
	if genes.Skills[0] != "a" {
		t.Error("MutateGenes aliased the skills slice — original was modified")
	}
}

// ---------------------------------------------------------------------------
// Helper function tests
// ---------------------------------------------------------------------------

func TestClamp(t *testing.T) {
	tests := []struct {
		v, lo, hi, want float64
	}{
		{0.5, 0.0, 1.0, 0.5},
		{-1.0, 0.0, 1.0, 0.0},
		{2.5, 0.0, 2.0, 2.0},
		{0.0, 0.0, 1.0, 0.0},
		{1.0, 0.0, 1.0, 1.0},
	}
	for _, tt := range tests {
		got := clamp(tt.v, tt.lo, tt.hi)
		if got != tt.want {
			t.Errorf("clamp(%f, %f, %f) = %f, want %f", tt.v, tt.lo, tt.hi, got, tt.want)
		}
	}
}

func TestGenerateUUID(t *testing.T) {
	id1, err := generateUUID()
	if err != nil {
		t.Fatalf("generateUUID failed: %v", err)
	}
	id2, err := generateUUID()
	if err != nil {
		t.Fatalf("generateUUID failed: %v", err)
	}

	// Should be 36 chars (8-4-4-4-12 with hyphens)
	if len(id1) != 36 {
		t.Errorf("UUID length = %d, want 36", len(id1))
	}

	// Should be unique
	if id1 == id2 {
		t.Error("Two generated UUIDs should not be equal")
	}
}
