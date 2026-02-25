// Package sse implements a Server-Sent Events hub that broadcasts
// real-time events from NATS to connected dashboard clients.
package sse

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
)

// Event is a Server-Sent Event payload.
type Event struct {
	Type string `json:"type"`
	Data any    `json:"data"`
}

// Hub manages SSE client connections per swarm.
type Hub struct {
	mu      sync.RWMutex
	clients map[string]map[chan Event]struct{} // swarm → set of channels
}

// NewHub creates an SSE Hub.
func NewHub() *Hub {
	return &Hub{
		clients: make(map[string]map[chan Event]struct{}),
	}
}

// Subscribe adds a client channel for a swarm. Returns the channel and
// an unsubscribe function.
func (h *Hub) Subscribe(swarm string) (chan Event, func()) {
	ch := make(chan Event, 64)

	h.mu.Lock()
	if h.clients[swarm] == nil {
		h.clients[swarm] = make(map[chan Event]struct{})
	}
	h.clients[swarm][ch] = struct{}{}
	h.mu.Unlock()

	unsub := func() {
		h.mu.Lock()
		delete(h.clients[swarm], ch)
		if len(h.clients[swarm]) == 0 {
			delete(h.clients, swarm)
		}
		h.mu.Unlock()
		close(ch)
	}

	return ch, unsub
}

// Broadcast sends an event to all clients subscribed to a swarm.
func (h *Hub) Broadcast(swarm string, evt Event) {
	h.mu.RLock()
	clients := h.clients[swarm]
	h.mu.RUnlock()

	for ch := range clients {
		select {
		case ch <- evt:
		default:
			slog.Warn("sse: dropping event for slow client", "swarm", swarm)
		}
	}
}

// ClientCount returns the number of connected clients for a swarm.
func (h *Hub) ClientCount(swarm string) int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients[swarm])
}

// ServeSwarm handles an SSE connection for a specific swarm.
func (h *Hub) ServeSwarm(w http.ResponseWriter, r *http.Request, swarm string) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	// Send connected event
	fmt.Fprintf(w, "event: connected\ndata: {\"status\":\"connected\",\"swarm\":%q}\n\n", swarm)
	flusher.Flush()

	ch, unsub := h.Subscribe(swarm)
	defer unsub()

	slog.Info("sse: client connected", "swarm", swarm)

	for {
		select {
		case <-r.Context().Done():
			slog.Info("sse: client disconnected", "swarm", swarm)
			return
		case evt, ok := <-ch:
			if !ok {
				return
			}
			data, _ := json.Marshal(evt.Data)
			fmt.Fprintf(w, "event: %s\ndata: %s\n\n", evt.Type, data)
			flusher.Flush()
		}
	}
}
