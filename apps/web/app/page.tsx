import { ArrowRight, Database, Server } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { fetchServiceStatuses } from '@/lib/services';

export default async function HomePage() {
  const services = await fetchServiceStatuses();

  return (
    <main className="mx-auto max-w-6xl p-6 md:p-10">
      <section className="rounded-2xl border bg-card p-8 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">CS5224 SaaS Starter</p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight md:text-5xl">Ship faster with a clean monorepo baseline</h1>
        <p className="mt-4 max-w-3xl text-muted-foreground">
          Next.js frontend with shadcn/ui and Drizzle, plus FastAPI and Go services for experimentation,
          benchmarking, and cloud vs on-prem deployment comparisons.
        </p>
        <div className="mt-6 flex gap-3">
          <Button>Open Docs <ArrowRight className="h-4 w-4" /></Button>
          <Button variant="outline">Run Migrations</Button>
        </div>
      </section>

      <section className="mt-8 grid gap-4 md:grid-cols-2">
        <article className="rounded-2xl border bg-card p-6">
          <div className="mb-3 flex items-center gap-2 text-lg font-semibold"><Server className="h-5 w-5" /> Service Health</div>
          <ul className="space-y-2">
            {services.map((service) => (
              <li key={service.name} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                <span>{service.name}</span>
                <span className={service.status === 'up' ? 'text-emerald-600' : 'text-rose-600'}>{service.status.toUpperCase()}</span>
              </li>
            ))}
          </ul>
        </article>

        <article className="rounded-2xl border bg-card p-6">
          <div className="mb-3 flex items-center gap-2 text-lg font-semibold"><Database className="h-5 w-5" /> Drizzle Setup</div>
          <p className="text-sm text-muted-foreground">Schema path: `src/db/schema/index.ts`</p>
          <p className="mt-2 text-sm text-muted-foreground">Use `pnpm db:generate && pnpm db:migrate` after Postgres is running.</p>
        </article>
      </section>
    </main>
  );
}
