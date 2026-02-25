# AGENTS Instructions for `apps/web`

## Stack

- **Next.js 15** App Router with React 19
- **shadcn/ui** primitives (52 components installed)
- **Tailwind CSS** with dark mode via `next-themes`
- **Drizzle ORM** with PostgreSQL (postgres-js driver)
- **React Flow** (@xyflow/react) for agent graph visualization
- **Recharts** for analytics charts
- **Zod** + react-hook-form for validation

## Commands

```bash
pnpm --filter @cs5224/web dev           # Start dev server
pnpm --filter @cs5224/web lint          # Run ESLint
pnpm --filter @cs5224/web typecheck     # TypeScript check
pnpm --filter @cs5224/web test          # Run Vitest
pnpm --filter @cs5224/web build         # Production build
pnpm --filter @cs5224/web db:generate   # Generate Drizzle migrations
pnpm --filter @cs5224/web db:migrate    # Apply migrations
pnpm --filter @cs5224/web db:push       # Push schema directly (dev)
pnpm --filter @cs5224/web db:studio     # Open Drizzle Studio UI
```

## Rules

- Keep UI components in `src/components/ui/` and feature components in `src/components/<feature>/`.
- **Always use shadcn components** for all interactive and presentational UI primitives — buttons, inputs, cards, tables, badges, dialogs, tabs, selects, alerts, skeletons, navigation actions, etc.
- Avoid styling raw HTML controls when a shadcn primitive exists.
- Keep DB schema in `src/db/schema/index.ts`.
- Avoid ad-hoc SQL outside Drizzle migrations.
- Maintain responsive behavior for desktop and mobile.
- Use `lucide-react` for all icons.
- Use `sonner` (via `<Toaster />`) for toast notifications.

---

## Drizzle ORM

### Configuration

| File                     | Purpose                                                      |
| ------------------------ | ------------------------------------------------------------ |
| `drizzle.config.ts`      | Drizzle Kit config (schema path, output dir, DB credentials) |
| `src/db/config.ts`       | Database URL configuration                                   |
| `src/db/client.ts`       | Singleton DB client with connection pooling                  |
| `src/db/schema/index.ts` | All table definitions + relations + types                    |
| `drizzle/`               | Generated SQL migration files                                |

### Database Connection

Default: `postgresql://openswarm:openswarm@localhost:5432/openswarm`

Override with `DATABASE_URL` env var. The client uses connection pooling (10 in prod, 1 in dev) and caches the connection on `globalThis` to survive HMR.

### Schema Tables

The Drizzle schema mirrors the Go control plane's PostgreSQL tables:

| Table        | Description                          | Key Fields                                                    |
| ------------ | ------------------------------------ | ------------------------------------------------------------- |
| `swarms`     | Swarm definitions from `swarm.yaml`  | id (UUID), name, spec (JSONB), status                         |
| `agentSpecs` | Agent role configs within a swarm    | swarmId (FK), name, model, policyName, config (JSONB)         |
| `policies`   | AgentPolicy definitions              | name, spec (JSONB)                                            |
| `tasks`      | Task records with cost tracking      | swarmId (FK), agentRole, status, tokensUsed, costUsd          |
| `genomes`    | Agent Genetics genome snapshots      | agentRole, generation, genes (JSONB), fitness (JSONB), active |
| `ideas`      | Legacy ideas table (kept for compat) | slug, title, problem                                          |

### Relations

```
swarms 1──* agentSpecs
swarms 1──* tasks
```

### Usage Pattern

```typescript
import { db } from '@/db/client';
import { swarms, tasks } from '@/db/schema';
import { eq, desc } from 'drizzle-orm';

// List swarms
const allSwarms = await db.select().from(swarms).orderBy(desc(swarms.createdAt));

// Get swarm with agent specs (relational query)
const swarmWithAgents = await db.query.swarms.findFirst({
  where: eq(swarms.name, 'news-pipeline'),
  with: { agentSpecs: true },
});

// List tasks for a swarm
const swarmTasks = await db
  .select()
  .from(tasks)
  .where(eq(tasks.swarmId, swarmId))
  .orderBy(desc(tasks.createdAt));
```

### Adding New Tables

1. Add table definition to `src/db/schema/index.ts` using `pgTable()`
2. Add relations with `relations()` if needed
3. Export `type X = typeof table.$inferSelect` and `type NewX = typeof table.$inferInsert`
4. Run `pnpm --filter @cs5224/web db:generate` to create migration
5. Run `pnpm --filter @cs5224/web db:migrate` to apply

---

## shadcn/ui

### Installed Components (52)

