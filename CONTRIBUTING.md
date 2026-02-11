# Contributing to CS5224 Monorepo

Thank you for contributing to our Cloud Computing (CS5224) project! This guide will help you get started and ensure a smooth collaboration experience.

## Table of Contents

- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Code Standards](#code-standards)
- [Commit Guidelines](#commit-guidelines)
- [Pull Request Process](#pull-request-process)
- [Project Structure](#project-structure)
- [Testing](#testing)

## Getting Started

### Prerequisites

- **mise**: Runtime version manager ([Install mise](https://mise.jdx.dev/getting-started.html))
- **Docker**: For PostgreSQL and other infrastructure
- **Git**: Version control

### Quick Setup

Run our automated setup script:

```bash
./scripts/quickstart.sh
```

Or follow manual steps:

```bash
# Install runtimes
mise install

# Install Node dependencies
pnpm install

# Setup Python environment
python -m venv .venv
./.venv/bin/pip install -r apps/py-api/requirements-dev.txt

# Copy environment variables
cp .env.example .env

# Start infrastructure
docker compose up -d

# Run database migrations
pnpm db:migrate

# Start all services
pnpm dev
```

## Development Workflow

### Daily Development

```bash
# Start all services in development mode
pnpm dev

# Or start services individually
pnpm dev:web   # Next.js on :3000
pnpm dev:py    # FastAPI on :8000
pnpm dev:go    # Go API on :8080
```

### Before Committing

Our pre-commit hooks will automatically run, but you can manually check:

```bash
# Run linting and formatting
pnpm lint:fix

# Run type checking
pnpm typecheck

# Run tests
pnpm test:all

# Run all validation checks
pnpm check:all
```

## Code Standards

### TypeScript/JavaScript

- Use TypeScript for all new code
- Follow ESLint rules (auto-fixed on commit)
- Use functional components with hooks in React
- Prefer named exports over default exports
- Use `@/` path aliases for imports

Example:

```typescript
import { Button } from '@/components/ui/button';
import { env } from '@/lib/env';

export function MyComponent() {
  return <Button>Click me</Button>;
}
```

### Python

- Follow PEP 8 style guide
- Use type hints for function signatures
- Use Ruff for linting (auto-fixed on commit)
- Document functions with docstrings

Example:

```python
from typing import List

def fetch_users(limit: int = 10) -> List[dict]:
    """
    Fetch a list of users from the database.

    Args:
        limit: Maximum number of users to return

    Returns:
        List of user dictionaries
    """
    pass
```

### Go

- Follow standard Go conventions
- Use `gofmt` for formatting
- Write tests alongside code
- Document exported functions

Example:

```go
// FetchUsers retrieves a list of users from the database
func FetchUsers(ctx context.Context, limit int) ([]User, error) {
    // implementation
}
```

## Commit Guidelines

We use conventional commits for clear history and automatic changelog generation.

### Commit Message Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `perf`: Performance improvements
- `test`: Adding or updating tests
- `chore`: Maintenance tasks
- `ci`: CI/CD changes

### Examples

```bash
# Feature
git commit -m "feat(web): add user authentication flow"

# Bug fix
git commit -m "fix(api): resolve CORS issue with FastAPI endpoints"

# Documentation
git commit -m "docs(readme): update setup instructions"

# Breaking change
git commit -m "feat(api)!: migrate to v2 API endpoints

BREAKING CHANGE: All v1 endpoints are deprecated"
```

### Pre-commit Hooks

Our Husky pre-commit hooks will:

1. ✅ Lint and auto-fix TypeScript/JavaScript files
2. ✅ Format all files with Prettier
3. ✅ Lint Python files with Ruff
4. ❌ Block commits if errors remain

## Pull Request Process

### 1. Create a Branch

```bash
git checkout -b feat/your-feature-name
# or
git checkout -b fix/bug-description
```

### 2. Make Changes

- Write clear, focused commits
- Add tests for new features
- Update documentation as needed

### 3. Run Validation

```bash
pnpm check:all
```

### 4. Create Pull Request

- Use a descriptive title following conventional commits
- Fill out the PR template
- Link related issues
- Request review from team members

### PR Template

```markdown
## Description

Brief description of changes

## Type of Change

- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing

- [ ] All tests pass locally
- [ ] Added tests for new functionality
- [ ] Manual testing completed

## Checklist

- [ ] Code follows project standards
- [ ] Self-review completed
- [ ] Documentation updated
- [ ] No new warnings or errors
```

## Project Structure

```
.
├── apps/
│   ├── web/              # Next.js frontend
│   ├── py-api/           # FastAPI backend
│   └── go-api/           # Go backend
├── packages/
│   ├── types/            # Shared TypeScript types
│   ├── eslint-config/    # Shared ESLint configs
│   └── tsconfig/         # Shared TS configs
├── docs/                 # Project documentation
├── infra/                # Infrastructure as Code
├── scripts/              # Utility scripts
└── .cursor/              # AI assistant configuration
```

### Adding New Files

- **Components**: `apps/web/src/components/`
- **API Routes**: `apps/web/app/api/`
- **Python Endpoints**: `apps/py-api/app/`
- **Go Handlers**: `apps/go-api/internal/http/`
- **Shared Types**: `packages/types/src/`
- **Documentation**: `docs/`

## Testing

### Web (Vitest)

```bash
# Run tests
pnpm test

# Watch mode
pnpm test:watch

# Coverage
pnpm --filter @cs5224/web test -- --coverage
```

### Python (pytest)

```bash
# Run tests
cd apps/py-api && ../../.venv/bin/python -m pytest

# With coverage
../../.venv/bin/python -m pytest --cov=app --cov-report=html
```

### Go (go test)

```bash
# Run tests
cd apps/go-api && go test ./...

# With coverage
go test -cover ./...
```

## Database Changes

### Creating a New Migration

1. Update schema in `apps/web/src/db/schema/index.ts`
2. Generate migration:
   ```bash
   pnpm db:generate
   ```
3. Review generated SQL in `apps/web/drizzle/`
4. Apply migration:
   ```bash
   pnpm db:migrate
   ```

### Database GUI

```bash
pnpm db:studio
```

Opens Drizzle Studio on `http://localhost:4983`

## Changesets (Version Management)

For significant changes, create a changeset:

```bash
pnpm changeset
```

Select affected packages and change type (major/minor/patch), then write a summary. Changesets are committed with your PR and processed during releases.

## Environment Variables

Never commit sensitive data to `.env`. Use `.env.example` as a template:

```bash
# Bad ❌
DATABASE_URL=postgresql://user:real-password@prod-host/db

# Good ✅
DATABASE_URL=postgresql://cs5224:cs5224@localhost:5432/cs5224
```

## Getting Help

- **Issues**: Check existing issues or create a new one
- **Discussions**: Use GitHub Discussions for questions
- **Team**: Reach out to team members on your preferred communication channel

## Project Deadlines

- **Preliminary Report**: March 9, 2026 @ 18:00
- **Final Report & Video**: April 19, 2026 @ 23:59

Plan your contributions accordingly! 🚀

---

Thank you for contributing to make this project successful! 🎉
