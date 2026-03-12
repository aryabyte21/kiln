# Babel — Vision & Product Plan

## What is Babel?

Babel is an open source, self-hostable tool runtime and registry for agentic systems. It ingests MCP servers, manages their full lifecycle, unifies their tools under a single discovery interface, and exposes them to any agent framework. Agents talk to one place — Babel handles routing, availability, credential proxying, dynamic spin-up, and render component resolution underneath.

Babel is infrastructure. It is not an assistant, not an agent framework, and not a product on its own. It is the layer that makes agent products possible.

---

## Core Architecture

### 1. MCP Server Ingestion & Lifecycle Management

Babel connects to any MCP server and calls `tools/list` to pull the full tool manifest. Rather than proxying to an externally managed process, Babel ingests the MCP server's source or package and owns its full lifecycle — spinning it up as a managed subprocess, monitoring it, restarting it on failure, and tearing it down when no longer needed.

From the agent's perspective, all tools appear as a flat unified registry regardless of which MCP server they originate from.

**Lifecycle guarantees:**
- Babel starts and owns the process — no external dependency on the server being "already running"
- Periodic health checks detect failures; affected tools are marked `unavailable` without losing their definitions
- On reconnection, Babel re-runs `tools/list`, diffs against cached manifests, and updates schemas that have changed
- If an MCP server's output schema changes and breaks a registered render component, Babel marks the render as `incompatible` and falls back to generic rendering

### 2. Unified Tool Registry

Every tool in Babel has a consistent registry entry regardless of origin:

- **Identity** — tool ID, namespace, version, tags
- **Schema** — input and output JSON Schema
- **Executor** — proxy reference for ingested MCP tools; direct reference for native Babel tools
- **Availability** — current health status
- **Render** — optional compiled JS component for AG-UI frontends
- **Source** — originating MCP server, version, and ingestion timestamp

### 3. Dynamic MCP Spin-Up (ARIA Integration)

When an agent's planning layer (ARIA) determines that a task requires capabilities not currently in the registry, Babel can suggest and spin up the appropriate MCP server on demand. The user is prompted once to confirm and provide any required credentials. Once running, the new MCP's tools are immediately available in the registry for the current and future sessions.

This makes adding new capabilities as simple as adding a new set of tools — the agent grows what it can do at runtime, not just at configuration time.

### 4. Credential Proxy Model

Babel acts as an authenticated proxy for all tool calls. Credentials are provided by the user at runtime, stored only in session scope, and injected by Babel into outbound requests. The underlying MCP server never receives the user's credential directly — it receives authenticated requests from Babel.

Supported auth schemes: Bearer token, API key (header or query param), Basic auth.

Credentials are scoped per-session by default. Permanent encrypted storage per user is a planned future option.

### 5. AG-UI Render Registry

Babel optionally stores compiled render components alongside tool definitions. Developers author `.tsx` files and register them against a tool ID. Babel runs `esbuild` internally at registration time — the developer points at the source file, Babel handles compilation and stores the JS bundle. No separate build step required.

The props contract between a tool's output schema and its render component is validated at registration time. Mismatches are rejected. Tools without a registered render component fall back to a generic JSON or table renderer.

---

## Future Product Directions

Babel as infrastructure enables a set of distinct products that can be built on top of it. Each of the following is a viable standalone product with Babel as its foundation.

---

### Product 1: Agent App Store

**The idea:**
Babel becomes the backend for a public marketplace where developers publish MCP servers as installable agent "apps." Users browse a catalog, one-click install any server, and Babel spins it up automatically — no configuration, no manual setup.

**Why Babel enables this:**
Babel already manages MCP lifecycle and tool registration. Adding a catalog layer and an install flow on top is the natural extension. The dynamic spin-up capability means installation is instant and reversible.

**The pitch:**
What the App Store did for software distribution, Babel does for agent capabilities. Every new MCP server in the marketplace is a new thing your agent can do.

**Key challenges:**
- Trust and verification — published MCP servers need vetting before they can run on user machines
- Sandboxing — marketplace apps should run in isolation from each other
- Discovery — surfacing the right tools when ARIA needs them

---

### Product 2: Personal AI OS

**The idea:**
A single AI layer that knows everything your local machine can do — files, browser, calendar, GitHub, Slack, terminal, notes, email — because Babel has ingested all relevant MCPs and unified them. Any agent you run talks to Babel and gets a complete picture of your environment.

