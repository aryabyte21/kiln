# Repository Hardening Checklist

This document captures the post-scaffold hardening pass and what was improved to align with modern monorepo best practices.

## What was checked

- Monorepo orchestration and task graph consistency
- Lint/type/test/build coverage across JS, Python, and Go
- CI parity with local workflows
- Infrastructure bootstrapping path
- Baseline developer ergonomics and formatting standards

## Improvements applied

1. Replaced Turborepo with Nx for deterministic task orchestration and project graph control.
2. Added project-level Nx targets for all apps (`web`, `py-api`, `go-api`) and shared library (`types`).
3. Added Python linting with Ruff and wired it into Nx and CI.
4. Added Go formatting enforcement (`gofmt -l`) in addition to `go vet`.
5. Added repo-wide formatting/editor standards:
   - `.editorconfig`
   - `.prettierrc.cjs`
   - `.prettierignore`
6. Isolated Python tooling to repo-local `.venv` for reproducible local runs.
7. Added GitOps skeleton with Argo CD app-of-apps and environment applications.
8. Added Kubernetes base + overlays with Kustomize for dev/prod separation.
9. Added Terraform environment/module skeleton with clear extension points.
10. Added workflow concurrency controls and dependency caching in CI.
11. Separated lint from Next.js build (`next build --no-lint`) to keep build deterministic under Nx while preserving lint as a mandatory gate.

## Remaining intentional gaps

These are intentionally deferred until feature direction is finalized:

- Container build/release workflows (Dockerfiles + image publishing)
- Production secrets integration (External Secrets + cloud secret manager wiring)
- Observability stack manifests (Prometheus/Loki/Grafana or managed equivalents)
- Policy-as-code gate (Kyverno/OPA) and admission controls

## Why this is a strong starting point

- Keeps complexity low enough for fast iteration.
- Preserves a clean path to production-grade patterns.
- Aligns with modern platform architecture without over-engineering.
