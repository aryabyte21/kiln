import Link from 'next/link';
import { ArrowRight, Database, Server, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';
import { fetchServiceStatuses } from '@/lib/services';

export default async function HomePage() {
  const services = await fetchServiceStatuses();

  return (
    <main className="mx-auto max-w-7xl p-6 md:p-10">
      {/* Hero Section */}
      <section className="rounded-3xl border-2 bg-gradient-to-br from-background via-background to-muted/20 p-8 md:p-12 shadow-lg">
        <div className="flex items-center gap-2 mb-4">
          <Badge variant="outline" className="text-xs font-semibold">
            CS5224 Project
          </Badge>
          <Badge className="text-xs">Spring 2026</Badge>
        </div>

        <h1 className="text-5xl font-bold tracking-tight md:text-6xl lg:text-7xl bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
          Cloud SaaS Starter
        </h1>

        <p className="mt-6 max-w-3xl text-lg text-muted-foreground leading-relaxed">
          A production-ready polyglot monorepo for building and comparing cloud-native SaaS
          applications. Features Next.js 15 with React 19, FastAPI, Go services, and complete DevOps
          tooling.
        </p>

        <div className="mt-8 flex flex-wrap gap-4">
          <Button size="lg" asChild>
            <Link href="/showcase">
              <Sparkles className="h-5 w-5" />
              View Component Showcase
              <ArrowRight className="h-5 w-5" />
            </Link>
          </Button>
          <Button size="lg" variant="outline" asChild>
            <Link href="https://github.com" target="_blank">
              Documentation
            </Link>
          </Button>
        </div>
      </section>

      {/* Features Grid */}
      <section className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <Card className="border-2">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <Server className="h-5 w-5 text-primary" />
              </div>
              <CardTitle>Service Health</CardTitle>
            </div>
            <CardDescription>Real-time monitoring of all backend services</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableBody>
                {services.map((service) => (
                  <TableRow key={service.name}>
                    <TableCell className="font-medium">{service.name}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant={service.status === 'up' ? 'default' : 'destructive'}>
                        {service.status.toUpperCase()}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="border-2">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
                <Database className="h-5 w-5 text-blue-500" />
              </div>
              <CardTitle>Database Layer</CardTitle>
            </div>
            <CardDescription>Drizzle ORM with PostgreSQL</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-md bg-muted p-3">
              <p className="text-xs font-mono text-muted-foreground">src/db/schema/index.ts</p>
            </div>
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>✓ Type-safe schema definitions</p>
              <p>✓ Automatic migration generation</p>
              <p>✓ Studio UI for data management</p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-2">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/10">
                <Sparkles className="h-5 w-5 text-green-500" />
              </div>
              <CardTitle>Modern Stack</CardTitle>
            </div>
            <CardDescription>Latest tools and best practices</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>• Next.js 15 + React 19</p>
            <p>• shadcn/ui + Tailwind CSS</p>
            <p>• FastAPI + Go services</p>
            <p>• Nx monorepo orchestration</p>
            <p>• mise for runtime management</p>
            <p>• Husky + lint-staged pre-commit</p>
          </CardContent>
        </Card>
      </section>

      {/* Quick Start */}
      <section className="mt-12">
        <Card className="border-2">
          <CardHeader>
            <CardTitle className="text-2xl">Quick Start</CardTitle>
            <CardDescription>Get up and running in 2 minutes</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="rounded-lg bg-muted p-4 font-mono text-sm">
                <div className="text-muted-foreground"># Install runtimes and dependencies</div>
                <div className="text-foreground">mise install && pnpm install</div>
                <div className="mt-3 text-muted-foreground"># Setup Python environment</div>
                <div className="text-foreground">
                  python -m venv .venv && .venv/bin/pip install -r apps/py-api/requirements-dev.txt
                </div>
                <div className="mt-3 text-muted-foreground"># Start all services</div>
                <div className="text-foreground">docker compose up -d && pnpm dev</div>
              </div>
              <p className="text-sm text-muted-foreground">
                Web runs on <span className="font-mono">:3000</span>, FastAPI on{' '}
                <span className="font-mono">:8000</span>, Go on{' '}
                <span className="font-mono">:8080</span>
              </p>
            </div>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
