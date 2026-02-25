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

export type AgentExecutionState = 'idle' | 'running' | 'completed' | 'failed';

export interface EventLogEntry {
  time: string;
  type: string;
  data: Record<string, unknown>;
}

interface SwarmSSEState {
  agents: Map<string, SSEAgent>;
  tasks: Map<string, SSETask>;
  budget: SSEBudget | null;
  connected: boolean;
  lastEvent: SSEEvent | null;
  agentStates: Record<string, AgentExecutionState>;
  events: EventLogEntry[];
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

const MAX_EVENTS = 200;

type SSEAction =
  | { type: 'SET_CONNECTED'; connected: boolean }
  | { type: 'AGENT_REGISTERED'; agent: SSEAgent }
  | { type: 'AGENT_HEARTBEAT'; agent: SSEAgent }
  | { type: 'TASK_SUBMITTED'; task: SSETask }
  | { type: 'TASK_UPDATE'; task: SSETask }
  | { type: 'BUDGET_UPDATE'; budget: SSEBudget }
  | { type: 'SET_LAST_EVENT'; event: SSEEvent }
  | { type: 'TASK_RUNNING'; agentRole: string; taskId: string; agentId: string }
  | {
      type: 'TASK_COMPLETED';
      agentRole: string;
      taskId: string;
      agentId: string;
      tokens: number;
      costUsd: number;
      latencyMs: number;
      output: string;
      model: string;
    }
  | { type: 'TASK_FAILED'; agentRole: string; taskId: string; error: string; latencyMs: number }
  | { type: 'APPEND_EVENT'; entry: EventLogEntry }
  | { type: 'RESET' };

function appendEvent(events: EventLogEntry[], entry: EventLogEntry): EventLogEntry[] {
  const next = [...events, entry];
  if (next.length > MAX_EVENTS) {
    return next.slice(next.length - MAX_EVENTS);
  }
  return next;
}

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

    case 'TASK_RUNNING':
      return {
        ...state,
        agentStates: { ...state.agentStates, [action.agentRole]: 'running' },
      };

    case 'TASK_COMPLETED':
      return {
        ...state,
        agentStates: { ...state.agentStates, [action.agentRole]: 'completed' },
      };

    case 'TASK_FAILED':
      return {
        ...state,
        agentStates: { ...state.agentStates, [action.agentRole]: 'failed' },
      };

