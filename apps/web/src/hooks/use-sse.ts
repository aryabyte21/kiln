'use client';

import { useEffect, useRef, useCallback, useReducer } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SSEAgent {
  id: string;
  swarmName: string;
  role: string;
  status: string;
  model: string;
  openclawAddr: string;
  registeredAt: string;
  lastSeen: string;
}

export interface SSETask {
  id: string;
  swarmName: string;
  agentRole: string;
  status: string;
  input?: string;
  tokensUsed: number;
  costUsd: number;
  createdAt: string;
}

export interface SSEBudget {
  total: number;
  spent: number;
  taskCount: number;
  alertAt: number;
  hardStop: number;
  percent: number;
}

export interface SSEEvent {
  type: string;
  data: unknown;
}

interface SwarmSSEState {
  agents: Map<string, SSEAgent>;
  tasks: Map<string, SSETask>;
  budget: SSEBudget | null;
  connected: boolean;
  lastEvent: SSEEvent | null;
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

type SSEAction =
  | { type: 'SET_CONNECTED'; connected: boolean }
  | { type: 'AGENT_REGISTERED'; agent: SSEAgent }
  | { type: 'AGENT_HEARTBEAT'; agent: SSEAgent }
  | { type: 'TASK_SUBMITTED'; task: SSETask }
  | { type: 'TASK_UPDATE'; task: SSETask }
  | { type: 'BUDGET_UPDATE'; budget: SSEBudget }
  | { type: 'SET_LAST_EVENT'; event: SSEEvent }
  | { type: 'RESET' };

function sseReducer(state: SwarmSSEState, action: SSEAction): SwarmSSEState {
  switch (action.type) {
    case 'SET_CONNECTED':
      return { ...state, connected: action.connected };

    case 'AGENT_REGISTERED':
    case 'AGENT_HEARTBEAT': {
      const agents = new Map(state.agents);
      agents.set(action.agent.id, action.agent);
      return { ...state, agents };
    }

    case 'TASK_SUBMITTED':
    case 'TASK_UPDATE': {
      const tasks = new Map(state.tasks);
      tasks.set(action.task.id, action.task);
      return { ...state, tasks };
    }

    case 'BUDGET_UPDATE':
      return { ...state, budget: action.budget };

    case 'SET_LAST_EVENT':
      return { ...state, lastEvent: action.event };

    case 'RESET':
      return initialState();

    default:
      return state;
  }
}

function initialState(): SwarmSSEState {
  return {
    agents: new Map(),
    tasks: new Map(),
    budget: null,
    connected: false,
    lastEvent: null,
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

const CONTROL_PLANE_URL = process.env.NEXT_PUBLIC_CONTROLPLANE_URL || 'http://localhost:9090';

const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 1_000;

export function useSwarmSSE(swarmName: string | null) {
  const [state, dispatch] = useReducer(sseReducer, undefined, initialState);
  const sourceRef = useRef<EventSource | null>(null);
  const retriesRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (sourceRef.current) {
      sourceRef.current.close();
      sourceRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    if (!swarmName) return;

    cleanup();

    const url = `${CONTROL_PLANE_URL}/api/v1/swarms/${swarmName}/events`;
    const es = new EventSource(url);
    sourceRef.current = es;

    // --- connected ---
    es.addEventListener('connected', () => {
      retriesRef.current = 0;
      dispatch({ type: 'SET_CONNECTED', connected: true });
      dispatch({ type: 'SET_LAST_EVENT', event: { type: 'connected', data: null } });
    });

    // --- swarm_created ---
    es.addEventListener('swarm_created', (e: MessageEvent) => {
      try {
        const data: unknown = JSON.parse(e.data);
        dispatch({ type: 'SET_LAST_EVENT', event: { type: 'swarm_created', data } });
      } catch {
        // Ignore malformed events
      }
    });

    // --- agent_registered ---
    es.addEventListener('agent_registered', (e: MessageEvent) => {
      try {
        const agent = JSON.parse(e.data) as SSEAgent;
        dispatch({ type: 'AGENT_REGISTERED', agent });
        dispatch({ type: 'SET_LAST_EVENT', event: { type: 'agent_registered', data: agent } });
      } catch {
        // Ignore malformed events
      }
    });

    // --- agent_heartbeat ---
    es.addEventListener('agent_heartbeat', (e: MessageEvent) => {
      try {
        const agent = JSON.parse(e.data) as SSEAgent;
        dispatch({ type: 'AGENT_HEARTBEAT', agent });
        dispatch({ type: 'SET_LAST_EVENT', event: { type: 'agent_heartbeat', data: agent } });
      } catch {
        // Ignore malformed events
      }
    });

    // --- task_submitted ---
    es.addEventListener('task_submitted', (e: MessageEvent) => {
      try {
        const task = JSON.parse(e.data) as SSETask;
        dispatch({ type: 'TASK_SUBMITTED', task });
        dispatch({ type: 'SET_LAST_EVENT', event: { type: 'task_submitted', data: task } });
      } catch {
        // Ignore malformed events
      }
    });

    // --- task_update ---
    es.addEventListener('task_update', (e: MessageEvent) => {
      try {
        const task = JSON.parse(e.data) as SSETask;
        dispatch({ type: 'TASK_UPDATE', task });
        dispatch({ type: 'SET_LAST_EVENT', event: { type: 'task_update', data: task } });
      } catch {
        // Ignore malformed events
      }
    });

    // --- budget_update (included in some task events) ---
    es.addEventListener('budget_update', (e: MessageEvent) => {
      try {
        const budget = JSON.parse(e.data) as SSEBudget;
        dispatch({ type: 'BUDGET_UPDATE', budget });
        dispatch({ type: 'SET_LAST_EVENT', event: { type: 'budget_update', data: budget } });
      } catch {
        // Ignore malformed events
      }
    });

    // --- error / reconnect with exponential backoff ---
    es.onerror = () => {
      dispatch({ type: 'SET_CONNECTED', connected: false });
      es.close();
      sourceRef.current = null;

      const backoff = Math.min(BASE_BACKOFF_MS * Math.pow(2, retriesRef.current), MAX_BACKOFF_MS);
      retriesRef.current += 1;

      timerRef.current = setTimeout(connect, backoff);
    };
  }, [swarmName, cleanup]);

  useEffect(() => {
    dispatch({ type: 'RESET' });
    connect();
    return cleanup;
  }, [connect, cleanup]);

  return {
    agents: Array.from(state.agents.values()),
    tasks: Array.from(state.tasks.values()),
    budget: state.budget,
    connected: state.connected,
    lastEvent: state.lastEvent,
  };
}

// Re-export the old hook name for backwards compatibility
export { useSwarmSSE as useSSE };
