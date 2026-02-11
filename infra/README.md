# Infrastructure Baseline

This folder tracks infrastructure as code and GitOps configuration.

## Recommended stack

- Provisioning: Terraform
- Deployment model: Argo CD (GitOps)
- App packaging: Helm charts (or Kustomize overlays where simpler)
- Optional advanced config: Tanka/Jsonnet only if config generation complexity becomes high

## Folder intent

- `argocd/`: Argo CD app-of-apps plus per-environment `Application` objects
- `k8s/base`: reusable Kubernetes manifests for all services
- `k8s/overlays/*`: environment-specific Kustomize overlays
- `terraform/environments/*`: per-environment Terraform roots
- `terraform/modules/*`: reusable Terraform modules

## Bootstrap flow

1. Provision baseline cloud resources with Terraform in `terraform/environments/dev`.
2. Install Argo CD in the cluster.
3. Apply `argocd/app-of-apps.yaml`.
4. Argo CD reconciles environment apps from `argocd/apps/`.
