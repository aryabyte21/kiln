'use client';

import { useEffect, useState, useMemo } from 'react';
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
import { TaskForm } from '@/components/dashboard/task-form';
import { CostGauge } from '@/components/dashboard/cost-gauge';
import { ContainerList } from '@/components/dashboard/container-list';
import { ExecutionLog } from '@/components/dashboard/execution-log';
import { useSwarmSSE } from '@/hooks/use-sse';
import {
  listSwarms,
  listAgents,
  listTasks,
  type Swarm,
  type Agent,
  type Task,
  type AgentSpec,
} from '@/lib/api-client';

export default function DashboardPage() {
  const [swarms, setSwarms] = useState<Swarm[]>([]);
  const [selectedSwarm, setSelectedSwarm] = useState<Swarm | null>(null);
  const [initialAgents, setInitialAgents] = useState<Agent[]>([]);
  const [initialTasks, setInitialTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Real-time SSE data
  const {
    agents: sseAgents,
    tasks: sseTasks,
    budget,
    connected,
    lastEvent,
    agentStates,
    events,
  } = useSwarmSSE(selectedSwarm?.name ?? null);

  // Merge: prefer SSE live data when available, fall back to initial fetch
  const agents = sseAgents.length > 0 ? sseAgents : initialAgents;
  const tasks = sseTasks.length > 0 ? sseTasks : initialTasks;

  // Extract unique agent roles from the swarm spec for the task form
  const agentRoles = useMemo(
    () => selectedSwarm?.spec.agents.map((a) => a.name) ?? [],
    [selectedSwarm]
  );

  // Fetch swarms on mount
  useEffect(() => {
    fetchSwarms();
  }, []);

  // Fetch agents and tasks when swarm changes (initial hydration)
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
      setInitialAgents(agentData);
      setInitialTasks(taskData);
    } catch {
      // Agents/tasks may be empty, that's fine
    }
  }

  /** Resolve the effective model for an agent (per-agent overrides swarm defaults). */
  function resolveModel(agent: AgentSpec): string {
    return agent.model || selectedSwarm?.spec.defaults?.model || 'default';
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
  const defaultModel = selectedSwarm?.spec.defaults?.model;
  const topologyCount = selectedSwarm?.spec.topology?.length ?? 0;

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">OpenSwarm Dashboard</h1>
          <p className="text-zinc-500">Orchestrate and monitor your OpenClaw agent fleet</p>
        </div>
        <div className="flex items-center gap-3">
          {lastEvent && <span className="text-xs text-zinc-600">Last: {lastEvent.type}</span>}
          <ConnectionIndicator connected={connected} />
        </div>
      </div>

      {/* Swarm selector + stats */}
      {swarms.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="text-zinc-500">No swarms deployed yet.</p>
            <p className="text-sm text-zinc-600 mt-2">
              Deploy a swarm from the{' '}
              <a href="/dashboard/deploy" className="text-emerald-400 underline">
                Deploy
              </a>{' '}
              page or via CLI:{' '}
              <code className="bg-zinc-800 px-2 py-1 rounded">
                openswarm apply examples/hello-swarm/swarm.yaml
              </code>
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Swarm selector (when multiple swarms) */}
          {swarms.length > 1 && (
            <div className="flex items-center gap-3">
              <label htmlFor="swarm-select" className="text-sm text-zinc-400 font-medium">
                Active Swarm
              </label>
              <select
                id="swarm-select"
                value={selectedSwarm?.name ?? ''}
                onChange={(e) => {
                  const swarm = swarms.find((s) => s.name === e.target.value);
                  if (swarm) setSelectedSwarm(swarm);
                }}
                className="flex h-9 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-400 focus:ring-offset-2 focus:ring-offset-zinc-950"
              >
                {swarms.map((s) => (
                  <option key={s.name} value={s.name}>
                    {s.name} ({s.status})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Stats row */}
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <StatsCard
              title="Swarm"
              value={selectedSwarm?.name ?? '\u2014'}
              description={`Status: ${selectedSwarm?.status}`}
            />
            <StatsCard
              title="Agent Roles"
              value={totalAgentSpecs.toString()}
              description={
                defaultModel ? `Default: ${shortenModel(defaultModel)}` : 'Defined in spec'
              }
            />
            <StatsCard
              title="Live Agents"
              value={agents.length.toString()}
              description="Registered in cluster"
            />
            <StatsCard
              title="Topology"
              value={topologyCount.toString()}
              description={
                topologyCount === 1 ? '1 data flow edge' : `${topologyCount} data flow edges`
              }
            />
            <StatsCard
              title="Budget"
              value={budget ? `$${budget.spent.toFixed(2)}` : totalBudget}
              description={
                budget
                  ? `${budget.percent.toFixed(1)}% of $${budget.total.toFixed(2)} used`
                  : `Alert at ${selectedSwarm?.spec.budget.alertAt ?? 0}%`
              }
            />
          </div>

          {/* Defaults banner */}
          {selectedSwarm?.spec.defaults && (
            <Card className="border-zinc-800/60 bg-zinc-900/50">
              <CardContent className="py-3 px-4 flex items-center gap-4 text-xs text-zinc-400">
                <span className="font-medium text-zinc-300">Swarm Defaults:</span>
                {defaultModel && (
                  <span>
                    Model:{' '}
                    <Badge variant="outline" className="text-xs ml-1">
                      {shortenModel(defaultModel)}
                    </Badge>
                  </span>
                )}
                {selectedSwarm.spec.defaults.config && (
                  <>
                    {typeof selectedSwarm.spec.defaults.config.temperature === 'number' && (
                      <span>Temp: {selectedSwarm.spec.defaults.config.temperature}</span>
                    )}
                    {typeof selectedSwarm.spec.defaults.config.maxTokens === 'number' && (
                      <span>Max tokens: {selectedSwarm.spec.defaults.config.maxTokens}</span>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          )}

          {/* Sidebar panel: Task Form + Cost Gauge */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Main content — takes 2 cols on large screens */}
            <div className="lg:col-span-2 space-y-6">
              {/* Main content tabs */}
              <Tabs defaultValue="graph" className="space-y-4">
                <TabsList className="bg-zinc-900 border border-zinc-800">
                  <TabsTrigger value="graph">Agent Graph</TabsTrigger>
                  <TabsTrigger value="agents">Agents</TabsTrigger>
                  <TabsTrigger value="containers">Containers</TabsTrigger>
                  <TabsTrigger value="tasks">Tasks</TabsTrigger>
                  <TabsTrigger value="topology">Topology</TabsTrigger>
                  <TabsTrigger value="logs">Logs</TabsTrigger>
                </TabsList>

                {/* Graph view */}
                <TabsContent value="graph">
                  {selectedSwarm && (
                    <SwarmGraph spec={selectedSwarm.spec} agentStates={agentStates} />
                  )}
                </TabsContent>

                {/* Agents table */}
                <TabsContent value="agents">
                  <Card>
                    <CardHeader>
                      <CardTitle>Agent Specifications</CardTitle>
                      <CardDescription>
                        Agent roles defined in the swarm manifest
                        {defaultModel && (
                          <span className="ml-2 text-zinc-500">
                            (default model: {shortenModel(defaultModel)})
                          </span>
                        )}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Role</TableHead>
                            <TableHead>Model</TableHead>
                            <TableHead>Replicas</TableHead>
                            <TableHead>Tools</TableHead>
                            <TableHead>Features</TableHead>
                            <TableHead>Dependencies</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {selectedSwarm?.spec.agents.map((agent) => (
                            <TableRow key={agent.name}>
                              <TableCell className="font-medium">
                                <div className="flex items-center gap-2">
                                  {agent.name}
                                  {agent.soul && (
                                    <span
                                      className="text-violet-400 text-xs"
                                      title="Has custom persona (soul)"
                                    >
                                      &#9733;
                                    </span>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell>
                                <Badge
                                  variant="outline"
                                  className={agent.model ? '' : 'text-zinc-500 border-zinc-700'}
                                >
                                  {shortenModel(resolveModel(agent))}
                                  {!agent.model && defaultModel && (
                                    <span className="ml-1 text-[10px] text-zinc-500">
                                      (inherited)
                                    </span>
                                  )}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <span className="font-mono text-xs">
                                  {agent.replicas.min}\u2013{agent.replicas.max}
                                </span>
                                {agent.replicas.scaleOn && (
                                  <span className="ml-1 text-[10px] text-zinc-500">
                                    ({agent.replicas.scaleOn})
                                  </span>
                                )}
                              </TableCell>
                              <TableCell>
                                <div className="flex gap-1 flex-wrap">
                                  {(agent.tools || []).map((t) => (
                                    <Badge
                                      key={t}
                                      variant="secondary"
                                      className="text-xs bg-cyan-950/50 text-cyan-400 border-cyan-900/50"
                                    >
                                      {t}
                                    </Badge>
                                  ))}
                                  {(agent.skills || []).map((s) => (
                                    <Badge key={s} variant="secondary" className="text-xs">
                                      {s}
                                    </Badge>
                                  ))}
                                  {!agent.tools?.length && !agent.skills?.length && (
                                    <span className="text-xs text-zinc-600">\u2014</span>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell>
                                <div className="flex gap-1 flex-wrap">
                                  {agent.cron && agent.cron.length > 0 && (
                                    <Badge
                                      variant="outline"
                                      className="text-xs text-amber-400 border-amber-900/50"
                                      title={agent.cron
                                        .map((c) => `${c.name}: ${c.schedule}`)
                                        .join('\n')}
                                    >
                                      &#8986; {agent.cron.length} cron
                                    </Badge>
                                  )}
                                  {agent.policy && (
                                    <Badge variant="outline" className="text-xs">
                                      {agent.policy}
                                    </Badge>
                                  )}
                                  {agent.genome?.evolution && (
                                    <Badge
                                      variant="outline"
                                      className="text-xs text-emerald-400 border-emerald-900/50"
                                    >
                                      &#9734; genetics
                                    </Badge>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell>
                                {agent.dependsOn && agent.dependsOn.length > 0 ? (
                                  <div className="flex gap-1 flex-wrap">
                                    {agent.dependsOn.map((dep) => (
                                      <Badge
                                        key={dep}
                                        variant="outline"
                                        className="text-xs text-zinc-400"
                                      >
                                        \u2190 {dep}
                                      </Badge>
                                    ))}
                                  </div>
                                ) : (
                                  <span className="text-xs text-zinc-600">\u2014</span>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>

                  {/* Live agents (from registry or SSE) */}
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
                                <TableCell>
                                  {new Date(agent.lastSeen).toLocaleTimeString()}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </CardContent>
                    </Card>
                  )}
                </TabsContent>

                {/* Containers tab */}
                <TabsContent value="containers">
                  {selectedSwarm && <ContainerList swarmName={selectedSwarm.name} />}
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
                                <TableCell>
                                  {new Date(task.createdAt).toLocaleTimeString()}
                                </TableCell>
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
                      {(selectedSwarm?.spec.topology?.length ?? 0) === 0 ? (
                        <p className="text-zinc-500 text-center py-6">No topology edges defined.</p>
                      ) : (
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
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Logs */}
                <TabsContent value="logs">
                  <ExecutionLog events={events} />
                </TabsContent>
              </Tabs>
            </div>

            {/* Right sidebar — 1 col */}
            <div className="space-y-6">
              {selectedSwarm && (
                <>
                  <TaskForm swarmName={selectedSwarm.name} agentRoles={agentRoles} />
                  <CostGauge budget={budget} specBudget={selectedSwarm.spec.budget} />

                  {/* Swarm config summary */}
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-lg">Swarm Config</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 text-xs text-zinc-400">
                      {selectedSwarm.spec.audit?.enabled && (
                        <div className="flex items-center justify-between">
                          <span>Audit</span>
                          <Badge
                            variant="outline"
                            className="text-xs text-emerald-400 border-emerald-900/50"
                          >
                            {selectedSwarm.spec.audit.hashChaining ? 'Hash-chained' : 'Enabled'}
                          </Badge>
                        </div>
                      )}
                      {selectedSwarm.spec.memory?.l2 && (
                        <div className="flex items-center justify-between">
                          <span>L2 Memory</span>
                          <span className="text-zinc-300">
                            {selectedSwarm.spec.memory.l2.backend} (TTL:{' '}
                            {selectedSwarm.spec.memory.l2.ttl}s)
                          </span>
                        </div>
                      )}
                      {selectedSwarm.spec.memory?.l3 && (
                        <div className="flex items-center justify-between">
                          <span>L3 Memory</span>
                          <span className="text-zinc-300">
                            {selectedSwarm.spec.memory.l3.backend}:{' '}
                            {selectedSwarm.spec.memory.l3.collection}
                          </span>
                        </div>
                      )}
                      {selectedSwarm.spec.checkpoints &&
                        selectedSwarm.spec.checkpoints.length > 0 && (
                          <div className="flex items-center justify-between">
                            <span>Checkpoints</span>
                            <span className="text-zinc-300">
                              {selectedSwarm.spec.checkpoints.length} human-in-the-loop
                            </span>
                          </div>
                        )}
                      <div className="flex items-center justify-between">
                        <span>Created</span>
                        <span className="text-zinc-300">
                          {new Date(selectedSwarm.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ConnectionIndicator({ connected }: { connected: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={`inline-block w-2 h-2 rounded-full ${
          connected ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-600'
        }`}
      />
      <Badge
        variant={connected ? 'default' : 'secondary'}
        className={connected ? 'bg-emerald-600' : ''}
      >
        {connected ? 'Live' : 'Disconnected'}
      </Badge>
    </div>
  );
}

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
      <div className="grid grid-cols-5 gap-4">
        {[...Array(5)].map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-[600px]" />
    </div>
  );
}

function shortenModel(model: string | undefined): string {
  if (!model) return 'default';
  if (model.includes('haiku')) return 'Haiku';
  if (model.includes('sonnet')) return 'Sonnet';
  if (model.includes('opus')) return 'Opus';
  if (model.includes('llama')) return model.split('/').pop() || 'Llama';
  if (model.includes('groq')) return model.split('/').pop() || model;
  if (model.includes('/')) return model.split('/').pop() || model;
  return model;
}
