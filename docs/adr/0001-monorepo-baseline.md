# ADR 0001: Polyglot Monorepo Baseline

## Status

Accepted

## Context

The project needs rapid iteration across frontend and backend while preserving consistent quality and documentation for academic deliverables.

## Decision

Use a single monorepo with:

- Next.js web app
- FastAPI service
- Go service
- Shared TypeScript package for frontend contracts
- mise for runtime/toolchain pinning
- CI split into JS and Python/Go pipelines

## Consequences

- Faster onboarding and unified docs
- Slightly more setup complexity than single-language repos
- Clear path for cloud vs on-prem experiments
