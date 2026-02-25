package bridge

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"

	"github.com/nats-io/nats.go/jetstream"
	"github.com/openswarm/openswarm/internal/bus"
	"github.com/openswarm/openswarm/internal/domain"
	"github.com/openswarm/openswarm/internal/pool"
)

// SubjectForTopology builds the NATS subject for a topology edge.
func SubjectForTopology(swarmName, edgeSubject string) string {
	return fmt.Sprintf("swarm.%s.pipeline.%s", swarmName, edgeSubject)
}

// Message is the payload sent between agents via the bridge.
type Message struct {
	From    string `json:"from"`
	To      string `json:"to"`
	Content string `json:"content"`
	TaskID  string `json:"taskId,omitempty"`
}

// Bridge wires NATS pub/sub between agents in a swarm based on topology edges.
type Bridge struct {
	swarmName string
	bus       *bus.Bus
	pool      *pool.Pool
	topology  []domain.TopologyEdge
	consumers []jetstream.ConsumeContext
}

// New creates a Bridge for the given swarm.
func New(swarmName string, b *bus.Bus, p *pool.Pool, topology []domain.TopologyEdge) *Bridge {
	return &Bridge{
		swarmName: swarmName,
		bus:       b,
		pool:      p,
		topology:  topology,
	}
}

// Start subscribes to all topology edges and routes messages to target agents.
func (br *Bridge) Start(ctx context.Context) error {
	for _, edge := range br.topology {
		subject := SubjectForTopology(br.swarmName, edge.Subject)
		targetRole := edge.To

		slog.Info("bridge: subscribing", "subject", subject, "from", edge.From, "to", targetRole)

		cc, err := br.bus.Subscribe(subject, func(msg jetstream.Msg) {
			var m Message
			if err := json.Unmarshal(msg.Data(), &m); err != nil {
				slog.Error("bridge: unmarshal message", "error", err)
				return
			}

			instances := br.pool.ListByRole(br.swarmName, targetRole)
			if len(instances) == 0 {
				slog.Warn("bridge: no instances for target role", "role", targetRole)
				return
			}

			inst := instances[0]
			slog.Info("bridge: routing message",
				"from", m.From, "to", targetRole,
				"container", inst.ID, "content_len", len(m.Content))

			// TODO: Forward to OpenClaw container via chat proxy (Task 11)
		})
		if err != nil {
			return fmt.Errorf("bridge: subscribe %s: %w", subject, err)
		}
		br.consumers = append(br.consumers, cc)
	}

	return nil
}

// Send publishes a message from one agent to another via NATS.
func (br *Bridge) Send(ctx context.Context, from, to, content string) error {
	for _, edge := range br.topology {
		if edge.From == from && edge.To == to {
			subject := SubjectForTopology(br.swarmName, edge.Subject)
			msg := Message{
				From:    from,
				To:      to,
				Content: content,
			}
			return br.bus.PublishJSON(ctx, subject, msg)
		}
	}
	return fmt.Errorf("bridge: no topology edge from %q to %q", from, to)
}

// Stop unsubscribes all consumers.
func (br *Bridge) Stop() {
	for _, cc := range br.consumers {
		cc.Stop()
	}
	slog.Info("bridge: stopped", "swarm", br.swarmName)
}
