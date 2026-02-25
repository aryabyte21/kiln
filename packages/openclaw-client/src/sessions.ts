import type { OpenClawClient } from './client.js';
import type {
  SessionEntry,
  SessionsListParams,
  SessionsHistoryParams,
  SessionMessage,
  SessionsSendParams,
  SessionsSendResult,
  SessionsSpawnParams,
  SessionsSpawnResult,
} from './protocol.js';

/**
 * Higher-level session manager wrapping multiple OpenClaw instances.
 * Used by the OpenSwarm scheduler to dispatch tasks across a pool.
 */
export class SessionManager {
  private clients: Map<string, OpenClawClient> = new Map();

  /** Register a client by its agent ID. */
  register(agentId: string, client: OpenClawClient): void {
    this.clients.set(agentId, client);
  }

  /** Remove a client. */
  deregister(agentId: string): void {
    const client = this.clients.get(agentId);
    if (client) {
      client.close();
      this.clients.delete(agentId);
    }
  }

  /** Get a client by agent ID. */
  get(agentId: string): OpenClawClient | undefined {
    return this.clients.get(agentId);
  }

  /** List all registered agent IDs. */
  agentIds(): string[] {
    return Array.from(this.clients.keys());
  }

  /** List connected agent IDs. */
  connectedAgents(): string[] {
    return this.agentIds().filter((id) => this.clients.get(id)?.isConnected);
  }

  /** Close all clients. */
  closeAll(): void {
    for (const [, client] of this.clients) {
      client.close();
    }
    this.clients.clear();
  }

  // -----------------------------------------------------------------------
  // Pool-level session operations
  // -----------------------------------------------------------------------

  /** List sessions across all connected instances. */
  async listAllSessions(
    params?: SessionsListParams
  ): Promise<Array<SessionEntry & { agentId: string }>> {
    const results: Array<SessionEntry & { agentId: string }> = [];

    await Promise.allSettled(
      this.connectedAgents().map(async (agentId) => {
        const client = this.clients.get(agentId)!;
        const sessions = await client.sessionsList(params);
        for (const session of sessions) {
          results.push({ ...session, agentId });
        }
      })
    );

    return results;
  }

  /** Spawn a task on a specific agent. */
  async spawnTask(agentId: string, params: SessionsSpawnParams): Promise<SessionsSpawnResult> {
    const client = this.clients.get(agentId);
    if (!client?.isConnected) {
      throw new Error(`session-manager: agent ${agentId} not connected`);
    }
    return client.sessionsSpawn(params);
  }

  /** Send a message to a session on a specific agent. */
  async sendMessage(agentId: string, params: SessionsSendParams): Promise<SessionsSendResult> {
    const client = this.clients.get(agentId);
    if (!client?.isConnected) {
      throw new Error(`session-manager: agent ${agentId} not connected`);
    }
    return client.sessionsSend(params);
  }

  /** Fetch session history from a specific agent. */
  async getHistory(agentId: string, params: SessionsHistoryParams): Promise<SessionMessage[]> {
    const client = this.clients.get(agentId);
    if (!client?.isConnected) {
      throw new Error(`session-manager: agent ${agentId} not connected`);
    }
    return client.sessionsHistory(params);
  }

  /** Health-check all registered agents. Returns a map of agentId -> health. */
  async healthCheckAll(): Promise<
    Map<
      string,
      { healthy: boolean; status?: string; uptime?: number; sessions?: number; error?: string }
    >
  > {
    const results = new Map<
      string,
      { healthy: boolean; status?: string; uptime?: number; sessions?: number; error?: string }
    >();

    await Promise.allSettled(
      this.agentIds().map(async (agentId) => {
        const client = this.clients.get(agentId)!;
        if (!client.isConnected) {
          results.set(agentId, { healthy: false, error: 'not connected' });
          return;
        }
        try {
          const h = await client.health();
          results.set(agentId, { healthy: true, ...h });
        } catch (err) {
          results.set(agentId, {
            healthy: false,
            error: err instanceof Error ? err.message : 'unknown error',
          });
        }
      })
    );

    return results;
  }
}
