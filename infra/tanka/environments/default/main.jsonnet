// environments/default/main.jsonnet
// Tanka environment for Kiln dev deployment on GKE Autopilot.
//
// Usage:
//   tk show environments/default
//   tk apply environments/default

local kiln = import 'kiln.libsonnet';

kiln {
  _config+:: {
    namespace: 'kiln',

    // Set these from CI or terraform output
    image_registry: std.extVar('IMAGE_REGISTRY'),  // e.g. asia-southeast1-docker.pkg.dev/kiln-cs5224/kiln
    image_tag: std.extVar('IMAGE_TAG'),             // e.g. abc1234 (git sha)

    // From terraform output
    registry_db_connection: std.extVar('REGISTRY_DB_CONNECTION'),
    chat_db_connection: std.extVar('CHAT_DB_CONNECTION'),
    gcs_bucket: std.extVar('GCS_BUCKET'),
    workload_sa: std.extVar('WORKLOAD_SA'),
  },

  // Secret — created manually or via CI (not in git)
  // kubectl create secret generic kiln-secrets -n kiln \
  //   --from-literal=CLERK_DOMAIN=... \
  //   --from-literal=CLERK_SECRET_KEY=... \
  //   --from-literal=MISTRAL_API_KEY=... \
  //   --from-literal=KILN_INTERNAL_SECRET=... \
  //   --from-literal=DATABASE_URL=postgresql://kiln:...@/kiln_registry?host=/cloudsql/... \
  //   --from-literal=CHAT_DATABASE_URL=postgresql://kiln:...@/kiln_chat?host=/cloudsql/...
}
