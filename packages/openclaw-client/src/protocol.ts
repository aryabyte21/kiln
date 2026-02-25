// Wire protocol types for the OpenClaw Gateway WebSocket connection.
// Based on the Gateway protocol: every message is a Request, Response, or Event frame.

// ---------------------------------------------------------------------------
// Frame types
// ---------------------------------------------------------------------------

export interface RequestFrame {
  type: 'req';
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

export interface ResponseFrame {
  type: 'res';
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: { code: string; message: string };
}

export interface EventFrame {
  type: 'event';
  event: string;
  payload: unknown;
  seq?: number;
  stateVersion?: number;
}

export type Frame = RequestFrame | ResponseFrame | EventFrame;

// ---------------------------------------------------------------------------
// Connect handshake
// ---------------------------------------------------------------------------

export interface ConnectParams {
  minProtocol: number;
  maxProtocol: number;
  client: {
    id: string;
    version: string;
    platform: string;
    mode: string;
  };
  role: 'operator' | 'user';
  scopes: string[];
  caps: string[];
  commands: string[];
  permissions: Record<string, unknown>;
  auth: { token: string };
  locale: string;
  userAgent: string;
}

// ---------------------------------------------------------------------------
// Session types
// ---------------------------------------------------------------------------

export type SessionKind = 'main' | 'group' | 'cron' | 'hook' | 'node' | 'other';

export interface SessionEntry {
  key: string;
  kind: SessionKind;
  channel: string;
  displayName?: string;
  updatedAt: number;
  sessionId: string;
  model: string;
  contextTokens: number;
  totalTokens: number;
  messages?: SessionMessage[];
}

export interface SessionMessage {
  role: string;
  content: string;
  timestamp?: number;
}

// ---------------------------------------------------------------------------
// sessions.list
// ---------------------------------------------------------------------------

export interface SessionsListParams {
  kinds?: SessionKind[];
  limit?: number;
  activeMinutes?: number;
  messageLimit?: number;
}

// ---------------------------------------------------------------------------
// sessions.send
// ---------------------------------------------------------------------------

export interface SessionsSendParams {
  sessionKey: string;
  message: string;
  timeoutSeconds?: number;
}

export interface SessionsSendResult {
  runId: string;
  status: 'accepted' | 'ok' | 'timeout' | 'error';
  reply?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// sessions.spawn
// ---------------------------------------------------------------------------

export interface SessionsSpawnParams {
  task: string;
  label?: string;
  agentId?: string;
  model?: string;
  runTimeoutSeconds?: number;
  cleanup?: 'delete' | 'keep';
}

export interface SessionsSpawnResult {
  status: string;
  runId: string;
  childSessionKey: string;
}

// ---------------------------------------------------------------------------
// sessions.history
// ---------------------------------------------------------------------------

export interface SessionsHistoryParams {
  sessionKey: string;
  limit?: number;
  includeTools?: boolean;
}

// ---------------------------------------------------------------------------
// Agent events
// ---------------------------------------------------------------------------

export interface AgentDeltaEvent {
  sessionId: string;
  delta: string;
  role?: string;
}

export interface AgentDoneEvent {
  sessionId: string;
  runId: string;
  tokensUsed: number;
  durationMs: number;
}

export interface HealthEvent {
  status: string;
  uptime: number;
  sessions: number;
}

// ---------------------------------------------------------------------------
// Event type map
// ---------------------------------------------------------------------------

export interface EventMap {
  tick: { ts: number };
  presence: { sessions: number };
  agent: AgentDeltaEvent;
  'agent.done': AgentDoneEvent;
  health: HealthEvent;
  shutdown: { reason: string };
  chat: { sessionKey: string; message: SessionMessage };
}

export type EventName = keyof EventMap;
