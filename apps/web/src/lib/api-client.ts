const CONTROLPLANE_URL = process.env.NEXT_PUBLIC_CONTROLPLANE_URL || 'http://localhost:9090';

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${CONTROLPLANE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API error (${res.status}): ${body}`);
  }
  return res.json();
}

export interface Swarm {
  id: string;
  name: string;
  status: string;
  spec: SwarmSpec;
  createdAt: string;
  updatedAt: string;
}

export interface SwarmSpec {
  budget: { total: string; perTask?: string; alertAt: number; hardStop: number };
  agents: AgentSpec[];
  topology: TopologyEdge[];
  memory?: { l2?: { backend: string; ttl: number }; l3?: { backend: string; collection: string } };
  audit?: { enabled: boolean; hashChaining: boolean; retentionDays: number };
}

export interface AgentSpec {
  name: string;
  replicas: { min: number; max: number; scaleOn?: string };
  model: string;
  skills?: string[];
  policy?: string;
  dependsOn?: string[];
}

export interface TopologyEdge {
  from: string;
  to: string;
  subject: string;
}

export interface Agent {
  id: string;
  swarmName: string;
  role: string;
  status: string;
  model: string;
  openclawAddr: string;
  registeredAt: string;
  lastSeen: string;
}

export interface Task {
  id: string;
  swarmName: string;
  agentRole: string;
  status: string;
  tokensUsed: number;
  costUsd: number;
  createdAt: string;
}

// Fetch helpers
export const listSwarms = () => apiFetch<Swarm[]>('/api/v1/swarms');
export const getSwarm = (name: string) => apiFetch<Swarm>(`/api/v1/swarms/${name}`);
export const listAgents = (swarm: string) => apiFetch<Agent[]>(`/api/v1/swarms/${swarm}/agents`);
export const listTasks = (swarm: string) => apiFetch<Task[]>(`/api/v1/swarms/${swarm}/tasks`);

export function sseURL(swarm: string): string {
  return `${CONTROLPLANE_URL}/api/v1/swarms/${swarm}/events`;
}
