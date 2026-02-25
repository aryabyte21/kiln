package lifecycle

import (
	"testing"
	"time"
)

func TestReconcileInterval(t *testing.T) {
	if reconcileInterval != 5*time.Second {
		t.Errorf("expected 5s reconcile interval, got %v", reconcileInterval)
	}
}

func TestNewManager(t *testing.T) {
	// New should accept nil dependencies without panicking (for unit tests)
	m := New(nil, nil, nil, nil)
	if m == nil {
		t.Fatal("expected non-nil manager")
	}
	if m.store != nil {
		t.Error("expected nil store")
	}
	if m.registry != nil {
		t.Error("expected nil registry")
	}
	if m.pool != nil {
		t.Error("expected nil pool")
	}
	if m.hub != nil {
		t.Error("expected nil hub")
	}
}

func TestStopWithoutStart(t *testing.T) {
	m := New(nil, nil, nil, nil)
	// Stop should not panic even if Start was never called
	m.Stop()
}
