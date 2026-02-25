package domain

import "testing"

func TestDefaultsSpecZeroValue(t *testing.T) {
	var d DefaultsSpec
	if d.Model != "" {
		t.Errorf("zero DefaultsSpec.Model should be empty, got %q", d.Model)
	}
	if d.Config != nil {
		t.Errorf("zero DefaultsSpec.Config should be nil")
	}
}

func TestCronJobFields(t *testing.T) {
	cj := CronJob{
		Name:     "morning-check",
		Schedule: "0 8 * * *",
		Task:     "Review overnight messages",
	}
	if cj.Name != "morning-check" {
		t.Errorf("CronJob.Name = %q, want %q", cj.Name, "morning-check")
	}
	if cj.Schedule != "0 8 * * *" {
		t.Errorf("CronJob.Schedule = %q, want %q", cj.Schedule, "0 8 * * *")
	}
}
