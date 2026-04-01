// kiln.libsonnet — Shared Jsonnet library for all Kiln K8s resources.
//
// Generates Deployments, Services, ConfigMaps, and Secrets for the
// Kiln microservice platform on GKE Autopilot.

local k = import 'k.libsonnet';

{
  // ── Config ──────────────────────────────────────────────────────────────

  _config:: {
    namespace: 'kiln',
    image_registry: error 'must set _config.image_registry',  // e.g. asia-southeast1-docker.pkg.dev/kiln-cs5224/kiln
    image_tag: 'latest',

    // Cloud SQL connection names (from Terraform output)
    registry_db_connection: error 'must set _config.registry_db_connection',
    chat_db_connection: error 'must set _config.chat_db_connection',

    // GCS bucket for tool artifacts
    gcs_bucket: error 'must set _config.gcs_bucket',

    // Workload Identity SA
    workload_sa: error 'must set _config.workload_sa',

    // Service ports
    ports: {
      registry_api: 8766,
      chat_backend: 8765,
      tool_executor: 8767,
      mcp_server: 8768,
      synthesis_service: 8002,
      registry_ui: 3000,
    },
  },

  // ── Namespace ───────────────────────────────────────────────────────────

  namespace: k.core.v1.namespace.new($._config.namespace),

  // ── Service Account (Workload Identity) ─────────────────────────────────

  service_account:
    k.core.v1.serviceAccount.new('kiln-sa')
    + k.core.v1.serviceAccount.metadata.withNamespace($._config.namespace)
    + k.core.v1.serviceAccount.metadata.withAnnotations({
      'iam.gke.io/gcp-service-account': $._config.workload_sa,
    }),

  // ── ConfigMap (shared env vars) ─────────────────────────────────────────

  configmap:
    k.core.v1.configMap.new('kiln-config', {
      KILN_REGISTRY_URL: 'http://registry-api:%(registry_api)d' % $._config.ports,
      KILN_SYNTHESIS_URL: 'http://synthesis-service:%(synthesis_service)d' % $._config.ports,
      KILN_CALLBACK_URL: 'http://registry-api:%(registry_api)d/synthesis/callback' % $._config.ports,
      TOOL_EXECUTOR_URL: 'http://tool-executor:%(tool_executor)d' % $._config.ports,
      GCS_BUCKET: $._config.gcs_bucket,
      CORS_ORIGINS: 'https://kiln.dev,https://registry.kiln.dev',
    })
    + k.core.v1.configMap.metadata.withNamespace($._config.namespace),

  // ── Helper: build a standard Kiln service ───────────────────────────────

  local kilnService(name, port, image_name, args={}) = {
    local container = k.core.v1.container,
    local deployment = k.apps.v1.deployment,
    local service = k.core.v1.service,

    deployment:
      deployment.new(name, replicas=1, containers=[
        container.new(name, '%s/%s:%s' % [$._config.image_registry, image_name, $._config.image_tag])
        + container.withPorts([k.core.v1.containerPort.new(port)])
        + container.withEnvFrom([
          k.core.v1.envFromSource.configMapRef.withName('kiln-config'),
          k.core.v1.envFromSource.secretRef.withName('kiln-secrets'),
        ])
        + container.resources.withRequests({ cpu: args.cpu_request, memory: args.memory_request })
        + container.resources.withLimits({ cpu: args.cpu_limit, memory: args.memory_limit })
        + container.livenessProbe.httpGet.withPath('/health').withPort(port)
        + container.livenessProbe.withInitialDelaySeconds(10)
        + container.livenessProbe.withPeriodSeconds(15)
        + container.readinessProbe.httpGet.withPath('/health').withPort(port)
        + container.readinessProbe.withInitialDelaySeconds(5)
        + container.readinessProbe.withPeriodSeconds(5),
      ])
      + deployment.metadata.withNamespace($._config.namespace)
      + deployment.spec.template.spec.withServiceAccountName('kiln-sa'),

    service:
      service.new(name, { app: name }, [{ port: port, targetPort: port }])
      + service.metadata.withNamespace($._config.namespace),
  },

  // ── Services ────────────────────────────────────────────────────────────

  registry_api: kilnService('registry-api', $._config.ports.registry_api, 'registry-api', {
    cpu_request: '250m', memory_request: '256Mi',
    cpu_limit: '1000m', memory_limit: '512Mi',
  }),

  chat_backend: kilnService('chat-backend', $._config.ports.chat_backend, 'chat-backend', {
    cpu_request: '250m', memory_request: '256Mi',
    cpu_limit: '1000m', memory_limit: '512Mi',
  }),

  tool_executor: kilnService('tool-executor', $._config.ports.tool_executor, 'tool-executor', {
    cpu_request: '250m', memory_request: '256Mi',
    cpu_limit: '1000m', memory_limit: '512Mi',
  }),

  mcp_server: kilnService('mcp-server', $._config.ports.mcp_server, 'mcp-server', {
    cpu_request: '125m', memory_request: '128Mi',
    cpu_limit: '500m', memory_limit: '256Mi',
  }),

  synthesis_service: kilnService('synthesis-service', $._config.ports.synthesis_service, 'synthesis-service', {
    cpu_request: '500m', memory_request: '512Mi',
    cpu_limit: '2000m', memory_limit: '1Gi',
  }),

  // Registry UI — Next.js frontend
  registry_ui: kilnService('registry-ui', $._config.ports.registry_ui, 'registry-ui', {
    cpu_request: '125m', memory_request: '128Mi',
    cpu_limit: '500m', memory_limit: '256Mi',
  }),

  // ── Ingress (GKE Gateway API) ──────────────────────────────────────────
  // Routes external traffic to the right services.
  // chat.kiln.dev   → chat_backend
  // mcp.kiln.dev    → mcp_server
  // api.kiln.dev    → registry_api
  // kiln.dev        → registry_ui

  ingress:
    k.networking.v1.ingress.new('kiln-ingress')
    + k.networking.v1.ingress.metadata.withNamespace($._config.namespace)
    + k.networking.v1.ingress.metadata.withAnnotations({
      'kubernetes.io/ingress.class': 'gce',
    })
    + k.networking.v1.ingress.spec.withRules([
      {
        host: 'kiln.dev',
        http: { paths: [{
          path: '/',
          pathType: 'Prefix',
          backend: { service: { name: 'registry-ui', port: { number: $._config.ports.registry_ui } } },
        }] },
      },
      {
        host: 'api.kiln.dev',
        http: { paths: [{
          path: '/',
          pathType: 'Prefix',
          backend: { service: { name: 'registry-api', port: { number: $._config.ports.registry_api } } },
        }] },
      },
      {
        host: 'chat.kiln.dev',
        http: { paths: [{
          path: '/',
          pathType: 'Prefix',
          backend: { service: { name: 'chat-backend', port: { number: $._config.ports.chat_backend } } },
        }] },
      },
      {
        host: 'mcp.kiln.dev',
        http: { paths: [{
          path: '/',
          pathType: 'Prefix',
          backend: { service: { name: 'mcp-server', port: { number: $._config.ports.mcp_server } } },
        }] },
      },
    ]),
}
