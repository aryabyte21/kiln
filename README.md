# CS5224 Polyglot Monorepo

A clean, modern monorepo baseline for Cloud Computing (CS5224), inspired by `k-id` and designed for long-term extensibility.

## Stack

- Frontend: Next.js (App Router), shadcn/ui, Tailwind CSS, Drizzle ORM
- API 1: FastAPI (Python)
- API 2: Go net/http
- Monorepo orchestration: Nx + pnpm workspaces
- Toolchain/runtime management: mise
- CI: GitHub Actions for JS, Python, Go
- AI config: Cursor rules, agents, commands, MCP

## Repository Layout

```text
.
├── apps
│   ├── web/                 # Next.js app with shadcn and Drizzle
│   ├── py-api/              # FastAPI service
│   └── go-api/              # Go service
├── packages
│   ├── eslint-config/       # Shared ESLint flat config
│   ├── tsconfig/            # Shared TypeScript configs
│   └── types/               # Shared TS types for frontend
├── infra/                   # GitOps + IaC strategy scaffolding
├── docs/                    # Architecture and report material
├── .cursor/                 # Cursor agents/rules/commands + MCP config
├── .github/workflows/       # CI pipelines
└── docker-compose.yml       # Local infra (Postgres)
```

## Toolchain with mise

`mise` pins and installs core runtimes:

- Node `22.13.1`
- pnpm `10.6.2`
- Python `3.12`
- Go `1.23`

Setup:

```bash
mise install
pnpm install
python -m venv .venv
./.venv/bin/python -m pip install --upgrade pip
./.venv/bin/python -m pip install -r apps/py-api/requirements-dev.txt
```

## Nx Commands

```bash
pnpm dev        # run web + py-api + go-api together via Nx
pnpm build      # build JS/TS targets via Nx (types + web)
pnpm lint       # lint JS/TS targets via Nx
pnpm typecheck  # typecheck TS projects via Nx
pnpm test       # run web tests via Nx
pnpm build:all  # build JS + Python + Go
pnpm test:all   # test web + py + go
pnpm lint:all   # lint JS + Python + Go
pnpm run check:all  # run full local validation sequence
```

Note: web build runs `next build --no-lint` intentionally because linting is enforced as a separate Nx target and CI gate.

Drizzle targets:

```bash
pnpm db:generate
pnpm db:migrate
pnpm db:studio
```

Schema location: `/Users/pinetortoise/Desktop/CS5224/apps/web/src/db/schema/index.ts`.

## Local Development

1. Start Postgres

```bash
docker compose up -d
```

2. Start all apps

```bash
pnpm dev
```

Or run services individually using `pnpm dev:web`, `pnpm dev:py`, `pnpm dev:go`.

## CI Pipelines

- `ci-js.yml`: installs dependencies and runs lint/typecheck/test/build via Nx.
- `ci-python-go.yml`: validates FastAPI and Go services directly.

## Infrastructure Direction

Infrastructure strategy is documented in:

- `/Users/pinetortoise/Desktop/CS5224/docs/infra-strategy.md`
- `/Users/pinetortoise/Desktop/CS5224/docs/adr/0002-gitops-stack-choice.md`
- `/Users/pinetortoise/Desktop/CS5224/docs/repo-hardening.md`

Short version: use Terraform + Argo CD + Helm/Kustomize for now; introduce Tanka only if manifest complexity justifies Jsonnet.
