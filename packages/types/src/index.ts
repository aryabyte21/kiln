/** Swarm status returned by the control plane API. */
export type SwarmStatus = 'pending' | 'running' | 'stopped' | 'error';

/** Task status returned by the control plane API. */
export type TaskStatus = 'pending' | 'assigned' | 'running' | 'completed' | 'failed';

/** Agent status as tracked in the Redis registry. */
export type AgentStatus = 'idle' | 'busy' | 'draining' | 'offline';

/** Health check response from the control plane. */
export type HealthResponse = {
  status: 'ok';
  service: 'controlplane' | 'web';
};
