import Link from 'next/link';
import { ArrowLeft, Book, FileText, GitBranch, Layers, Server } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata = {
  title: 'Documentation',
  description: 'Project documentation and guides',
};

export default function DocsPage() {
  return (
    <main className="mx-auto max-w-7xl p-6 md:p-10">
      <Button variant="ghost" asChild className="mb-4">
        <Link href="/">
          <ArrowLeft className="h-4 w-4" />
          Back to Home
        </Link>
      </Button>

      <div className="mb-8">
        <h1 className="text-4xl font-bold tracking-tight md:text-5xl">Documentation</h1>
        <p className="mt-2 text-lg text-muted-foreground">
          Everything you need to know about the CS5224 monorepo
        </p>
      </div>

      <div className="space-y-8">
        {/* Getting Started */}
        <section>
          <h2 className="text-2xl font-semibold mb-4">Getting Started</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Book className="h-5 w-5" />
                  Quick Start Guide
                </CardTitle>
                <CardDescription>Get up and running in 2 minutes</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-4">
                  Learn how to set up your development environment and start building.
                </p>
                <div className="rounded-md bg-muted p-3 font-mono text-xs">
                  ./scripts/quickstart.sh
                </div>
                <Button size="sm" variant="outline" className="mt-4" asChild>
                  <a
                    href="https://github.com/YOUR_USERNAME/cs5224-monorepo#-quick-start"
                    target="_blank"
                  >
                    View Guide
                  </a>
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  Contributing Guide
                </CardTitle>
                <CardDescription>How to contribute to the project</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-4">
                  Code standards, commit conventions, and PR process.
                </p>
                <ul className="text-sm space-y-1 text-muted-foreground">
                  <li>• Development workflow</li>
                  <li>• Code standards</li>
                  <li>• Testing requirements</li>
                </ul>
                <Button size="sm" variant="outline" className="mt-4" asChild>
                  <Link href="https://github.com/YOUR_USERNAME/cs5224-monorepo/blob/main/CONTRIBUTING.md">
                    Read Guide
                  </Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Architecture */}
        <section>
          <h2 className="text-2xl font-semibold mb-4">Architecture</h2>
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Layers className="h-5 w-5" />
                  System Design
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-3">
                  Overview of the system architecture and service topology.
                </p>
                <Button size="sm" variant="outline" asChild>
                  <Link href="https://github.com/YOUR_USERNAME/cs5224-monorepo/blob/main/docs/architecture.md">
                    View Docs
                  </Link>
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Server className="h-5 w-5" />
                  Infrastructure
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-3">
                  IaC strategy, GitOps, and deployment configurations.
                </p>
                <Button size="sm" variant="outline" asChild>
                  <Link href="https://github.com/YOUR_USERNAME/cs5224-monorepo/blob/main/docs/infra-strategy.md">
                    View Docs
                  </Link>
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <GitBranch className="h-5 w-5" />
                  Cost Comparison
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-3">
                  Analysis of on-premise vs. cloud hosting costs.
                </p>
                <Button size="sm" variant="outline" asChild>
                  <Link href="https://github.com/YOUR_USERNAME/cs5224-monorepo/blob/main/docs/cost-comparison.md">
                    View Docs
                  </Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Tech Stack */}
        <section>
          <h2 className="text-2xl font-semibold mb-4">Tech Stack</h2>
          <Card>
            <CardHeader>
              <CardTitle>Technologies Used</CardTitle>
              <CardDescription>Comprehensive list of tools and frameworks</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-6 md:grid-cols-2">
                <div>
                  <h3 className="font-semibold mb-2">Frontend</h3>
                  <ul className="text-sm space-y-1 text-muted-foreground">
                    <li>• Next.js 15 (App Router)</li>
                    <li>• React 19 (Server Components)</li>
                    <li>• shadcn/ui components</li>
                    <li>• Tailwind CSS</li>
                    <li>• Drizzle ORM</li>
                    <li>• TypeScript 5.7</li>
                  </ul>
                </div>
                <div>
                  <h3 className="font-semibold mb-2">Backend</h3>
                  <ul className="text-sm space-y-1 text-muted-foreground">
                    <li>• FastAPI (Python 3.12)</li>
                    <li>• Go 1.23</li>
                    <li>• PostgreSQL</li>
                    <li>• Redis (optional)</li>
                  </ul>
                </div>
                <div>
                  <h3 className="font-semibold mb-2">DevOps</h3>
                  <ul className="text-sm space-y-1 text-muted-foreground">
                    <li>• Nx monorepo orchestration</li>
                    <li>• mise runtime management</li>
                    <li>• Docker + docker-compose</li>
                    <li>• GitHub Actions CI/CD</li>
                    <li>• Terraform (IaC)</li>
                    <li>• ArgoCD (GitOps)</li>
                  </ul>
                </div>
                <div>
                  <h3 className="font-semibold mb-2">Code Quality</h3>
                  <ul className="text-sm space-y-1 text-muted-foreground">
                    <li>• ESLint + Prettier</li>
                    <li>• Husky + lint-staged</li>
                    <li>• Vitest (testing)</li>
                    <li>• pytest (Python tests)</li>
                    <li>• Go testing</li>
                    <li>• Changesets (versioning)</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* Available Commands */}
        <section>
          <h2 className="text-2xl font-semibold mb-4">Common Commands</h2>
          <Card>
            <CardHeader>
              <CardTitle>Development Commands</CardTitle>
              <CardDescription>Frequently used pnpm scripts</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <div className="font-mono text-sm bg-muted p-2 rounded mb-1">pnpm dev</div>
                  <p className="text-xs text-muted-foreground">
                    Start all services (web + py-api + go-api)
                  </p>
                </div>
                <div>
                  <div className="font-mono text-sm bg-muted p-2 rounded mb-1">pnpm build:all</div>
                  <p className="text-xs text-muted-foreground">
                    Build all projects including Python and Go
                  </p>
                </div>
                <div>
                  <div className="font-mono text-sm bg-muted p-2 rounded mb-1">pnpm check:all</div>
                  <p className="text-xs text-muted-foreground">
                    Run all validation checks (lint + typecheck + test + build)
                  </p>
                </div>
                <div>
                  <div className="font-mono text-sm bg-muted p-2 rounded mb-1">pnpm db:studio</div>
                  <p className="text-xs text-muted-foreground">Open Drizzle Studio database GUI</p>
                </div>
                <div>
                  <div className="font-mono text-sm bg-muted p-2 rounded mb-1">pnpm changeset</div>
                  <p className="text-xs text-muted-foreground">
                    Create a changeset for version management
                  </p>
                </div>
              </div>
              <Button size="sm" variant="outline" className="mt-4" asChild>
                <a
                  href="https://github.com/YOUR_USERNAME/cs5224-monorepo#-available-commands"
                  target="_blank"
                >
                  View All Commands
                </a>
              </Button>
            </CardContent>
          </Card>
        </section>

        {/* External Resources */}
        <section>
          <h2 className="text-2xl font-semibold mb-4">External Resources</h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Next.js Docs</CardTitle>
              </CardHeader>
              <CardContent>
                <Button size="sm" variant="outline" asChild className="w-full">
                  <a href="https://nextjs.org/docs" target="_blank" rel="noopener noreferrer">
                    Visit →
                  </a>
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">shadcn/ui</CardTitle>
              </CardHeader>
              <CardContent>
                <Button size="sm" variant="outline" asChild className="w-full">
                  <a href="https://ui.shadcn.com" target="_blank" rel="noopener noreferrer">
                    Visit →
                  </a>
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Drizzle ORM</CardTitle>
              </CardHeader>
              <CardContent>
                <Button size="sm" variant="outline" asChild className="w-full">
                  <a href="https://orm.drizzle.team" target="_blank" rel="noopener noreferrer">
                    Visit →
                  </a>
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">FastAPI</CardTitle>
              </CardHeader>
              <CardContent>
                <Button size="sm" variant="outline" asChild className="w-full">
                  <a href="https://fastapi.tiangolo.com" target="_blank" rel="noopener noreferrer">
                    Visit →
                  </a>
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Nx Workspace</CardTitle>
              </CardHeader>
              <CardContent>
                <Button size="sm" variant="outline" asChild className="w-full">
                  <a href="https://nx.dev" target="_blank" rel="noopener noreferrer">
                    Visit →
                  </a>
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">mise</CardTitle>
              </CardHeader>
              <CardContent>
                <Button size="sm" variant="outline" asChild className="w-full">
                  <a href="https://mise.jdx.dev" target="_blank" rel="noopener noreferrer">
                    Visit →
                  </a>
                </Button>
              </CardContent>
            </Card>
          </div>
        </section>
      </div>
    </main>
  );
}