    case 'APPEND_EVENT':
      return { ...state, events: appendEvent(state.events, action.entry) };

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
    agentStates: {},
    events: [],
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

const CONTROL_PLANE_URL = process.env.NEXT_PUBLIC_CONTROLPLANE_URL || 'http://localhost:9090';

const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 1_000;

function nowTimestamp(): string {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

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
      dispatch({
        type: 'APPEND_EVENT',
        entry: { time: nowTimestamp(), type: 'connected', data: {} },
      });
    });

    // --- swarm_created ---
    es.addEventListener('swarm_created', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as Record<string, unknown>;
        dispatch({ type: 'SET_LAST_EVENT', event: { type: 'swarm_created', data } });
        dispatch({
          type: 'APPEND_EVENT',
          entry: { time: nowTimestamp(), type: 'swarm_created', data },
        });
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
        dispatch({
          type: 'APPEND_EVENT',
          entry: {
            time: nowTimestamp(),
            type: 'agent_registered',
            data: { agentId: agent.id, role: agent.role },
          },
        });
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
        dispatch({
          type: 'APPEND_EVENT',
          entry: {
            time: nowTimestamp(),
            type: 'task_submitted',
            data: { taskId: task.id, agentRole: task.agentRole },
          },
        });
      } catch {
        // Ignore malformed events
      }
    });

    // --- task_assigned ---
    es.addEventListener('task_assigned', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as Record<string, unknown>;
        dispatch({ type: 'SET_LAST_EVENT', event: { type: 'task_assigned', data } });
        dispatch({
          type: 'APPEND_EVENT',
          entry: { time: nowTimestamp(), type: 'task_assigned', data },
        });
      } catch {
        // Ignore malformed events
      }
    });

    // --- task_running ---
    es.addEventListener('task_running', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as { taskId: string; agentRole: string; agentId: string };
        dispatch({
          type: 'TASK_RUNNING',
          agentRole: data.agentRole,
          taskId: data.taskId,
          agentId: data.agentId,
        });
        dispatch({ type: 'SET_LAST_EVENT', event: { type: 'task_running', data } });
        dispatch({
          type: 'APPEND_EVENT',
          entry: { time: nowTimestamp(), type: 'task_running', data },
        });
      } catch {
        // Ignore malformed events
      }
    });

    // --- task_completed ---
    es.addEventListener('task_completed', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as {
          taskId: string;
          agentRole: string;
          agentId: string;
          tokens: number;
          costUsd: number;
          latencyMs: number;
          output: string;
          model: string;
        };
        dispatch({
          type: 'TASK_COMPLETED',
          agentRole: data.agentRole,
          taskId: data.taskId,
          agentId: data.agentId,
          tokens: data.tokens,
          costUsd: data.costUsd,
          latencyMs: data.latencyMs,
          output: data.output,
          model: data.model,
        });
        dispatch({ type: 'SET_LAST_EVENT', event: { type: 'task_completed', data } });
        dispatch({
          type: 'APPEND_EVENT',
          entry: {
            time: nowTimestamp(),
            type: 'task_completed',
            data: {
              taskId: data.taskId,
              agentRole: data.agentRole,
              tokens: data.tokens,
              costUsd: data.costUsd,
              latencyMs: data.latencyMs,
              model: data.model,
            },
          },
        });
      } catch {
        // Ignore malformed events
      }
    });

    // --- task_failed ---
    es.addEventListener('task_failed', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as {
          taskId: string;
          agentRole: string;
          error: string;
          latencyMs: number;
        };
        dispatch({
          type: 'TASK_FAILED',
          agentRole: data.agentRole,
          taskId: data.taskId,
          error: data.error,
          latencyMs: data.latencyMs,
        });
        dispatch({ type: 'SET_LAST_EVENT', event: { type: 'task_failed', data } });
        dispatch({
          type: 'APPEND_EVENT',
          entry: {
            time: nowTimestamp(),
            type: 'task_failed',
            data: {
              taskId: data.taskId,
              agentRole: data.agentRole,
              error: data.error,
              latencyMs: data.latencyMs,
            },
          },
        });
      } catch {
        // Ignore malformed events
      }
    });

    // --- task_update (generic) ---
    es.addEventListener('task_update', (e: MessageEvent) => {
      try {
        const task = JSON.parse(e.data) as SSETask;
        dispatch({ type: 'TASK_UPDATE', task });
        dispatch({ type: 'SET_LAST_EVENT', event: { type: 'task_update', data: task } });
        dispatch({
          type: 'APPEND_EVENT',
          entry: {
            time: nowTimestamp(),
            type: 'task_update',
            data: { taskId: task.id, agentRole: task.agentRole, status: task.status },
          },
        });
      } catch {
        // Ignore malformed events
      }
    });

    // --- budget_update ---
    es.addEventListener('budget_update', (e: MessageEvent) => {
      try {
        const budget = JSON.parse(e.data) as SSEBudget;
        dispatch({ type: 'BUDGET_UPDATE', budget });
        dispatch({ type: 'SET_LAST_EVENT', event: { type: 'budget_update', data: budget } });
        dispatch({
          type: 'APPEND_EVENT',
          entry: {
            time: nowTimestamp(),
            type: 'budget_update',
            data: { spent: budget.spent, percent: budget.percent },
          },
        });
      } catch {
        // Ignore malformed events
      }
    });

    // --- pipeline_message ---
    es.addEventListener('pipeline_message', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as Record<string, unknown>;
        dispatch({ type: 'SET_LAST_EVENT', event: { type: 'pipeline_message', data } });
        dispatch({
          type: 'APPEND_EVENT',
          entry: { time: nowTimestamp(), type: 'pipeline_message', data },
        });
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
    agentStates: state.agentStates,
    events: state.events,
  };
}

// Re-export the old hook name for backwards compatibility
export { useSwarmSSE as useSSE };
