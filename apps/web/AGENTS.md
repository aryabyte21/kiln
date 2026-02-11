# AGENTS Instructions for `apps/web`

## Stack

- Next.js App Router
- shadcn/ui primitives
- Tailwind CSS
- Drizzle ORM (Postgres)

## Commands

```bash
pnpm --filter @cs5224/web dev
pnpm --filter @cs5224/web lint
pnpm --filter @cs5224/web typecheck
pnpm --filter @cs5224/web test
pnpm --filter @cs5224/web build
pnpm --filter @cs5224/web db:generate
pnpm --filter @cs5224/web db:migrate
pnpm --filter @cs5224/web db:push
```

## Rules

- Keep UI components in `src/components/ui` and feature code in `src/`.
- Use shadcn components for all interactive and presentational UI primitives (buttons, inputs, cards, tables, badges, dialogs, tabs, navigation actions).
- Avoid styling raw HTML controls directly in page/feature code when a shadcn primitive exists.
- Keep DB schema in `src/db/schema`.
- Avoid ad-hoc SQL outside Drizzle migrations.
- Maintain responsive behavior for desktop and mobile demos.
