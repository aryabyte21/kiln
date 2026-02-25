'use client';

import { useEffect, useRef, useCallback, useState } from 'react';

export interface SSEEvent {
  type: string;
  data: unknown;
}

export function useSSE(url: string | null) {
  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<SSEEvent | null>(null);
  const sourceRef = useRef<EventSource | null>(null);

  const connect = useCallback(() => {
    if (!url) return;

    const es = new EventSource(url);
    sourceRef.current = es;

    es.addEventListener('connected', () => {
      setConnected(true);
    });

    es.addEventListener('agent_update', (e) => {
      setLastEvent({ type: 'agent_update', data: JSON.parse(e.data) });
    });

    es.addEventListener('task_update', (e) => {
      setLastEvent({ type: 'task_update', data: JSON.parse(e.data) });
    });

    es.addEventListener('cost_update', (e) => {
      setLastEvent({ type: 'cost_update', data: JSON.parse(e.data) });
    });

    es.onerror = () => {
      setConnected(false);
      es.close();
      // Reconnect after 3 seconds
      setTimeout(connect, 3000);
    };
  }, [url]);

  useEffect(() => {
    connect();
    return () => {
      sourceRef.current?.close();
    };
  }, [connect]);

  return { connected, lastEvent };
}
