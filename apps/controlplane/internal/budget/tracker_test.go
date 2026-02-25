package budget

import "testing"

func TestParseBudgetTotal(t *testing.T) {
	tests := []struct {
		input string
		want  float64
	}{
		{"$1.00", 1.0},
		{"$2.50", 2.5},
		{"$0.05", 0.05},
		{"1.00", 1.0},
	}
	for _, tt := range tests {
		got := parseDollarAmount(tt.input)
		if got != tt.want {
			t.Errorf("parseDollarAmount(%q) = %f, want %f", tt.input, got, tt.want)
		}
	}
}

func TestBudgetState_IsBankrupt(t *testing.T) {
	s := BudgetState{Total: 1.0, Spent: 1.0, HardStop: 100}
	if !s.IsBankrupt() {
		t.Error("expected bankrupt when spent == total at 100% hardStop")
	}
	s2 := BudgetState{Total: 1.0, Spent: 0.5, HardStop: 100}
	if s2.IsBankrupt() {
		t.Error("should not be bankrupt at 50%")
	}
}

func TestBudgetState_ShouldAlert(t *testing.T) {
	s := BudgetState{Total: 1.0, Spent: 0.85, AlertAt: 80}
	if !s.ShouldAlert() {
		t.Error("expected alert at 85% with alertAt 80%")
	}
	s2 := BudgetState{Total: 1.0, Spent: 0.5, AlertAt: 80}
	if s2.ShouldAlert() {
		t.Error("should not alert at 50%")
	}
}