Accordion, Alert, AlertDialog, AspectRatio, Avatar, Badge, Breadcrumb, Button, ButtonGroup, Calendar, Card, Carousel, Chart, Checkbox, Collapsible, Command, ContextMenu, Dialog, Drawer, DropdownMenu, Empty, Field, Form, HoverCard, Input, InputGroup, InputOTP, Item, KBD, Label, Menubar, NavigationMenu, Pagination, Popover, Progress, RadioGroup, Resizable, ScrollArea, Select, Separator, Sheet, Sidebar, Skeleton, Slider, Sonner, Spinner, Switch, Table, Tabs, Textarea, Toggle, ToggleGroup, Tooltip.

### Component Usage Guide

| Use Case                     | shadcn Component                                                          | Import                     |
| ---------------------------- | ------------------------------------------------------------------------- | -------------------------- |
| Page sections / data display | `Card`, `CardHeader`, `CardTitle`, `CardContent`                          | `@/components/ui/card`     |
| Status indicators            | `Badge` (variants: default, secondary, destructive, outline)              | `@/components/ui/badge`    |
| Tabbed interfaces            | `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`                          | `@/components/ui/tabs`     |
| Data tables                  | `Table`, `TableHeader`, `TableRow`, `TableHead`, `TableBody`, `TableCell` | `@/components/ui/table`    |
| Error/info messages          | `Alert`, `AlertTitle`, `AlertDescription`                                 | `@/components/ui/alert`    |
| Loading states               | `Skeleton`                                                                | `@/components/ui/skeleton` |
| Forms                        | `Input`, `Textarea`, `Select`, `Checkbox`, `Switch`                       | `@/components/ui/[name]`   |
| Form validation              | `Form`, `FormField`, `FormItem`, `FormLabel`, `FormMessage`               | `@/components/ui/form`     |
| Actions                      | `Button` (variants: default, outline, ghost, destructive, link)           | `@/components/ui/button`   |
| Navigation                   | `NavigationMenu`, `Sheet` (mobile)                                        | `@/components/ui/[name]`   |
| Modals                       | `Dialog`, `AlertDialog`, `Sheet`, `Drawer`                                | `@/components/ui/[name]`   |
| Toast notifications          | `sonner` via `toast()`                                                    | `sonner`                   |
| Dropdowns                    | `DropdownMenu`, `Select`, `Command` (combobox)                            | `@/components/ui/[name]`   |
| Tooltips                     | `Tooltip`, `HoverCard`                                                    | `@/components/ui/[name]`   |

### Adding New shadcn Components

```bash
npx shadcn@latest add <component-name>
```

Components are generated into `src/components/ui/`. They use Radix UI primitives under the hood with Tailwind styling via `class-variance-authority`.

### Configuration

`components.json` at repo root configures:

- RSC support enabled
- TypeScript enabled
- Tailwind CSS aliases: `@/` path prefix
- Default style: "default"
- CSS variables for theming

### Styling Conventions

- Use Tailwind utility classes. Prefer `className` composition over custom CSS.
- Dark mode: use `bg-background`, `text-foreground`, `text-muted-foreground`, `border-border` etc.
- Spacing: consistent use of `space-y-*`, `gap-*`, container `p-6`.
- Status colors: `bg-emerald-*` (online/connected), `bg-red-*` (error/failed), `bg-yellow-*` (warning/pending), `bg-zinc-*` (inactive/secondary).

---

## Project-Specific Components

| Component      | Location                                      | Purpose                               |
| -------------- | --------------------------------------------- | ------------------------------------- |
| `SwarmGraph`   | `src/components/dashboard/swarm-graph.tsx`    | React Flow DAG of agents              |
| `AgentNode`    | `src/components/dashboard/agent-node.tsx`     | Custom React Flow node                |
| `DataFlowEdge` | `src/components/dashboard/data-flow-edge.tsx` | Animated SVG edge                     |
| `SiteHeader`   | `src/components/site-header.tsx`              | Responsive nav with Sheet mobile menu |
| `SiteFooter`   | `src/components/site-footer.tsx`              | Global footer                         |

## Hooks

| Hook        | Location                   | Purpose                                 |
| ----------- | -------------------------- | --------------------------------------- |
| `useSSE`    | `src/hooks/use-sse.ts`     | SSE connection with auto-reconnect (3s) |
| `useMobile` | `src/hooks/use-mobile.tsx` | Responsive breakpoint detection         |
| `useToast`  | `src/hooks/use-toast.ts`   | Toast notification hook                 |

## API Client

`src/lib/api-client.ts` — TypeScript HTTP client for the Go control plane at `http://localhost:9090`:

- `listSwarms()`, `getSwarm(name)`, `listAgents(swarm)`, `listTasks(swarm)`
- `sseURL(swarm)` — returns SSE endpoint URL
- Types: `Swarm`, `SwarmSpec`, `AgentSpec`, `TopologyEdge`, `Agent`, `Task`
