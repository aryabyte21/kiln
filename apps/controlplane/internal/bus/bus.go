// Package bus wraps NATS JetStream for inter-agent messaging within an
// OpenSwarm control plane. It creates the required streams on startup and
// exposes publish, subscribe, queue-subscribe, and request-reply primitives.
package bus

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
)

// Bus is the central messaging abstraction over a NATS JetStream connection.
type Bus struct {
	nc *nats.Conn
	js jetstream.JetStream
}

// New connects to the NATS server at natsURL, creates a JetStream context,
// and idempotently provisions the required streams. It returns a ready-to-use
// Bus or an error if any step fails.
func New(ctx context.Context, natsURL string) (*Bus, error) {
	nc, err := nats.Connect(natsURL)
	if err != nil {
		return nil, fmt.Errorf("bus: nats connect: %w", err)
	}
	slog.Info("bus: connected to NATS", "url", natsURL)

	js, err := jetstream.New(nc)
	if err != nil {
		nc.Close()
		return nil, fmt.Errorf("bus: jetstream init: %w", err)
	}

	b := &Bus{nc: nc, js: js}

	if err := b.ensureStreams(ctx); err != nil {
		nc.Close()
		return nil, fmt.Errorf("bus: ensure streams: %w", err)
	}

	return b, nil
}

// Close drains and closes the underlying NATS connection.
func (b *Bus) Close() {
	if b.nc != nil {
		_ = b.nc.Drain()
		b.nc.Close()
		slog.Info("bus: NATS connection closed")
	}
}

// ---------------------------------------------------------------------------
// Publish
// ---------------------------------------------------------------------------

// Publish sends raw bytes to a JetStream subject.
func (b *Bus) Publish(ctx context.Context, subject string, data []byte) error {
	_, err := b.js.Publish(ctx, subject, data)
	if err != nil {
		return fmt.Errorf("bus: publish %s: %w", subject, err)
	}
	return nil
}

// PublishJSON marshals v as JSON and publishes the result to a JetStream
// subject.
func (b *Bus) PublishJSON(ctx context.Context, subject string, v any) error {
	data, err := json.Marshal(v)
	if err != nil {
		return fmt.Errorf("bus: marshal: %w", err)
	}
	return b.Publish(ctx, subject, data)
}

// ---------------------------------------------------------------------------
// Subscribe (core NATS -- for lightweight pub/sub like heartbeats)
// ---------------------------------------------------------------------------

// Subscribe uses core NATS (non-JetStream) for simple pub/sub on subjects
// that do not require persistence, such as heartbeats and registration events.
// The handler receives a thin adapter that implements jetstream.Msg so callers
// can use a uniform callback signature across Subscribe and QueueSubscribe.
func (b *Bus) Subscribe(subject string, handler func(msg jetstream.Msg)) (jetstream.ConsumeContext, error) {
	sub, err := b.nc.Subscribe(subject, func(m *nats.Msg) {
		handler(&coreMsg{m: m})
	})
	if err != nil {
		return nil, fmt.Errorf("bus: subscribe %s: %w", subject, err)
	}
	slog.Info("bus: subscribed", "subject", subject)
	return newCoreConsumeCtx(sub), nil
}

// ---------------------------------------------------------------------------
// QueueSubscribe (JetStream -- durable, load-balanced consumption)
// ---------------------------------------------------------------------------

// QueueSubscribe creates (or updates) a durable JetStream consumer on the
// given stream, filtered to subject, and starts consuming messages. Multiple
// instances sharing the same consumer name will load-balance delivery.
func (b *Bus) QueueSubscribe(stream, consumer, subject string, handler func(msg jetstream.Msg)) (jetstream.ConsumeContext, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	cons, err := b.js.CreateOrUpdateConsumer(ctx, stream, jetstream.ConsumerConfig{
		Durable:       consumer,
		AckPolicy:     jetstream.AckExplicitPolicy,
		FilterSubject: subject,
	})
	if err != nil {
		return nil, fmt.Errorf("bus: create consumer %s/%s: %w", stream, consumer, err)
	}

	cc, err := cons.Consume(handler)
	if err != nil {
		return nil, fmt.Errorf("bus: consume %s/%s: %w", stream, consumer, err)
	}
	slog.Info("bus: queue subscribed", "stream", stream, "consumer", consumer, "subject", subject)
	return cc, nil
}

// ---------------------------------------------------------------------------
// Request-Reply (core NATS)
// ---------------------------------------------------------------------------

