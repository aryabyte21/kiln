# Babel — Project Plan

## What is Babel?

Babel is an open source, self-hostable tool registry for agentic systems. It ingests MCP servers, unifies their tools under a single discovery interface, and exposes them to any agent framework. Agents talk to one place — Babel handles routing, availability, credential proxying, and render component resolution underneath.

---

## Core Capabilities

### 1. MCP Server Ingestion

Babel connects to any MCP server and calls `tools/list` to pull the full tool manifest. Each tool is registered in Babel's registry with its name, description, and input schema. The executor for ingested tools is a thin proxy — Babel forwards calls to the originating MCP server and returns the result.

Multiple MCP servers can be ingested simultaneously. From the agent's perspective, all tools appear as a flat unified registry regardless of which MCP server they came from.

### 2. Unified Tool Registry

Every tool in Babel — whether ingested from MCP or registered directly — has a consistent registry entry:

- **Identity**: tool ID, namespace, version, tags
- **Schema**: input and output JSON Schema
- **Executor**: reference to execution logic (proxy for MCP tools, direct for native tools)
- **Availability**: current health status
- **Render**: optional compiled JS component for AG-UI frontends
- **Source**: which MCP server this tool belongs to, if applicable

### 3. AG-UI Render Registry

Babel optionally stores compiled render components alongside tool definitions. These are human-authored `.tsx` files that get compiled to JS bundles at registration time — Babel runs `esbuild` internally, so developers just point at the source file. The compiled bundle is stored in the registry and served to AG-UI frontends on demand.

The props contract between a tool's output schema and its render component is validated at registration time. Mismatches are rejected.

Tools without a registered render component fall back to a generic JSON or table view — nothing breaks silently.

### 4. Multi-User Tool Sharing (Team Scope)

Within a team deployment, users can publish their MCP servers to Babel, making those tools available to other team members. When a consuming user invokes a tool that requires credentials they haven't provided, Babel pauses the call and emits a credential request to their session. The user supplies the credential at runtime, and the call proceeds.

Credentials are scoped to the user's session — they are not persisted permanently and must be re-provided in new sessions.

---

## Multi-Tenancy & Credential Security

### The Problem

When User A publishes an MCP server and User B consumes those tools, User B's credentials must not be exposed to User A's server or infrastructure.

### Solution: Credential Proxy Model

Babel acts as an authenticated proxy for all tool calls. The flow is:

1. User B provides their credential to Babel at runtime
2. Babel stores the credential in User B's session context only
3. When a tool call is made to User A's MCP server, Babel makes the authenticated request on User B's behalf
4. User A's server receives the request from Babel — it never sees User B's credential

The trust boundary shifts from "do I trust User A's server" to "do I trust Babel." Within a team deployment, this is a reasonable and acceptable trust model.

### Credential Injection

Babel must support the common auth schemes used by MCP servers:

- Bearer token (Authorization header)
- API key (custom header or query param)
- Basic auth

The credential resolver is called at execution time, injects the appropriate header into the proxied request, and the credential never leaves Babel's process.

### Residual Risk

If User A's MCP server is instrumented to log or echo request metadata, Babel cannot prevent side-channel exposure. This is an accepted residual risk for team-internal deployments where adversarial behaviour between teammates is out of scope.

---

## Lifecycle Management

### Health Checks

Babel runs a periodic heartbeat against each ingested MCP server. On failure, affected tools are marked `unavailable` in the registry — their definitions are retained but they cannot be executed. Agents receive availability status alongside the tool list and can make routing decisions accordingly.

### Reconnection

When a server comes back online, Babel:

1. Re-runs `tools/list` and diffs against the cached manifest
2. Updates any schemas that have changed
3. Re-resolves credentials if required
4. Marks tools as `available` again

### Schema Drift

If an MCP server updates its tool schemas during downtime, Babel detects the drift on reconnection and updates the registry. If the output schema change breaks compatibility with a registered render component, Babel marks the render as `incompatible` and falls back to the generic renderer until the component is updated.

---

## Render Component Registration

**Developer workflow:**

```
babel register-render --tool elastic_query --component ./renders/ElasticResultsCard.tsx
```

Babel internally:

1. Accepts the `.tsx` source path
2. Runs `esbuild` in-process to compile to a self-contained JS bundle
3. Marks React and other shared dependencies as external
4. Validates that the compiled output exports a valid React component
5. Validates that the component's expected props are compatible with the tool's output schema
6. Stores the compiled bundle in the registry against the tool ID and version

**Constraints on authored components:**

- Cannot use arbitrary Node modules — only dependencies available in the frontend runtime
- React must be treated as external (not bundled in)
- Must accept props that conform to the tool's output JSON Schema

---

## Architecture Boundaries

| Layer | Owner | Description |
|---|---|---|
| Tool Synthesis | Vibe | Synthesizes executors and schemas for native Babel tools |
| MCP Ingestion | Babel | Connects to MCP servers, proxies tool calls |
| Registry | Babel | Stores tool definitions, schemas, compiled render bundles |
| Credential Proxy | Babel | Holds session credentials, injects into proxied requests |
| Render Components | Human-authored | `.tsx` files registered into Babel by developers |
| Agent Interface | ARIA / any framework | Talks only to Babel — unaware of underlying MCP servers |

---

## Open Questions

- **Tool visibility model** — currently all tools within a team deployment are visible to all members. If finer-grained access control is needed in future, a visibility layer (public / private / invite-only) can be added on top.
- **Credential persistence** — currently per-session only. Permanent encrypted storage per user is a future option if re-entry friction becomes a problem.
- **Output schema coverage** — MCP does not mandate structured output schemas. Babel needs a strategy for tools with loose or absent output schemas, particularly when render components depend on typed props.
- **Rate limiting** — when Babel proxies calls to User A's MCP server on behalf of User B, rate limits on User A's server apply. Babel should surface rate limit errors clearly rather than letting them fail silently.