**Why Babel enables this:**
The unified registry is the entire product here. The user doesn't manage individual MCPs — they manage one thing (Babel) and it handles everything underneath. ARIA's ability to suggest and spin up new MCPs means the system grows as your toolset grows.

**The pitch:**
Your AI finally knows your whole setup, not just the slice you explicitly wired up.

**Key challenges:**
- Permissions and privacy — the agent having access to everything requires careful consent design
- Performance — many MCP servers running simultaneously needs efficient resource management
- Onboarding — getting the initial set of MCPs configured should feel effortless

---

### Product 3: No-Code Agent Builder

**The idea:**
A visual interface where non-technical users compose agents by picking tools from Babel's registry. ARIA handles the planning layer, Babel handles tool availability, and the user simply describes what they want the agent to do. The agent is the product — Babel is entirely invisible underneath.

**Why Babel enables this:**
The registry gives the builder a clean, enumerable set of capabilities to present in a UI. Tool schemas give the builder enough information to render configuration forms automatically. The render component registry means tool outputs can be displayed beautifully without custom UI work per tool.

**The pitch:**
Build an agent that does your job without writing a single line of code.

**Key challenges:**
- Schema-to-UI translation — converting input schemas to usable configuration forms automatically
- Agent testing — non-technical users need ways to verify their agent works before deploying it
- Error handling — failures need to surface in plain language, not stack traces

---

### Product 4: Enterprise Tool Governance Platform

**The idea:**
For organisations running multiple internal tools and APIs, Babel becomes the control plane where IT and security teams decide which MCP servers are approved, which teams can access which tools, and what every tool call produces — with full audit logs.

**Why Babel enables this:**
Babel already sits in the middle of every tool call. Adding policy enforcement, access control lists, and audit logging to the existing proxy model is a natural extension. The registry's tool metadata gives governance teams a clear inventory of what agents can do.

**The pitch:**
The enterprise problem of "which AI can access what, and can we prove it" — solved at the infrastructure level rather than per-agent.

**Key challenges:**
- Policy language — defining access rules in a way that's expressive but manageable
- Integration with existing identity systems — SSO, LDAP, RBAC need to be first-class
- Audit log integrity — logs need to be tamper-evident for compliance use cases

---

### Product 5: AI DevOps Copilot

**The idea:**
Babel ingests your entire DevOps toolchain — GitHub, Jira, PagerDuty, Datadog, AWS, Kubernetes MCPs — and an agent can act across your whole stack in a single conversation. New tools in your stack get added to the agent automatically as new MCPs are spun up.

**Why Babel enables this:**
The dynamic spin-up capability means the copilot grows with your stack. As your team adopts new tools, they register the corresponding MCP with Babel and the agent immediately gains those capabilities. No rewiring, no prompt updates.

**The pitch:**
"Deploy this PR, watch for errors, and rollback if latency spikes" — one instruction, executed across your entire stack.

**Key challenges:**
- Safety and confirmation — destructive actions (deploys, rollbacks, resource deletion) need explicit human confirmation gates
- Context across tools — correlating events across Datadog, GitHub, and Kubernetes requires the agent to maintain coherent state
- Team-level access — different engineers should have different tool permissions within the same Babel instance

---

## What Makes Babel Defensible

Each of the above products could theoretically be built without Babel. The reason Babel matters is that it makes all of them easier to build and better to use:

- **Unified lifecycle** means product builders don't solve MCP management themselves
- **Tool registry** means capabilities are enumerable, typed, and discoverable — not hardcoded
- **Credential proxy** means security is solved once, not per-product
- **Dynamic spin-up** means products can grow their capabilities without redeployment
- **Render registry** means tool outputs have native UI without per-tool frontend work

The more products are built on Babel, the more the registry grows, and the more valuable Babel becomes as a shared layer. That's the compounding dynamic worth building toward.

---

## Open Questions

- **Sandboxing model** — for marketplace and multi-user scenarios, MCP servers need process isolation. Docker per-server is the safe default but has resource overhead.
- **Registry federation** — should multiple Babel instances be able to share tool registries, or does each instance own its registry entirely?
- **Output schema coverage** — MCP does not mandate structured output schemas. Babel needs a strategy for tools with loose or absent output schemas, especially for render component compatibility.
- **Rate limiting** — when Babel proxies calls, rate limits on the underlying service apply. These need to surface clearly rather than failing silently.
- **Tool versioning across products** — if multiple products share a Babel registry and a tool's schema changes, coordinating compatibility across all consumers is non-trivial.
