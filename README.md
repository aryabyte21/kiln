<div align="center">

# 🚀 CS5224 Cloud SaaS Monorepo

**A production-ready polyglot monorepo for building and comparing cloud-native SaaS applications**

[![CI JS](https://github.com/YOUR_USERNAME/cs5224-monorepo/actions/workflows/ci-js.yml/badge.svg)](https://github.com/YOUR_USERNAME/cs5224-monorepo/actions/workflows/ci-js.yml)
[![CI Python Go](https://github.com/YOUR_USERNAME/cs5224-monorepo/actions/workflows/ci-python-go.yml/badge.svg)](https://github.com/YOUR_USERNAME/cs5224-monorepo/actions/workflows/ci-python-go.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=next.js)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)](https://react.dev/)
[![Python](https://img.shields.io/badge/Python-3.12-3776AB?logo=python)](https://www.python.org/)
[![Go](https://img.shields.io/badge/Go-1.23-00ADD8?logo=go)](https://go.dev/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

_Built for NUS CS5224 Cloud Computing Project (Spring 2026)_

[Features](#-features) • [Quick Start](#-quick-start) • [Architecture](#-architecture) • [Documentation](#-documentation) • [Contributing](#-contributing)

</div>

---

## ✨ Features

### 🎨 Modern Frontend Stack

- **Next.js 15** with App Router and React Server Components
- **React 19** with the latest concurrent features
- **shadcn/ui** - Beautiful, accessible component library (full core UI set installed)
- **Tailwind CSS** - Utility-first styling
- **Drizzle ORM** - Type-safe database access with migrations
- **TypeScript** - End-to-end type safety

### 🔧 Polyglot Backend Services

- **FastAPI** (Python) - High-performance async API framework
- **Go HTTP** - Low-latency service endpoints
- **PostgreSQL** - Robust relational database
- Service health monitoring and status endpoints

### 🛠️ Developer Experience

- **⚡ 2-Minute Setup** - Automated quickstart script
- **📦 Nx Monorepo** - Efficient task orchestration and caching
- **🔄 mise** - Runtime version management (Node, Python, Go)
- **🎯 Pre-commit Hooks** - Auto-fix linting and formatting
- **📝 Changesets** - Version management and changelog generation
- **🐳 Docker Compose** - Local infrastructure orchestration

### 🚀 Production Ready

- **CI/CD Pipelines** - GitHub Actions for JS, Python, and Go
- **Infrastructure as Code** - Terraform + Kubernetes manifests
- **GitOps Ready** - ArgoCD configuration for deployments
- **Environment Validation** - Zod-based env var validation
- **Type-Safe APIs** - Shared types across services

---

## 🎯 Quick Start

### Prerequisites

- [**mise**](https://mise.jdx.dev/) - Runtime version manager
- [**Docker Desktop**](https://www.docker.com/products/docker-desktop/) - For PostgreSQL
- **Git** - Version control

### One-Command Setup

```bash
./scripts/quickstart.sh
```

This script will:

1. ✅ Install Node.js, pnpm, Python, and Go via mise
2. ✅ Install all dependencies (Node + Python)
3. ✅ Set up Python virtual environment
4. ✅ Create `.env` file from template
5. ✅ Start PostgreSQL with Docker
6. ✅ Run database migrations

**Setup time: ~2 minutes** ⏱️

### Manual Setup

<details>
<summary>Click to expand manual setup steps</summary>

```bash
# 1. Install runtimes
mise install

# 2. Install Node dependencies
pnpm install

# 3. Set up Python environment
python -m venv .venv
./.venv/bin/pip install --upgrade pip
./.venv/bin/pip install -r apps/py-api/requirements-dev.txt

# 4. Configure environment
cp .env.example .env

# 5. Start infrastructure
docker compose up -d

# 6. Run database migrations
pnpm db:migrate

# 7. Start all services
pnpm dev
```

</details>

### Access Your Services

| Service            | URL                                                          | Description                         |
| ------------------ | ------------------------------------------------------------ | ----------------------------------- |
| **Web App**        | [http://localhost:3000](http://localhost:3000)               | Next.js frontend with shadcn/ui     |
| **FastAPI**        | [http://localhost:8000/docs](http://localhost:8000/docs)     | Python API with auto-generated docs |
| **Go API**         | [http://localhost:8080/health](http://localhost:8080/health) | Go service health check             |
| **Drizzle Studio** | `pnpm db:studio`                                             | Database GUI on port 4983           |

---

## 🏗️ Architecture

### Repository Structure

```
cs5224-monorepo/
├── apps/
│   ├── web/              # Next.js 15 + React 19 + shadcn/ui
│   │   ├── app/          # App Router pages and layouts
│   │   ├── src/
│   │   │   ├── components/  # React components (shadcn/ui)
│   │   │   ├── db/          # Drizzle ORM schema and client
│   │   │   └── lib/         # Utilities and services
│   │   └── drizzle/      # Database migrations
│   │
│   ├── py-api/           # FastAPI Python service
│   │   ├── app/
│   │   │   └── main.py      # FastAPI app entry and endpoints
│   │   └── tests/
│   │
│   └── go-api/           # Go HTTP service
│       ├── cmd/server/      # Main entry point
│       └── internal/        # Internal packages
│
├── packages/
│   ├── types/            # Shared TypeScript types
│   ├── eslint-config/    # Shared ESLint configurations
│   └── tsconfig/         # Shared TypeScript configs
│
├── infra/                # Infrastructure as Code
│   ├── terraform/        # Terraform configurations
│   ├── k8s/              # Kubernetes manifests
│   └── argocd/           # ArgoCD applications
│
├── docs/                 # Project documentation
│   ├── architecture.md
│   ├── cost-comparison.md
│   └── preliminary-outline.md
│
├── scripts/              # Automation scripts
│   └── quickstart.sh     # One-command setup
│
└── .cursor/              # AI assistant configuration
    ├── rules/            # Coding standards
    ├── agents/           # Specialized AI agents
    └── commands/         # Common workflows
```

### Tech Stack Deep Dive

#### Frontend (`apps/web`)

- **Framework**: Next.js 15 with App Router
- **React**: Version 19 with Server Components
- **UI Components**: shadcn/ui (15+ components included)
- **Styling**: Tailwind CSS with CSS variables
- **Database**: Drizzle ORM + PostgreSQL
- **Forms**: react-hook-form + Zod validation
- **Icons**: Lucide React
- **Testing**: Vitest

#### Backend Services

- **FastAPI** (`apps/py-api`): Async Python API with automatic OpenAPI docs
- **Go** (`apps/go-api`): High-performance service layer
- **PostgreSQL**: Primary database (via Docker Compose)

#### DevOps & Tooling

- **Monorepo**: Nx for task orchestration
- **Package Manager**: pnpm with workspaces
- **Runtime Management**: mise (Node 22, Python 3.12, Go 1.23)
- **Git Hooks**: Husky + lint-staged
- **CI/CD**: GitHub Actions (separate pipelines for JS, Python, Go)
- **Containerization**: Docker + docker-compose
- **IaC**: Terraform for cloud resources
- **GitOps**: ArgoCD for Kubernetes deployments

---

## 📦 Available Commands

### Development

```bash
pnpm dev              # Start all services (web + py-api + go-api)
pnpm dev:web          # Start Next.js only
pnpm dev:py           # Start FastAPI only
pnpm dev:go           # Start Go API only
```

### Building

```bash
pnpm build            # Build web + types
pnpm build:all        # Build all services (including Python + Go)
```

### Code Quality

```bash
pnpm lint             # Lint TypeScript projects
pnpm lint:all         # Lint all projects (TS + Python + Go)
pnpm lint:fix         # Auto-fix linting issues + format
pnpm typecheck        # TypeScript type checking
pnpm format           # Format all files with Prettier
pnpm format:check     # Check formatting without writing
```

### Testing

```bash
pnpm test             # Run web tests
pnpm test:all         # Run all tests (web + py + go)
pnpm test:watch       # Run tests in watch mode
```

### Database

```bash
pnpm db:generate      # Generate migration when schema changes
pnpm db:migrate       # Apply migrations
pnpm db:studio        # Open Drizzle Studio GUI
pnpm db:push          # Push schema changes (dev only)
```

### Validation

```bash
pnpm check            # Run all JS/TS checks (lint + typecheck + test + build)
pnpm check:all        # Run checks for all languages
pnpm run ci:local     # CI-like local run (frozen lockfile + check:all)
```

### Utilities

```bash
pnpm clean            # Remove node_modules and cache
pnpm clean:all        # Remove all build artifacts + venv
pnpm setup            # Run quickstart script
pnpm changeset        # Create a changeset for versioning
```

---

## 🧩 Integrated Components

### shadcn/ui Components (15+)

All components are fully typed and accessible out of the box:

- ✅ **Button** - Multiple variants and sizes
- ✅ **Card** - Flexible container with header/content/footer
- ✅ **Badge** - Status indicators and labels
- ✅ **Input** - Text inputs with validation
- ✅ **Label** - Form labels
- ✅ **Textarea** - Multi-line text input
- ✅ **Select** - Dropdown selections
- ✅ **Form** - react-hook-form integration
- ✅ **Dropdown Menu** - Context menus and dropdowns
- ✅ **Avatar** - User profile pictures with fallback
- ✅ **Dialog** - Modal dialogs
- ✅ **Sheet** - Sliding panels
- ✅ **Tabs** - Tabbed interfaces
- ✅ **Table** - Data tables
- ✅ **Tooltip** - Hover tooltips
- ✅ **Sonner** - Toast notifications

**See them in action**: Visit [http://localhost:3000/showcase](http://localhost:3000/showcase) after running `pnpm dev`

### Adding More Components

```bash
cd apps/web
npx shadcn@latest add [component-name]
```

Browse available components: [ui.shadcn.com](https://ui.shadcn.com/)

---

## 📚 Documentation

### Project Documentation

- **[Architecture Overview](docs/architecture.md)** - System design and runtime topology
- **[Cost Comparison](docs/cost-comparison.md)** - On-premise vs. cloud cost analysis
- **[Preliminary Report Outline](docs/preliminary-outline.md)** - Project report structure
- **[Infrastructure Strategy](docs/infra-strategy.md)** - IaC and GitOps approach
- **[Contributing Guide](CONTRIBUTING.md)** - Contribution guidelines and workflow

### Key Files

- **[AGENTS.md](AGENTS.md)** - AI assistant instructions for codebase
- **[.env.example](.env.example)** - Environment variable template
- **[components.json](apps/web/components.json)** - shadcn/ui configuration

### Online Resources

- [Next.js Documentation](https://nextjs.org/docs)
- [shadcn/ui Components](https://ui.shadcn.com/)
- [Drizzle ORM Docs](https://orm.drizzle.team/)
- [FastAPI Documentation](https://fastapi.tiangolo.com/)
- [Nx Workspace](https://nx.dev/)

---

## 🎓 CS5224 Project Context

This monorepo is designed for the **NUS CS5224 Cloud Computing** course project. The goal is to:

1. **Develop a Business Case** - Identify a problem and design a cloud service solution
2. **Implement a Working Prototype** - Build a functional SaaS application
3. **Compare Deployment Costs** - Analyze on-premise vs. cloud hosting costs
4. **Evaluate Performance** - Benchmark and optimize the solution

### Project Deadlines

- ⏰ **Preliminary Report**: March 9, 2026 @ 18:00
- ⏰ **Final Report & Video**: April 19, 2026 @ 23:59

### What Makes This Repo Special

✅ **Production-Ready** - Not just a prototype, but a solid foundation  
✅ **Best Practices** - Industry-standard tooling and patterns  
✅ **Fast Iteration** - Optimized DX for rapid development  
✅ **Cost-Conscious** - Tools and architecture chosen for cost comparison analysis  
✅ **Documentation-First** - Clear guides for onboarding and contribution  
✅ **AI-Enhanced** - Cursor rules and agents for intelligent assistance

---

## 🤝 Contributing

We welcome contributions! Please read our [Contributing Guide](CONTRIBUTING.md) for details on:

- Setting up your development environment
- Code standards and style guides
- Commit message conventions
- Pull request process
- Testing requirements

### Quick Contribution Workflow

```bash
# 1. Create a feature branch
git checkout -b feat/your-feature

# 2. Make your changes and commit
git add .
git commit -m "feat: add amazing feature"

# 3. Run validation
pnpm check:all

# 4. Push and create PR
git push origin feat/your-feature
```

Our pre-commit hooks will automatically:

- Lint and fix code
- Format with Prettier
- Prevent commits with errors

---

## 🔧 Troubleshooting

<details>
<summary><strong>mise not found</strong></summary>

Install mise:

```bash
curl https://mise.run | sh
```

Then activate it in your shell:

```bash
# For bash
echo 'eval "$(~/.local/bin/mise activate bash)"' >> ~/.bashrc

# For zsh
echo 'eval "$(~/.local/bin/mise activate zsh)"' >> ~/.zshrc
```

</details>

<details>
<summary><strong>Docker not running</strong></summary>

Ensure Docker Desktop is installed and running:

- macOS: [Docker Desktop for Mac](https://docs.docker.com/desktop/install/mac-install/)
- Windows: [Docker Desktop for Windows](https://docs.docker.com/desktop/install/windows-install/)
- Linux: [Docker Engine](https://docs.docker.com/engine/install/)

</details>

<details>
<summary><strong>Database connection error</strong></summary>

1. Check if PostgreSQL is running: `docker compose ps`
2. Restart services: `docker compose restart`
3. Verify `.env` has correct `DATABASE_URL`
4. Try: `pnpm db:migrate` again

</details>

<details>
<summary><strong>Port already in use</strong></summary>

Check what's using the port:

```bash
# macOS/Linux
lsof -i :3000  # or :8000, :8080

# Windows
netstat -ano | findstr :3000
```

Kill the process or change port in `.env`

</details>

<details>
<summary><strong>Python tests fail</strong></summary>

Ensure virtual environment is activated and dependencies installed:

```bash
source .venv/bin/activate  # or .venv\Scripts\activate on Windows
pip install -r apps/py-api/requirements-dev.txt
```

</details>

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- **NUS CS5224** - Cloud Computing course and project guidelines
- **shadcn** - For the amazing UI component library
- **Vercel** - Next.js framework and tooling
- **FastAPI Community** - Excellent Python web framework
- **The Go Team** - Robust and performant language

---

<div align="center">

**Built with ❤️ for CS5224 Spring 2026**

[⬆ Back to Top](#-cs5224-cloud-saas-monorepo)

</div>
