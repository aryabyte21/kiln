# End-to-End Real Execution + UI Overhaul Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a custom agent worker Docker image, wire it into the control plane, add a containers API endpoint, create multiple example swarms, and redesign the dashboard with dark theme + live pipeline execution + container monitoring + execution logs.

**Architecture:** A lightweight Go HTTP binary (`openswarm-agent`) reads SOUL.md as system prompt and proxies to Ollama's `/api/chat` endpoint. Pool spawns these as Docker containers. The dashboard gets a full dark-theme redesign with real-time pipeline visualization, container status, and streaming logs.

**Tech Stack:** Go 1.23 (agent worker + control plane), Docker multi-stage build, Ollama REST API, Next.js 15, React 19, Tailwind CSS dark mode, React Flow.

---

## Phase 1: Agent Worker Binary (Backend — Independent)

### Task 1: Build the Agent Worker Binary

**Files:**

- Create: `apps/agent-worker/main.go`
- Create: `apps/agent-worker/go.mod`

**Step 1: Create go module**

Run: `mkdir -p /Users/pinetortoise/Desktop/CS5224/apps/agent-worker && cd /Users/pinetortoise/Desktop/CS5224/apps/agent-worker && go mod init github.com/openswarm/agent-worker`

**Step 2: Write main.go**

Create `apps/agent-worker/main.go`:

