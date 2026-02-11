# ADR 0002: GitOps Stack Choice

## Status
Accepted

## Context
We want a modern infrastructure stack that is reliable, explainable, and feasible for a small team under course deadlines.

## Decision
Adopt:
- Terraform for provisioning
- Argo CD for GitOps deployment
- Kustomize/Helm for manifest management

Do not adopt Tanka initially.

## Rationale
- Argo CD + Terraform is modern and industry-aligned.
- Kustomize/Helm has lower complexity and onboarding cost than Jsonnet/Tanka.
- Tanka remains an option if config composition complexity grows.

## Consequences
- Faster delivery and lower operational risk early.
- Keeps a migration path open to Tanka later.

## Revisit Conditions
- 4+ actively maintained environments.
- Significant manifest duplication despite Helm/Kustomize refactoring.
- Team-level Jsonnet fluency established.
