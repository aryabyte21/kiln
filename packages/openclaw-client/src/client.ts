import WebSocket from 'ws';
import type {
  ConnectParams,
  Frame,
  RequestFrame,
  ResponseFrame,
  SessionEntry,
  SessionsHistoryParams,
  SessionsListParams,
  SessionMessage,
  SessionsSendParams,
  SessionsSendResult,
  SessionsSpawnParams,
  SessionsSpawnResult,
} from './protocol.js';
import { EventBus } from './events.js';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface OpenClawClientOptions {
  /** WebSocket URL of the Gateway (e.g. ws://localhost:18789). */
  url: string;
  /** Authentication token for the Gateway. */
  token: string;
  /** Client identifier (default: "openswarm"). */
  clientId?: string;
  /** Client version (default: "0.1.0"). */
  clientVersion?: string;
  /** Auto-reconnect on disconnect (default: true). */
  autoReconnect?: boolean;
  /** Reconnect delay in ms (default: 3000). */
  reconnectDelay?: number;
  /** Request timeout in ms (default: 30000). */
  requestTimeout?: number;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/**
 * OpenClaw Gateway WebSocket client for the OpenSwarm orchestrator.
 *
 * Provides typed methods for session management, task dispatch,
 * and real-time event streaming from OpenClaw instances.
 */
export class OpenClawClient {
  readonly events = new EventBus();

  private ws: WebSocket | null = null;
  private connected = false;
  private reconnecting = false;
  private requestId = 0;
  private pending = new Map<
    string,
    {
      resolve: (v: unknown) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  private readonly url: string;
  private readonly token: string;
  private readonly clientId: string;
  private readonly clientVersion: string;
  private readonly autoReconnect: boolean;
  private readonly reconnectDelay: number;
  private readonly requestTimeout: number;

  constructor(opts: OpenClawClientOptions) {
    this.url = opts.url;
    this.token = opts.token;
    this.clientId = opts.clientId ?? 'openswarm';
    this.clientVersion = opts.clientVersion ?? '0.1.0';
    this.autoReconnect = opts.autoReconnect ?? true;
    this.reconnectDelay = opts.reconnectDelay ?? 3000;
    this.requestTimeout = opts.requestTimeout ?? 30_000;
  }

  /** Whether the client is currently connected and authenticated. */
  get isConnected(): boolean {
    return this.connected;
  }

  // -----------------------------------------------------------------------
  // Connection lifecycle
  // -----------------------------------------------------------------------

  /** Connect to the Gateway and perform the handshake. */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);

      this.ws.on('open', async () => {
        try {
          await this.handshake();
          this.connected = true;
          this.reconnecting = false;
          resolve();
        } catch (err) {
          reject(err);
        }
      });

      this.ws.on('message', (data) => {
        this.handleMessage(data.toString());
      });

      this.ws.on('close', () => {
        this.connected = false;
        this.rejectAllPending('connection closed');
        if (this.autoReconnect && !this.reconnecting) {
          this.scheduleReconnect();
        }
      });

      this.ws.on('error', (err) => {
        if (!this.connected) {
          reject(err);
        }
      });
    });
  }

  /** Gracefully close the connection. */
  close(): void {
    if (this.autoReconnect) this.reconnecting = true; // suppress reconnect
    this.connected = false;
    this.rejectAllPending('client closed');
    this.events.clear();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  // -----------------------------------------------------------------------
  // Session methods
  // -----------------------------------------------------------------------

  /** List active sessions on this Gateway instance. */
  async sessionsList(params?: SessionsListParams): Promise<SessionEntry[]> {
    return (await this.request('sessions.list', params ?? {})) as SessionEntry[];
  }

  /** Fetch transcript history for a session. */
  async sessionsHistory(params: SessionsHistoryParams): Promise<SessionMessage[]> {
    return (await this.request('sessions.history', params)) as SessionMessage[];
  }

  /** Send a message into another session (inter-agent communication). */
  async sessionsSend(params: SessionsSendParams): Promise<SessionsSendResult> {
    return (await this.request('sessions.send', params)) as SessionsSendResult;
  }

  /** Spawn a sub-agent in an isolated session. */
  async sessionsSpawn(params: SessionsSpawnParams): Promise<SessionsSpawnResult> {
    return (await this.request('sessions.spawn', params)) as SessionsSpawnResult;
  }

  // -----------------------------------------------------------------------
  // Utility methods
  // -----------------------------------------------------------------------

  /** Check Gateway health. */
  async health(): Promise<{ status: string; uptime: number; sessions: number }> {
    return (await this.request('health', {})) as {
      status: string;
      uptime: number;
      sessions: number;
    };
  }

  /** Get Gateway status. */
  async status(): Promise<Record<string, unknown>> {
    return (await this.request('status', {})) as Record<string, unknown>;
  }

  // -----------------------------------------------------------------------
  // Low-level request/response
  // -----------------------------------------------------------------------

  /** Send a typed request and wait for the matching response. */
  async request(method: string, params: Record<string, unknown> | object): Promise<unknown> {
    if (!this.ws || !this.connected) {
      throw new Error('openclaw-client: not connected');
    }

    const id = `osw-${++this.requestId}`;

    const frame: RequestFrame = {
      type: 'req',
      id,
      method,
      params: params as Record<string, unknown>,
    };
    this.ws.send(JSON.stringify(frame));

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(`openclaw-client: request ${method} timed out after ${this.requestTimeout}ms`)
        );
      }, this.requestTimeout);

      this.pending.set(id, { resolve, reject, timer });
    });
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  private async handshake(): Promise<void> {
    const connectParams: ConnectParams = {
      minProtocol: 3,
      maxProtocol: 3,
      client: {
        id: this.clientId,
        version: this.clientVersion,
        platform: process.platform,
        mode: 'operator',
      },
      role: 'operator',
      scopes: ['operator.read', 'operator.write'],
      caps: [],
      commands: [],
      permissions: {},
      auth: { token: this.token },
      locale: 'en-US',
      userAgent: `openswarm-openclaw-client/${this.clientVersion}`,
    };

    const result = await this.request(
      'connect',
      connectParams as unknown as Record<string, unknown>
    );
    if (!result) {
      throw new Error('openclaw-client: handshake failed — no response');
    }
  }

  private handleMessage(raw: string): void {
    let frame: Frame;
    try {
      frame = JSON.parse(raw) as Frame;
    } catch {
      return; // ignore malformed frames
    }

    switch (frame.type) {
      case 'res':
        this.handleResponse(frame);
        break;
      case 'event':
        this.events.emit(frame);
        break;
      case 'req':
        // Server-initiated requests (rare) — ignore for now
        break;
    }
  }

  private handleResponse(frame: ResponseFrame): void {
    const pending = this.pending.get(frame.id);
    if (!pending) return;

    this.pending.delete(frame.id);
    clearTimeout(pending.timer);

    if (frame.ok) {
      pending.resolve(frame.payload);
    } else {
      pending.reject(
        new Error(
          `openclaw-client: ${frame.error?.code ?? 'unknown'}: ${frame.error?.message ?? 'request failed'}`
        )
      );
    }
  }

  private rejectAllPending(reason: string): void {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error(`openclaw-client: ${reason}`));
      this.pending.delete(id);
    }
  }

  private scheduleReconnect(): void {
    this.reconnecting = true;
    setTimeout(async () => {
      try {
        await this.connect();
      } catch {
        // connect() will schedule another reconnect on close
      }
    }, this.reconnectDelay);
  }
}