```go
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

var (
	soulPrompt string
	ollamaURL  string
	modelName  string
	agentRole  string
	startTime  time.Time
	client     = &http.Client{Timeout: 120 * time.Second}
)

func main() {
	startTime = time.Now()
	agentRole = env("AGENT_ROLE", "agent")
	ollamaURL = env("OLLAMA_URL", "http://host.docker.internal:11434")
	modelName = env("MODEL_NAME", "qwen2.5:7b")
	port := env("PORT", "8080")

	// Read SOUL.md
	soulBytes, err := os.ReadFile("/workspace/SOUL.md")
	if err != nil {
		log.Printf("WARN: no SOUL.md found, using default system prompt: %v", err)
		soulPrompt = fmt.Sprintf("You are a %s agent. Complete tasks thoroughly and accurately.", agentRole)
	} else {
		soulPrompt = string(soulBytes)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", handleHealth)
	mux.HandleFunc("POST /v1/chat/completions", handleChat)

	log.Printf("agent-worker starting role=%s model=%s ollama=%s port=%s", agentRole, modelName, ollamaURL, port)
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatalf("server error: %v", err)
	}
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":  "ok",
		"role":    agentRole,
		"model":   modelName,
		"uptime":  time.Since(startTime).String(),
	})
}

// handleChat implements the OpenAI-compatible /v1/chat/completions endpoint.
// It prepends the SOUL.md system prompt and proxies to Ollama.
func handleChat(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Model    string              `json:"model"`
		Messages []map[string]string `json:"messages"`
		Stream   bool                `json:"stream"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request"}`, http.StatusBadRequest)
		return
	}

	// Build messages: system prompt + user messages
	messages := []map[string]string{
		{"role": "system", "content": soulPrompt},
	}
	messages = append(messages, req.Messages...)

	// Call Ollama /api/chat
	ollamaReq := map[string]interface{}{
		"model":    modelName,
		"messages": messages,
		"stream":   false,
	}
	body, _ := json.Marshal(ollamaReq)
	resp, err := client.Post(ollamaURL+"/api/chat", "application/json", bytes.NewReader(body))
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"ollama call failed: %s"}`, err), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		http.Error(w, fmt.Sprintf(`{"error":"ollama returned %d: %s"}`, resp.StatusCode, truncate(string(respBody), 200)), resp.StatusCode)
		return
	}

	// Parse Ollama response
	var ollamaResp struct {
		Message struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		} `json:"message"`
		TotalDuration  int64 `json:"total_duration"`
		PromptEvalCount int  `json:"prompt_eval_count"`
		EvalCount       int  `json:"eval_count"`
	}
	if err := json.Unmarshal(respBody, &ollamaResp); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"parse ollama response: %s"}`, err), http.StatusBadGateway)
		return
	}

	// Convert to OpenAI-compatible response format
	openaiResp := map[string]interface{}{
		"id":      fmt.Sprintf("osw-%d", time.Now().UnixNano()),
		"object":  "chat.completion",
		"created": time.Now().Unix(),
		"model":   modelName,
		"choices": []map[string]interface{}{
			{
				"index":         0,
				"message":       map[string]string{"role": "assistant", "content": ollamaResp.Message.Content},
				"finish_reason": "stop",
			},
		},
		"usage": map[string]int{
			"prompt_tokens":     ollamaResp.PromptEvalCount,
			"completion_tokens": ollamaResp.EvalCount,
			"total_tokens":      ollamaResp.PromptEvalCount + ollamaResp.EvalCount,
		},
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(openaiResp)
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func truncate(s string, n int) string {
	s = strings.ReplaceAll(s, "\n", " ")
	if len(s) > n {
		return s[:n] + "..."
	}
	return s
}
```

**Step 3: Verify it builds**

Run: `cd /Users/pinetortoise/Desktop/CS5224/apps/agent-worker && go build -o /tmp/agent-worker .`
Expected: SUCCESS

---

### Task 2: Build the Agent Worker Dockerfile

**Files:**

- Create: `Dockerfile.agent` (project root)

**Step 1: Write multi-stage Dockerfile**

Create `/Users/pinetortoise/Desktop/CS5224/Dockerfile.agent`:

```dockerfile
FROM golang:1.23-alpine AS builder
WORKDIR /build
COPY apps/agent-worker/go.mod ./
RUN go mod download
COPY apps/agent-worker/main.go ./
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /agent-worker .

FROM alpine:3.19
RUN apk add --no-cache ca-certificates curl
COPY --from=builder /agent-worker /usr/local/bin/agent-worker
RUN mkdir -p /workspace
EXPOSE 8080
CMD ["agent-worker"]
```

**Step 2: Build the Docker image**

Run: `cd /Users/pinetortoise/Desktop/CS5224 && docker build -t openswarm-agent:latest -f Dockerfile.agent .`
Expected: Image builds successfully

**Step 3: Quick smoke test**

Run: `docker run --rm -d --name test-agent -p 18899:8080 -e OLLAMA_URL=http://host.docker.internal:11434 -e MODEL_NAME=qwen2.5:7b -e AGENT_ROLE=tester openswarm-agent:latest && sleep 2 && curl -s http://localhost:18899/healthz && docker stop test-agent`
Expected: `{"model":"qwen2.5:7b","role":"tester","status":"ok","uptime":"..."}` and then container stops.

---

### Task 3: Update Pool.go for Agent Worker Image

**Files:**

- Modify: `apps/controlplane/internal/pool/pool.go`

**Changes:**

1. Default image: `openswarm-agent:latest` (not `openclawai/openclaw:latest`)
2. Container port: `8080/tcp` (not `18789/tcp`)
3. Environment: `OLLAMA_URL`, `MODEL_NAME`, `AGENT_ROLE`
4. Mount: `/workspace` (not `/root/.openclaw`)
5. Recovery: look for port `8080` (not `18789`)
6. Workspace: write `SOUL.md` only (drop `settings.json`, agent worker reads env vars)

**Step 1: Update defaults and Spawn method**

In `pool.go`, change the default image:

```go
// Line 52-53: change default
if cfg.OpenClawImage == "" {
    cfg.OpenClawImage = "openswarm-agent:latest"
}
```

In `Spawn()`, update the container config:

```go
containerPort := "8080/tcp"  // was "18789/tcp"

containerCfg := &container.Config{
    Image: p.cfg.OpenClawImage,
    Env: []string{
        fmt.Sprintf("OLLAMA_URL=%s", p.cfg.OllamaURL),
        fmt.Sprintf("MODEL_NAME=%s", p.cfg.Model),
        fmt.Sprintf("AGENT_ROLE=%s", role),
    },
    // ... rest stays same
}

hostCfg := &container.HostConfig{
    // ... port bindings stay same
    Binds: []string{
        fmt.Sprintf("%s:/workspace", workDir),  // was /root/.openclaw
    },
}
```

**Step 2: Simplify createWorkspace to just write SOUL.md**

Remove the `settings.json` generation (agent worker reads config from env vars). Keep only SOUL.md.

**Step 3: Update RecoverExisting to look for port 8080**

```go
if port.PrivatePort == 8080 {  // was 18789
```

**Step 4: Verify build + tests**

Run: `cd /Users/pinetortoise/Desktop/CS5224/apps/controlplane && go build ./... && go test ./internal/pool/ -v`
Expected: All pass

---

### Task 4: Add Containers API Endpoint

**Files:**

- Modify: `apps/controlplane/internal/api/server.go`
- Modify: `apps/controlplane/cmd/openswarm-controller/main.go`

**Step 1: Add pool reference to Server struct**

In `server.go`, add `pool` field:

```go
import "github.com/openswarm/openswarm/internal/pool"

type Server struct {
    // ... existing fields
    pool      *pool.Pool
}
```

Update `NewServer` to accept pool:

```go
func NewServer(cfg Config, st *store.Store, reg *registry.Registry, b *bus.Bus, hub *sse.Hub, bt *budget.Tracker, lm *lifecycle.Manager, ge *genetics.Engine, p *pool.Pool) *Server {
    return &Server{
        // ... existing fields
        pool: p,
    }
}
```

**Step 2: Add route + handler**

In `Router()`:

```go
mux.HandleFunc("GET /api/v1/swarms/{name}/containers", s.handleListContainers)
```

Handler:

```go
func (s *Server) handleListContainers(w http.ResponseWriter, r *http.Request) {
    name := r.PathValue("name")
    instances := s.pool.ListBySwarm(name)

    type containerInfo struct {
        ID        string    `json:"id"`
        Role      string    `json:"role"`
        Addr      string    `json:"addr"`
        Port      int       `json:"port"`
        Healthy   bool      `json:"healthy"`
        CreatedAt time.Time `json:"createdAt"`
    }

    result := make([]containerInfo, 0, len(instances))
    for _, inst := range instances {
        healthy := s.pool.HealthCheck(r.Context(), inst)
        result = append(result, containerInfo{
            ID:        inst.ID,
            Role:      inst.Role,
            Addr:      inst.Addr,
            Port:      inst.Port,
            Healthy:   healthy,
            CreatedAt: inst.CreatedAt,
        })
    }
    writeJSON(w, http.StatusOK, result)
}
```

**Step 3: Update main.go to pass pool to NewServer**

In `main.go`, change the `api.NewServer` call to include `instancePool`.

**Step 4: Verify build**

Run: `cd /Users/pinetortoise/Desktop/CS5224/apps/controlplane && go build ./...`
Expected: SUCCESS

---

### Task 5: Create Example Swarms

**Files:**

- Create: `examples/hello-swarm/swarm.yaml`
- Create: `examples/code-review/swarm.yaml`
- Modify: `examples/news-pipeline/swarm.yaml` (already done, verify)

**Step 1: Create hello-swarm**

Create `examples/hello-swarm/swarm.yaml`:

```yaml
apiVersion: openswarm/v1alpha1
kind: Swarm
metadata:
  name: hello-swarm
  labels:
    env: demo

spec:
  budget:
    total: '$1.00'
    alertAt: 80
    hardStop: 100

  agents:
    - name: greeter
      replicas: { min: 1, max: 1 }
      model: qwen2.5:7b
      soul: |
        You are a friendly greeter agent. When given a topic or name,
        craft a warm, creative greeting or introduction about it.
        Be enthusiastic and personable.

    - name: formatter
      replicas: { min: 1, max: 1 }
      model: qwen2.5:7b
      soul: |
        You are a formatter agent. Take the greeting you receive and
        format it beautifully with markdown headers, bullet points,
        and emoji. Make it visually appealing.
      dependsOn: [greeter]

  topology:
    - from: greeter
      to: formatter
      subject: greeting.raw
```

**Step 2: Create code-review swarm**

Create `examples/code-review/swarm.yaml`:

```yaml
apiVersion: openswarm/v1alpha1
kind: Swarm
metadata:
  name: code-review
  labels:
    env: demo

spec:
  budget:
    total: '$1.00'
    alertAt: 80
    hardStop: 100

  agents:
    - name: analyzer
      replicas: { min: 1, max: 2 }
      model: qwen2.5:7b
      soul: |
        You are a code analyzer agent. Given a code description or snippet,
        identify potential bugs, performance issues, security concerns,
        and style violations. Be thorough and specific.

    - name: reviewer
      replicas: { min: 1, max: 1 }
      model: qwen2.5:7b
      soul: |
        You are a code reviewer agent. Given an analysis of code issues,
        prioritize them by severity (critical/major/minor), add
        recommendations for fixes, and suggest best practices.
      dependsOn: [analyzer]

    - name: reporter
      replicas: { min: 1, max: 1 }
      model: qwen2.5:7b
      soul: |
        You are a report writer agent. Given prioritized code review findings,
        format them into a clean, professional code review report with
        sections, severity badges, and actionable next steps.
      dependsOn: [reviewer]

  topology:
    - from: analyzer
      to: reviewer
      subject: analysis.raw
    - from: reviewer
      to: reporter
      subject: review.complete
```

---

## Phase 2: Dashboard Overhaul (Frontend — Independent of Phase 1)

### Task 6: Dark Theme + Layout Restructure

**Files:**

- Modify: `apps/web/tailwind.config.ts` — enable dark mode class strategy
- Modify: `apps/web/app/globals.css` — dark-first color scheme
- Modify: `apps/web/app/layout.tsx` — add `dark` class to `<html>`
- Modify: `apps/web/app/dashboard/layout.tsx` — restructure layout

**Step 1: Update Tailwind config for dark mode**

In `tailwind.config.ts`, ensure `darkMode: "class"` is set.

**Step 2: Update globals.css with dark theme variables**

Replace the `:root` CSS variables with dark-first values:

- Background: slate-950 (`#020617`)
- Foreground: slate-50
- Card: slate-900
- Primary: cyan-400
- Accent: emerald-400
- Destructive: red-400
- Muted: slate-800

**Step 3: Add `dark` class to html element**

In `app/layout.tsx`, add `className="dark"` to the `<html>` tag.

**Step 4: Restructure dashboard layout**

Update `app/dashboard/layout.tsx` to use a proper sidebar + main area layout.

**Step 5: Verify the dashboard renders**

Run: `cd /Users/pinetortoise/Desktop/CS5224/apps/web && pnpm dev`
Expected: Dashboard loads with dark theme, no errors in console.

---

### Task 7: Live Pipeline Execution View

**Files:**

- Modify: `apps/web/src/components/dashboard/agent-node.tsx` — add execution state animations
- Modify: `apps/web/src/components/dashboard/swarm-graph.tsx` — handle task SSE events
- Modify: `apps/web/src/hooks/use-sse.ts` — expose task execution state per agent

**Step 1: Update agent-node.tsx with execution states**

Add visual states to the agent node:

- **idle**: subtle border, dim
- **running**: green glow ring + pulse animation + "Processing..." label
- **completed**: green check badge, token count
- **failed**: red ring + error icon

Pass `executionState` as a prop via React Flow node data.

**Step 2: Update swarm-graph.tsx to pass execution state**

Track which agents are currently executing (from SSE `task_running` and `task_completed` events).
Map `agentRole → executionState` and pass as node data.

**Step 3: Enhance SSE hook to track per-agent execution state**

In `use-sse.ts`, add a `tasksByRole` map that tracks the latest task status per agent role.
Expose `agentStates: Map<role, 'idle' | 'running' | 'completed' | 'failed'>`.

---

### Task 8: Container Monitoring Tab

**Files:**

- Create: `apps/web/src/components/dashboard/container-list.tsx`
- Modify: `apps/web/app/dashboard/page.tsx` — add "Containers" tab
- Modify: `apps/web/src/lib/api-client.ts` — add `listContainers` function

**Step 1: Add API client function**

In `api-client.ts`:

```typescript
export interface Container {
  id: string;
  role: string;
  addr: string;
  port: number;
  healthy: boolean;
  createdAt: string;
}

export const listContainers = (swarm: string) =>
  apiFetch<Container[]>(`/api/v1/swarms/${swarm}/containers`);
```

**Step 2: Create ContainerList component**

Create `container-list.tsx` showing a table with:

- Container ID (truncated)
- Role
- Address (host:port)
- Health indicator (green/red dot)
- Uptime (computed from createdAt)
- Auto-refresh every 5 seconds

**Step 3: Add to dashboard**

In `page.tsx`, add a "Containers" tab between "Agents" and "Topology".

---

### Task 9: Execution Log Panel

**Files:**

- Create: `apps/web/src/components/dashboard/execution-log.tsx`
- Modify: `apps/web/app/dashboard/page.tsx` — add "Logs" tab

**Step 1: Create ExecutionLog component**

A terminal-style log viewer that displays SSE events as they arrive:

```
[14:32:01] SUBMIT  task-abc → fetcher | "Tell me about AI regulation"
[14:32:01] ASSIGN  task-abc → fetcher/agent-x1a2
[14:32:02] RUN     task-abc → fetcher/agent-x1a2 | Processing...
[14:32:05] DONE    task-abc → fetcher/agent-x1a2 | 150 tokens, $0.0002, 3.2s
[14:32:05] PIPE    fetcher → summarizer | articles.raw
[14:32:06] SUBMIT  task-def → summarizer | [output from fetcher]
```

Style: dark background (slate-950), monospace font, color-coded by event type.

**Step 2: Add to dashboard as "Logs" tab**

---

## Phase 3: Integration (After Phase 1 + 2)

### Task 10: End-to-End Smoke Test

**Step 1: Ensure infrastructure is running**

```bash
cd /Users/pinetortoise/Desktop/CS5224
docker compose up -d postgres redis nats ollama
sleep 15
```

**Step 2: Pull model (if not already done)**

```bash
docker compose exec ollama ollama pull qwen2.5:7b
```

**Step 3: Build agent worker image**

```bash
docker build -t openswarm-agent:latest -f Dockerfile.agent .
```

**Step 4: Start control plane**

```bash
cd apps/controlplane
go run ./cmd/openswarm-controller
```

**Step 5: Apply hello-swarm**

```bash
cd apps/controlplane
go run ./cmd/openswarm apply ../../examples/hello-swarm/swarm.yaml
```

Expected: 2 containers spawn (visible in `docker ps --filter label=managed-by=openswarm`).

**Step 6: Submit a task**

```bash
go run ./cmd/openswarm tasks hello-swarm submit "Tell me about cloud computing"
```

Expected: Real LLM output (not mock), real token count, pipeline triggers from greeter → formatter.

**Step 7: Open dashboard and verify**

```bash
cd apps/web && pnpm dev
# Open http://localhost:3000/dashboard
```

Expected: Dark theme, live agents visible, submit task from UI, see pipeline execution in real-time.

---

## Success Criteria

1. `docker ps` shows real `openswarm-agent` containers after `apply`
2. Task submission returns real LLM-generated text (not mock)
3. Pipeline flows: output of agent A becomes input of agent B
4. Dashboard shows dark theme with live pipeline execution
5. Container monitoring tab shows real Docker containers with health
6. Execution log shows real-time event stream
7. Works with hello-swarm, news-pipeline, and code-review examples
8. Kill a container → lifecycle manager detects + replaces within 10s

## Task Dependencies

```
Phase 1 (Backend):        Phase 2 (Frontend):
Task 1 → Task 2 → Task 3   Task 6 (dark theme)
                  ↓          Task 7 (pipeline view)
                Task 4       Task 8 (containers)
                Task 5       Task 9 (logs)
                  ↓               ↓
              Phase 3: Task 10 (integration)
```

**Phase 1 and Phase 2 can run in PARALLEL.**
