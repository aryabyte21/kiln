# Infrastructure Strategy (Modern + Pragmatic)

## Goals

- Keep deployment modern and production-like.
- Avoid unnecessary complexity for a small team and academic timeline.
- Support clear cloud vs on-prem comparisons required by CS5224.

## Recommendation

Use **Terraform + Argo CD + Helm/Kustomize** as the default path.

### Why this is the best starting point

- Terraform cleanly handles cloud and on-prem provisioning with reusable modules.
- Argo CD gives a modern GitOps control plane with clear auditability and rollback.
- Helm/Kustomize are simpler for most teams than Jsonnet-based pipelines at project start.

## Should we use Tanka + Argo CD?

Short answer: **not initially**.

Use Tanka only if you hit one or more of these conditions:

- Many environments with repeated but slightly varying config blocks.
- Need higher-order manifest composition that becomes unmanageable in Helm/Kustomize.
- Team is comfortable with Jsonnet and can maintain it without slowing delivery.

For current phase, Tanka adds cognitive load and slows iteration without strong payback.

## Decision Matrix: Argo CD + Kustomize/Helm vs Argo CD + Tanka

| Dimension                  | Kustomize/Helm | Tanka (Jsonnet) |
| -------------------------- | -------------- | --------------- |
| Team onboarding speed      | High           | Medium/Low      |
| Config abstraction power   | Medium         | High            |
| Day-1 maintainability      | High           | Medium          |
| Multi-env DRY capability   | Medium         | High            |
| Cognitive load             | Low/Medium     | High            |
| Fit for this project phase | Strong         | Premature       |

Recommendation: start with Kustomize/Helm and re-evaluate Tanka only if config duplication becomes a measurable bottleneck.

## Phase Plan

1. Phase 1 (now)
   - Terraform for infra
   - Argo CD app-of-apps
   - Kustomize overlays per environment
2. Phase 2 (if needed)
   - Introduce Helm charts for shared app packaging
3. Phase 3 (optional)
   - Add Tanka for advanced configuration generation

## Platform components (modern baseline)

- Ingress/Gateway: NGINX Ingress or Gateway API implementation
- TLS: cert-manager
- Secrets: External Secrets Operator + cloud secret manager
- Policy: Kyverno or OPA Gatekeeper
- Observability: Prometheus + Grafana + Loki (or managed cloud equivalents)

## Re-evaluation trigger for Tanka

Introduce Tanka only if at least two of the following are true:

- 4+ environments with frequent config drift.
- Repeated copy/paste patches across many services.
- Frequent policy/config generation logic that is awkward in Helm/Kustomize.
