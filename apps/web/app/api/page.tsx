import Link from 'next/link';
import { ArrowLeft, Code, CheckCircle, Database, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export const metadata = {
  title: 'API Documentation',
  description: 'Next.js API routes and backend services documentation',
};

export default function ApiPage() {
  return (
    <main className="mx-auto max-w-7xl p-6 md:p-10">
      <Button variant="ghost" asChild className="mb-4">
        <Link href="/">
          <ArrowLeft className="h-4 w-4" />
          Back to Home
        </Link>
      </Button>

      <div className="mb-8">
        <h1 className="text-4xl font-bold tracking-tight md:text-5xl">API Documentation</h1>
        <p className="mt-2 text-lg text-muted-foreground">
          Explore the available API endpoints across all services
        </p>
      </div>

      <div className="space-y-8">
        {/* Next.js API Routes */}
        <section>
          <h2 className="text-2xl font-semibold mb-4 flex items-center gap-2">
            <Code className="h-6 w-6" />
            Next.js API Routes
          </h2>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Health Check</CardTitle>
                  <Badge>GET</Badge>
                </div>
                <CardDescription className="font-mono text-xs">/api/health</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Returns the health status of the application and all connected services.
                </p>
                <div className="rounded-md bg-muted p-3">
                  <p className="text-xs font-mono text-muted-foreground">Response:</p>
                  <pre className="text-xs mt-1 overflow-x-auto">
                    {`{
  "status": "ok",
  "version": "1.0.0",
  "services": {...}
}`}
                  </pre>
                </div>
                <Button size="sm" variant="outline" asChild>
                  <a href="/api/health" target="_blank">
                    Test Endpoint
                  </a>
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Example API</CardTitle>
                  <div className="flex gap-1">
                    <Badge>GET</Badge>
                    <Badge>POST</Badge>
                  </div>
                </div>
                <CardDescription className="font-mono text-xs">/api/example</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Example endpoint demonstrating validation with Zod schemas.
                </p>
                <div className="rounded-md bg-muted p-3">
                  <p className="text-xs font-mono text-muted-foreground">POST body:</p>
                  <pre className="text-xs mt-1 overflow-x-auto">
                    {`{
  "name": "string",
  "email": "string",
  "message": "string"
}`}
                  </pre>
                </div>
                <Button size="sm" variant="outline" asChild>
                  <a href="/api/example" target="_blank">
                    View Schema
                  </a>
                </Button>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* FastAPI Endpoints */}
        <section>
          <h2 className="text-2xl font-semibold mb-4 flex items-center gap-2">
            <Zap className="h-6 w-6 text-yellow-500" />
            FastAPI Service
          </h2>

          <Card>
            <CardHeader>
              <CardTitle>Python API (Port 8000)</CardTitle>
              <CardDescription>
                High-performance async API with automatic OpenAPI documentation
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Badge>GET</Badge>
                    <span className="font-mono text-sm">/health</span>
                  </div>
                  <p className="text-xs text-muted-foreground">Service health check endpoint</p>
                </div>
                <div className="rounded-lg border p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Badge>GET</Badge>
                    <span className="font-mono text-sm">/docs</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Interactive Swagger UI documentation
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" asChild>
                  <a href="http://localhost:8000/docs" target="_blank">
                    <CheckCircle className="h-4 w-4" />
                    Open API Docs
                  </a>
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <a href="http://localhost:8000/health" target="_blank">
                    Health Check
                  </a>
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* Go API Endpoints */}
        <section>
          <h2 className="text-2xl font-semibold mb-4 flex items-center gap-2">
            <Database className="h-6 w-6 text-blue-500" />
            Go API Service
          </h2>

          <Card>
            <CardHeader>
              <CardTitle>Go Service (Port 8080)</CardTitle>
              <CardDescription>
                Low-latency service layer for high-performance endpoints
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Badge>GET</Badge>
                  <span className="font-mono text-sm">/health</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Service health check with uptime metrics
                </p>
              </div>
              <Button size="sm" variant="outline" asChild>
                <a href="http://localhost:8080/health" target="_blank">
                  Health Check
                </a>
              </Button>
            </CardContent>
          </Card>
        </section>

        {/* API Integration Tips */}
        <section>
          <Card className="border-2 border-primary/20">
            <CardHeader>
              <CardTitle>Integration Tips</CardTitle>
              <CardDescription>Best practices for consuming these APIs</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex gap-3">
                <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium">Use TypeScript types</p>
                  <p className="text-muted-foreground text-xs">
                    Shared types in <code className="bg-muted px-1 rounded">packages/types</code>{' '}
                    ensure type safety
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium">Validate with Zod</p>
                  <p className="text-muted-foreground text-xs">
                    All endpoints use Zod schemas for runtime validation
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium">Error handling</p>
                  <p className="text-muted-foreground text-xs">
                    Consistent error format across all services with proper status codes
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium">Environment variables</p>
                  <p className="text-muted-foreground text-xs">
                    Use <code className="bg-muted px-1 rounded">NEXT_PUBLIC_*</code> for client-side
                    API calls
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  );
}
