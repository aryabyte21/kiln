import type { EventFrame, EventMap, EventName } from './protocol.js';

type Listener<T> = (data: T) => void;

/**
 * Type-safe event emitter for OpenClaw Gateway events.
 * Supports typed event subscription and wildcard listeners.
 */
export class EventBus {
  private listeners = new Map<string, Set<Listener<unknown>>>();
  private wildcardListeners = new Set<Listener<EventFrame>>();

  /** Subscribe to a specific event type. */
  on<K extends EventName>(event: K, listener: Listener<EventMap[K]>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as Listener<unknown>);

    return () => {
      set!.delete(listener as Listener<unknown>);
    };
  }

  /** Subscribe to all events (raw frames). */
  onAny(listener: Listener<EventFrame>): () => void {
    this.wildcardListeners.add(listener);
    return () => {
      this.wildcardListeners.delete(listener);
    };
  }

  /** Emit an event frame to registered listeners. */
  emit(frame: EventFrame): void {
    const set = this.listeners.get(frame.event);
    if (set) {
      for (const listener of set) {
        listener(frame.payload);
      }
    }
    for (const listener of this.wildcardListeners) {
      listener(frame);
    }
  }

  /** Remove all listeners. */
  clear(): void {
    this.listeners.clear();
    this.wildcardListeners.clear();
  }
}
