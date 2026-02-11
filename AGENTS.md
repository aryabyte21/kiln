# AGENTS Instructions for CS5224 Monorepo

## Read Order

1. `CS5224/AGENTS.md`
2. App-specific AGENTS:
   - `CS5224/apps/web/AGENTS.md`
   - `CS5224/apps/py-api/AGENTS.md`
   - `CS5224/apps/go-api/AGENTS.md`

## Directory Map

- `apps/web`: Next.js + shadcn/ui + Drizzle
- `apps/py-api`: FastAPI service
- `apps/go-api`: Go service
- `packages/types`: shared TS contracts
- `packages/eslint-config`: shared ESLint config
- `packages/tsconfig`: shared TS configs
- `.cursor`: AI rules/agents/commands and MCP setup
- `.github/workflows`: CI workflows

## Engineering Standards

- Keep API contracts explicit and versioned.
- Prefer typed boundaries and strict linting.
- Keep infra assumptions documented in `docs/`.
- Use Nx targets from the repo root for task orchestration.
- Validate with lint, typecheck, test, and build before merging.

## Required Validation

From repo root:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm lint:all
pnpm test:all
pnpm build:all
```

For polyglot services:

```bash
cd apps/py-api && ../../.venv/bin/python -m pytest
cd apps/go-api && go test ./...
```

## Project Deadlines

- Preliminary report: **2026-03-09 18:00**
- Final report + video: **2026-04-19 23:59**
