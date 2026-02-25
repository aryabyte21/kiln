package sse

import (
	"testing"
	"time"
)

func TestHub_SubscribeAndBroadcast(t *testing.T) {
	hub := NewHub()

	ch, unsub := hub.Subscribe("test-swarm")
	defer unsub()

	if hub.ClientCount("test-swarm") != 1 {
		t.Fatalf("expected 1 client, got %d", hub.ClientCount("test-swarm"))
	}

	go hub.Broadcast("test-swarm", Event{Type: "task_update", Data: map[string]string{"id": "123"}})

	select {
	case evt := <-ch:
		if evt.Type != "task_update" {
			t.Errorf("expected task_update, got %s", evt.Type)
		}
	case <-time.After(time.Second):
		t.Fatal("timeout waiting for broadcast")
	}
}

func TestHub_Unsubscribe(t *testing.T) {
	hub := NewHub()

	_, unsub := hub.Subscribe("test-swarm")
	if hub.ClientCount("test-swarm") != 1 {
		t.Fatal("expected 1 client")
	}

	unsub()

	if hub.ClientCount("test-swarm") != 0 {
		t.Fatal("expected 0 clients after unsub")
	}
}

func TestHub_MultipleClients(t *testing.T) {
	hub := NewHub()

	ch1, unsub1 := hub.Subscribe("s1")
	defer unsub1()
	ch2, unsub2 := hub.Subscribe("s1")
	defer unsub2()

	if hub.ClientCount("s1") != 2 {
		t.Fatalf("expected 2 clients, got %d", hub.ClientCount("s1"))
	}

	go hub.Broadcast("s1", Event{Type: "test", Data: "hello"})

	for _, ch := range []chan Event{ch1, ch2} {
		select {
		case evt := <-ch:
			if evt.Type != "test" {
				t.Errorf("expected test, got %s", evt.Type)
			}
		case <-time.After(time.Second):
			t.Fatal("timeout")
		}
	}
}

func TestHub_BroadcastIsolation(t *testing.T) {
	hub := NewHub()

	ch1, unsub1 := hub.Subscribe("swarm-a")
	defer unsub1()
	ch2, unsub2 := hub.Subscribe("swarm-b")
	defer unsub2()

	go hub.Broadcast("swarm-a", Event{Type: "test", Data: "for-a"})

	select {
	case <-ch1:
		// expected
	case <-time.After(time.Second):
		t.Fatal("swarm-a should have received event")
	}

	select {
	case <-ch2:
		t.Fatal("swarm-b should NOT receive swarm-a events")
	case <-time.After(50 * time.Millisecond):
		// expected — no event for swarm-b
	}
}
