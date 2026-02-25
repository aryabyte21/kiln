'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { SwarmGraph } from '@/components/dashboard/swarm-graph';
import { useSSE } from '@/hooks/use-sse';
import {
  listSwarms,
  listAgents,
  listTasks,
  sseURL,
  type Swarm,
  type Agent,
  type Task,
} from '@/lib/api-client';

export default function DashboardPage() {
  const [swarms, setSwarms] = useState<Swarm[]>([]);
  const [selectedSwarm, setSelectedSwarm] = useState<Swarm | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { connected } = useSSE(selectedSwarm ? sseURL(selectedSwarm.name) : null);

  // Fetch swarms on mount
  useEffect(() => {
    fetchSwarms();
  }, []);

  // Fetch agents and tasks when swarm changes
  useEffect(() => {
    if (selectedSwarm) {
      fetchSwarmData(selectedSwarm.name);
    }
  }, [selectedSwarm]);

  async function fetchSwarms() {
    try {
      setLoading(true);
      const data = await listSwarms();
      setSwarms(data);
      if (data.length > 0) {
        setSelectedSwarm(data[0]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect to control plane');
    } finally {
      setLoading(false);
    }
  }

  async function fetchSwarmData(name: string) {
    try {
      const [agentData, taskData] = await Promise.all([listAgents(name), listTasks(name)]);
      setAgents(agentData);
      setTasks(taskData);
    } catch {
      // Agents/tasks may be empty, that's fine
    }
  }

  if (loading) {
    return <DashboardSkeleton />;
  }

  if (error) {
    return (
      <div className="container mx-auto p-6">
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
        <p className="mt-4 text-sm text-zinc-500">
          Make sure the control plane is running:{' '}
          <code className="bg-zinc-800 px-2 py-1 rounded">docker compose up</code> then{' '}
          <code className="bg-zinc-800 px-2 py-1 rounded">go run ./cmd/openswarm-controller</code>
        </p>
      </div>
    );
  }

  const totalAgentSpecs = selectedSwarm?.spec.agents.length ?? 0;
  const totalBudget = selectedSwarm?.spec.budget.total ?? '$0.00';

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">OpenSwarm Dashboard</h1>
          <p className="text-zinc-500">Orchestrate and monitor your AI agent fleet</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge
            variant={connected ? 'default' : 'secondary'}
            className={connected ? 'bg-emerald-600' : ''}
          >
            {connected ? 'Connected' : 'Disconnected'}
          </Badge>
        </div>
      </div>

      {/* Swarm selector + stats */}
      {swarms.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="text-zinc-500">No swarms deployed yet.</p>
            <p className="text-sm text-zinc-600 mt-2">
              Apply a swarm manifest:{' '}
              <code className="bg-zinc-800 px-2 py-1 rounded">
                openswarm apply examples/hello-swarm/swarm.yaml
              </code>
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Stats row */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <StatsCard
              title="Swarm"
              value={selectedSwarm?.name ?? '—'}
              description={`Status: ${selectedSwarm?.status}`}
            />
            <StatsCard
              title="Agent Roles"
              value={totalAgentSpecs.toString()}
              description="Defined in spec"
            />
            <StatsCard
              title="Live Agents"
              value={agents.length.toString()}
              description="Registered in cluster"
            />
            <StatsCard
              title="Budget"
              value={totalBudget}
              description={`Alert at ${selectedSwarm?.spec.budget.alertAt ?? 0}%`}
            />
          </div>

          {/* Main content tabs */}
          <Tabs defaultValue="graph" className="space-y-4">
            <TabsList className="bg-zinc-900 border border-zinc-800">
              <TabsTrigger value="graph">Agent Graph</TabsTrigger>
              <TabsTrigger value="agents">Agents</TabsTrigger>
              <TabsTrigger value="tasks">Tasks</TabsTrigger>
              <TabsTrigger value="topology">Topology</TabsTrigger>
            </TabsList>

            {/* Graph view */}
            <TabsContent value="graph">
              {selectedSwarm && <SwarmGraph spec={selectedSwarm.spec} />}
            </TabsContent>

            {/* Agents table */}
            <TabsContent value="agents">
              <Card>
                <CardHeader>
                  <CardTitle>Agent Specifications</CardTitle>
                  <CardDescription>Agent roles defined in the swarm manifest</CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Role</TableHead>
                        <TableHead>Model</TableHead>
                        <TableHead>Replicas</TableHead>
                        <TableHead>Scale On</TableHead>
                        <TableHead>Policy</TableHead>
                        <TableHead>Skills</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {selectedSwarm?.spec.agents.map((agent) => (
                        <TableRow key={agent.name}>
                          <TableCell className="font-medium">{agent.name}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{shortenModel(agent.model)}</Badge>
                          </TableCell>
                          <TableCell>
                            {agent.replicas.min}–{agent.replicas.max}
                          </TableCell>
                          <TableCell>{agent.replicas.scaleOn || '—'}</TableCell>
                          <TableCell>{agent.policy || 'default'}</TableCell>
                          <TableCell>
                            <div className="flex gap-1 flex-wrap">
                              {(agent.skills || []).map((s) => (
                                <Badge key={s} variant="secondary" className="text-xs">
                                  {s}
                                </Badge>
                              ))}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              {/* Live agents (from Redis registry) */}
              {agents.length > 0 && (
                <Card className="mt-4">
                  <CardHeader>
                    <CardTitle>Live Agents</CardTitle>
                    <CardDescription>Currently registered in the cluster</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>ID</TableHead>
                          <TableHead>Role</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Address</TableHead>
                          <TableHead>Last Seen</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {agents.map((agent) => (
                          <TableRow key={agent.id}>
                            <TableCell className="font-mono text-xs">
                              {agent.id.slice(0, 12)}
                            </TableCell>
                            <TableCell>{agent.role}</TableCell>
                            <TableCell>
                              <StatusBadge status={agent.status} />
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                              {agent.openclawAddr}
                            </TableCell>
                            <TableCell>{new Date(agent.lastSeen).toLocaleTimeString()}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {/* Tasks table */}
            <TabsContent value="tasks">
              <Card>
                <CardHeader>
                  <CardTitle>Tasks</CardTitle>
                  <CardDescription>{tasks.length} tasks in this swarm</CardDescription>
                </CardHeader>
                <CardContent>
                  {tasks.length === 0 ? (
                    <p className="text-zinc-500 text-center py-6">No tasks submitted yet.</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>ID</TableHead>
                          <TableHead>Role</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Tokens</TableHead>
                          <TableHead>Cost</TableHead>
                          <TableHead>Created</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {tasks.map((task) => (
                          <TableRow key={task.id}>
                            <TableCell className="font-mono text-xs">
                              {task.id.slice(0, 12)}
                            </TableCell>
                            <TableCell>{task.agentRole}</TableCell>
                            <TableCell>
                              <StatusBadge status={task.status} />
                            </TableCell>
                            <TableCell>{task.tokensUsed.toLocaleString()}</TableCell>
                            <TableCell>${task.costUsd.toFixed(4)}</TableCell>
                            <TableCell>{new Date(task.createdAt).toLocaleTimeString()}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Topology */}
            <TabsContent value="topology">
              <Card>
                <CardHeader>
                  <CardTitle>Message Topology</CardTitle>
                  <CardDescription>Data flow between agents via NATS subjects</CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>From</TableHead>
                        <TableHead>To</TableHead>
                        <TableHead>NATS Subject</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(selectedSwarm?.spec.topology || []).map((edge, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-medium">{edge.from}</TableCell>
                          <TableCell className="font-medium">{edge.to}</TableCell>
                          <TableCell className="font-mono text-xs">{edge.subject}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatsCard({
  title,
  value,
  description,
}: {
  title: string;
  value: string;
  description: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-zinc-500">{description}</p>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
    online: 'default',
    busy: 'secondary',
    pending: 'outline',
    completed: 'default',
    running: 'secondary',
    failed: 'destructive',
    bankrupt: 'destructive',
    error: 'destructive',
  };

  return (
    <Badge variant={variants[status] || 'outline'} className="capitalize">
      {status}
    </Badge>
  );
}

function DashboardSkeleton() {
  return (
    <div className="container mx-auto p-6 space-y-6">
      <Skeleton className="h-10 w-64" />
      <div className="grid grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-[600px]" />
    </div>
  );
}

function shortenModel(model: string): string {
  if (model.includes('haiku')) return 'Haiku';
  if (model.includes('sonnet')) return 'Sonnet';
  if (model.includes('opus')) return 'Opus';
  return model;
}