// Request performs a synchronous request-reply exchange over core NATS. This
// is used for direct agent communication (e.g. task assignment and response).
func (b *Bus) Request(subject string, data []byte, timeout time.Duration) (*nats.Msg, error) {
	msg, err := b.nc.Request(subject, data, timeout)
	if err != nil {
		return nil, fmt.Errorf("bus: request %s: %w", subject, err)
	}
	return msg, nil
}

// ---------------------------------------------------------------------------
// JetStream accessor
// ---------------------------------------------------------------------------

// JetStream returns the underlying jetstream.JetStream handle for advanced
// use cases that the Bus helpers do not cover.
func (b *Bus) JetStream() jetstream.JetStream {
	return b.js
}

// ---------------------------------------------------------------------------
// Stream provisioning
// ---------------------------------------------------------------------------

// ensureStreams idempotently creates all JetStream streams required by the
// control plane. CreateOrUpdateStream is used so the call is safe to repeat
// on every startup.
func (b *Bus) ensureStreams(ctx context.Context) error {
	streams := []jetstream.StreamConfig{
		{
			Name:      "TASKS",
			Subjects:  []string{"swarm.*.task.>"},
			Retention: jetstream.InterestPolicy,
			MaxAge:    24 * time.Hour,
			Replicas:  1,
		},
		{
			Name:      "PIPELINE",
			Subjects:  []string{"swarm.*.pipeline.>"},
			Retention: jetstream.WorkQueuePolicy,
			MaxAge:    1 * time.Hour,
			Replicas:  1,
		},
		{
			Name:      "AUDIT",
			Subjects:  []string{"swarm.*.audit.>"},
			Retention: jetstream.WorkQueuePolicy,
			MaxAge:    720 * time.Hour, // 30 days
			Storage:   jetstream.FileStorage,
			Replicas:  1,
		},
		{
			Name:      "GENOME",
			Subjects:  []string{"swarm.*.genome.>"},
			Retention: jetstream.LimitsPolicy,
			MaxMsgs:   1000,
			Replicas:  1,
		},
	}

	for _, cfg := range streams {
		if _, err := b.js.CreateOrUpdateStream(ctx, cfg); err != nil {
			return fmt.Errorf("stream %s: %w", cfg.Name, err)
		}
		slog.Info("bus: stream ready", "stream", cfg.Name, "subjects", cfg.Subjects)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Core NATS adapters
// ---------------------------------------------------------------------------
// Subscribe() uses core NATS for non-persistent subjects (heartbeats, etc.)
// but returns jetstream.ConsumeContext and passes jetstream.Msg to handlers so
// that callers can treat all subscriptions uniformly.

// coreConsumeCtx adapts a core *nats.Subscription to the
// jetstream.ConsumeContext interface.
type coreConsumeCtx struct {
	sub    *nats.Subscription
	closed chan struct{}
}

func newCoreConsumeCtx(sub *nats.Subscription) *coreConsumeCtx {
	return &coreConsumeCtx{
		sub:    sub,
		closed: make(chan struct{}),
	}
}

func (c *coreConsumeCtx) Stop() {
	if c.sub != nil {
		_ = c.sub.Unsubscribe()
	}
	select {
	case <-c.closed:
	default:
		close(c.closed)
	}
}

func (c *coreConsumeCtx) Drain() {
	if c.sub != nil {
		_ = c.sub.Drain()
	}
	select {
	case <-c.closed:
	default:
		close(c.closed)
	}
}

func (c *coreConsumeCtx) Closed() <-chan struct{} {
	return c.closed
}

// coreMsg adapts a core *nats.Msg to the jetstream.Msg interface. Ack-related
// methods are no-ops because core NATS messages have at-most-once delivery and
// do not participate in JetStream acknowledgement.
type coreMsg struct {
	m *nats.Msg
}

func (c *coreMsg) Data() []byte         { return c.m.Data }
func (c *coreMsg) Subject() string      { return c.m.Subject }
func (c *coreMsg) Reply() string        { return c.m.Reply }
func (c *coreMsg) Headers() nats.Header { return c.m.Header }

func (c *coreMsg) Metadata() (*jetstream.MsgMetadata, error) {
	return nil, fmt.Errorf("bus: no JetStream metadata on core NATS message")
}

// Ack-family methods are no-ops for core NATS messages.
func (c *coreMsg) Ack() error                         { return nil }
func (c *coreMsg) DoubleAck(_ context.Context) error  { return nil }
func (c *coreMsg) Nak() error                         { return nil }
func (c *coreMsg) NakWithDelay(_ time.Duration) error { return nil }
func (c *coreMsg) InProgress() error                  { return nil }
func (c *coreMsg) Term() error                        { return nil }
func (c *coreMsg) TermWithReason(_ string) error      { return nil }
