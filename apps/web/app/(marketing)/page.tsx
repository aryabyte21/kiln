import Link from 'next/link';
import { ArrowRight, Zap, Network, Brain, DollarSign, BarChart3, GitBranch } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

const features = [
  {
    icon: Network,
    title: 'Swarm Orchestration',
    description:
      'Declare agent fleets in YAML. OpenSwarm handles scheduling, scaling, and lifecycle.',
    color: 'text-blue-500',
    bg: 'bg-blue-500/10',
  },
  {
    icon: Brain,
    title: 'Inter-Agent Messaging',
    description:
      'NATS JetStream pipelines connect agents in DAGs with persistent, at-least-once delivery.',
    color: 'text-purple-500',
    bg: 'bg-purple-500/10',
  },
  {
    icon: DollarSign,
    title: 'Cost Tracking',
    description: 'Per-task token and cost tracking with budget limits and bankruptcy protection.',
    color: 'text-emerald-500',
    bg: 'bg-emerald-500/10',
  },
  {
    icon: BarChart3,
    title: 'Live Dashboard',
    description: 'React Flow DAG visualization with real-time SSE updates for agents and tasks.',
    color: 'text-orange-500',
    bg: 'bg-orange-500/10',
  },
  {
    icon: GitBranch,
    title: 'Agent Genetics',
    description: 'Evolve agent prompts over generations using fitness metrics and crossover.',
    color: 'text-pink-500',
    bg: 'bg-pink-500/10',
  },
  {
    icon: Zap,
    title: 'Auto-Scaling',
    description: 'Scale agents based on queue depth, token utilization, or latency triggers.',
    color: 'text-yellow-500',
    bg: 'bg-yellow-500/10',
  },
];

export default function HomePage() {
  return (
    <main className="mx-auto max-w-7xl p-6 md:p-10">
      {/* Hero */}
      <section className="rounded-3xl border-2 bg-gradient-to-br from-background via-background to-muted/20 p-8 md:p-12 shadow-lg">
        <div className="flex items-center gap-2 mb-4">
          <Badge variant="outline" className="text-xs font-semibold">
            CS5224
          </Badge>
          <Badge className="text-xs">Open Source</Badge>
        </div>

        <h1 className="text-5xl font-bold tracking-tight md:text-6xl lg:text-7xl bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
          OpenSwarm
        </h1>

        <p className="mt-6 max-w-3xl text-lg text-muted-foreground leading-relaxed">
          Kubernetes-like orchestrator for fleets of AI agent instances. Declare your agent topology
          in YAML, and OpenSwarm handles scheduling, messaging, cost tracking, and auto-scaling.
        </p>

        <div className="mt-8 flex flex-wrap gap-4">
          <Button size="lg" asChild>
            <Link href="/dashboard">
              <Zap className="h-5 w-5" />
              Open Dashboard
              <ArrowRight className="h-5 w-5" />
            </Link>
          </Button>
          <Button size="lg" variant="outline" asChild>
            <Link href="https://github.com/aryabyte21/openswarm" target="_blank">
              GitHub
            </Link>
          </Button>
        </div>
      </section>

      {/* Features */}
      <section className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {features.map((f) => (
          <Card key={f.title} className="border-2">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${f.bg}`}>
                  <f.icon className={`h-5 w-5 ${f.color}`} />
                </div>
                <CardTitle>{f.title}</CardTitle>
              </div>
              <CardDescription>{f.description}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </section>

      {/* Quick Start */}
      <section className="mt-12">
        <Card className="border-2">
          <CardHeader>
            <CardTitle className="text-2xl">Quick Start</CardTitle>
            <CardDescription>Get a swarm running in under 5 minutes</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="rounded-lg bg-muted p-4 font-mono text-sm space-y-3">
                <div>
                  <div className="text-muted-foreground"># Start infrastructure</div>
                  <div className="text-foreground">docker compose up -d</div>
                </div>
                <div>
                  <div className="text-muted-foreground"># Start the control plane</div>
                  <div className="text-foreground">
                    go run ./apps/controlplane/cmd/openswarm-controller
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground"># Deploy a swarm</div>
                  <div className="text-foreground">
                    openswarm apply -f examples/news-pipeline/swarm.yaml
                  </div>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                Dashboard on <span className="font-mono">:3000</span>, control plane on{' '}
                <span className="font-mono">:9090</span>
              </p>
            </div>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
