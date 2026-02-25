# Dashboard Controls & Audit Panel Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add ArgoCD-style swarm lifecycle controls, agent detail drawer, audit trail panel, and sync status to the OpenSwarm dashboard.

**Architecture:** Backend adds 3 new API endpoints (stop/start/sync-status). Frontend adds 5 new components: swarm command bar, sync status badge, agent detail drawer, audit panel, scale dialog. All connected via existing SSE real-time updates.

**Tech Stack:** Go 1.23 (net/http), Next.js 15, React 19, React Flow, shadcn/ui components, TypeScript strict mode.

---

### Task 1: Backend — Add swarm stop/start/status endpoints

**Files:**

- Modify: `apps/controlplane/internal/api/server.go`

**Step 1: Add route registrations**

In the `Router()` method, after the existing swarm routes (line ~87), add:

```go
// Swarm lifecycle controls
mux.HandleFunc("POST /api/v1/swarms/{name}/stop", s.handleStopSwarm)
mux.HandleFunc("POST /api/v1/swarms/{name}/start", s.handleStartSwarm)
mux.HandleFunc("GET /api/v1/swarms/{name}/sync-status", s.handleSyncStatus)
```

**Step 2: Implement handleStopSwarm**

Add after `handleDeleteSwarm` (around line 296):

```go
// handleStopSwarm gracefully stops a swarm: terminates containers, deregisters
// agents, sets status to "stopped", but keeps the DB record so it can be restarted.
func (s *Server) handleStopSwarm(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")

	sw, err := s.store.GetSwarmByName(r.Context(), name)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "swarm not found"})
		return
	}

	if sw.Status == string(domain.SwarmStatusStopped) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "already stopped", "name": name})
		return
	}

	// Stop the NATS bridge
	s.stopBridge(name)

	// Terminate all Docker containers
	instances := s.pool.ListBySwarm(name)
	terminated := 0
	for _, inst := range instances {
		_ = s.registry.Deregister(r.Context(), name, inst.ID)
		if err := s.pool.Terminate(r.Context(), inst.ID); err != nil {
			slog.Warn("stop swarm: terminate container", "id", inst.ID, "error", err)
		} else {
			terminated++
		}
	}

	// Update swarm status to stopped
	if err := s.store.UpdateSwarmStatus(r.Context(), name, domain.SwarmStatusStopped); err != nil {
		slog.Error("stop swarm: update status", "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	// Audit event
	s.audit.Log(domain.AuditEvent{
		SwarmName: name,
		Action:    domain.AuditSwarmDeleted, // reuse "stopped" semantics
		Metadata:  audit.Meta("action", "stop", "containersTerminated", fmt.Sprintf("%d", terminated)),
	})

	// Broadcast SSE
	s.hub.Broadcast(name, sse.Event{
		Type: "swarm_stopped",
		Data: map[string]string{"name": name, "containersTerminated": fmt.Sprintf("%d", terminated)},
	})

	slog.Info("swarm stopped", "name", name, "containersTerminated", terminated)
	writeJSON(w, http.StatusOK, map[string]string{"status": "stopped", "name": name, "containersTerminated": fmt.Sprintf("%d", terminated)})
}
```

**Step 3: Implement handleStartSwarm**

```go
// handleStartSwarm re-starts a stopped swarm by re-applying its existing spec.
func (s *Server) handleStartSwarm(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")

	sw, err := s.store.GetSwarmByName(r.Context(), name)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "swarm not found"})
		return
	}

	if sw.Status == string(domain.SwarmStatusRunning) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "already running", "name": name})
		return
	}

	// Re-initialize budget
	if err := s.budget.InitBudget(r.Context(), sw.Name,
		sw.Spec.Budget.Total, sw.Spec.Budget.AlertAt, sw.Spec.Budget.HardStop); err != nil {
		slog.Error("start swarm: init budget", "error", err)
	}

	// Resolve agent configs and reconcile
	resolvedSpec := sw.Spec
	resolvedSpec.Agents = config.ResolveAllAgents(sw.Spec)

	if err := s.lifecycle.RegisterSwarmAgents(r.Context(), sw.Name, resolvedSpec); err != nil {
		slog.Error("start swarm: register agents", "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	// Re-start NATS bridge
	s.startBridge(r.Context(), sw.Name, resolvedSpec)

	// Broadcast SSE
	s.hub.Broadcast(sw.Name, sse.Event{
		Type: "swarm_started",
		Data: sw,
	})

	// Audit
	s.audit.Log(domain.AuditEvent{
		SwarmName: name,
		Action:    domain.AuditSwarmCreated, // reuse "started" semantics
		Metadata:  audit.Meta("action", "start"),
	})

	slog.Info("swarm started", "name", name)
	writeJSON(w, http.StatusOK, map[string]string{"status": "running", "name": name})
}
```

**Step 4: Implement handleSyncStatus**

```go
// handleSyncStatus returns the sync status of a swarm (desired vs actual state).
func (s *Server) handleSyncStatus(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")

	sw, err := s.store.GetSwarmByName(r.Context(), name)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "swarm not found"})
		return
	}

	type roleStatus struct {
		Role     string `json:"role"`
		Desired  int    `json:"desired"`
		Actual   int    `json:"actual"`
		Healthy  int    `json:"healthy"`
	}

	roles := make([]roleStatus, 0, len(sw.Spec.Agents))
	totalDesired := 0
	totalActual := 0
	totalHealthy := 0

	for _, agentSpec := range sw.Spec.Agents {
		desired := int(agentSpec.Replicas.Min)
		if desired < 1 {
			desired = 1
		}
		actual := s.pool.CountByRole(name, agentSpec.Name)

		// Count healthy instances
		healthy := 0
		instances := s.pool.ListByRole(name, agentSpec.Name)
		for _, inst := range instances {
			if s.pool.HealthCheck(r.Context(), inst) {
				healthy++
			}
		}

		roles = append(roles, roleStatus{
			Role:    agentSpec.Name,
			Desired: desired,
			Actual:  actual,
			Healthy: healthy,
		})
		totalDesired += desired
		totalActual += actual
		totalHealthy += healthy
	}

	// Determine sync status
	syncStatus := "synced"
	if sw.Status == string(domain.SwarmStatusStopped) {
		syncStatus = "stopped"
	} else if totalActual == 0 && totalDesired > 0 {
		syncStatus = "stopped"
	} else if totalHealthy < totalDesired {
		if totalActual >= totalDesired {
			syncStatus = "degraded" // right count but some unhealthy
		} else {
			syncStatus = "out-of-sync" // wrong count
		}
	} else if totalActual > totalDesired {
		syncStatus = "out-of-sync"
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"swarmName":    name,
		"swarmStatus":  sw.Status,
		"syncStatus":   syncStatus,
		"totalDesired": totalDesired,
		"totalActual":  totalActual,
		"totalHealthy": totalHealthy,
		"roles":        roles,
	})
}
```

**Step 5: Implement handleScaleAgent (replace the stub)**

Replace the existing `handleScaleAgent` stub (line 461-463) with:

```go
func (s *Server) handleScaleAgent(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	role := r.PathValue("role")

	var req struct {
		Replicas int `json:"replicas"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
		return
	}
	if req.Replicas < 0 || req.Replicas > 10 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "replicas must be 0-10"})
		return
	}

	sw, err := s.store.GetSwarmByName(r.Context(), name)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "swarm not found"})
		return
	}

	// Find the agent spec and adjust desired replicas
	found := false
	for i, a := range sw.Spec.Agents {
		if a.Name == role {
			sw.Spec.Agents[i].Replicas.Min = int32(req.Replicas)
			sw.Spec.Agents[i].Replicas.Max = int32(req.Replicas)
			found = true
			break
		}
	}
	if !found {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": fmt.Sprintf("role %q not found", role)})
		return
	}

	// Persist updated spec
	if err := s.store.UpdateSwarmSpec(r.Context(), name, sw.Spec); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	// Reconcile immediately
	resolvedSpec := sw.Spec
	resolvedSpec.Agents = config.ResolveAllAgents(sw.Spec)
	if err := s.lifecycle.Reconcile(r.Context(), name, resolvedSpec); err != nil {
		slog.Error("scale: reconcile", "error", err)
	}

	actual := s.pool.CountByRole(name, role)
	slog.Info("scaled agent", "swarm", name, "role", role, "replicas", req.Replicas, "actual", actual)
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status":   "scaled",
		"role":     role,
		"desired":  req.Replicas,
		"actual":   actual,
	})
}
```

**Step 6: Add store.UpdateSwarmSpec method if missing**

Check `apps/controlplane/internal/store/store.go` for `UpdateSwarmSpec`. If missing, add:

```go
func (s *Store) UpdateSwarmSpec(ctx context.Context, name string, spec domain.SwarmSpec) error {
	specJSON, err := json.Marshal(spec)
	if err != nil {
		return fmt.Errorf("marshal spec: %w", err)
	}
	_, err = s.pool.Exec(ctx,
		`UPDATE swarms SET spec = $1, updated_at = now() WHERE name = $2`,
		specJSON, name)
	return err
}
```

**Step 7: Verify compilation**

Run: `cd apps/controlplane && go vet ./...`
Expected: no errors

**Step 8: Commit**

```
feat: add swarm stop/start/sync-status/scale endpoints
```

---

### Task 2: Frontend — API client additions

**Files:**

- Modify: `apps/web/src/lib/api-client.ts`

**Step 1: Add new API functions and types**

Append to the api-client file:

```typescript
// ---------------------------------------------------------------------------
// Swarm Lifecycle Controls
// ---------------------------------------------------------------------------

export interface SyncStatusRole {
  role: string;
  desired: number;
  actual: number;
  healthy: number;
}

export interface SyncStatus {
  swarmName: string;
  swarmStatus: string;
  syncStatus: 'synced' | 'out-of-sync' | 'degraded' | 'stopped';
  totalDesired: number;
  totalActual: number;
  totalHealthy: number;
  roles: SyncStatusRole[];
}

export const stopSwarm = (name: string) =>
  apiFetch<{ status: string }>(`/api/v1/swarms/${name}/stop`, { method: 'POST' });

export const startSwarm = (name: string) =>
  apiFetch<{ status: string }>(`/api/v1/swarms/${name}/start`, { method: 'POST' });

export const deleteSwarm = (name: string) =>
  apiFetch<{ status: string }>(`/api/v1/swarms/${name}`, { method: 'DELETE' });

export const getSyncStatus = (name: string) =>
  apiFetch<SyncStatus>(`/api/v1/swarms/${name}/sync-status`);

export const scaleAgent = (swarm: string, role: string, replicas: number) =>
  apiFetch<{ status: string; actual: number }>(`/api/v1/swarms/${swarm}/agents/${role}/scale`, {
    method: 'POST',
    body: JSON.stringify({ replicas }),
  });

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export interface AuditEvent {
  time: string;
  swarmName: string;
  agentId: string;
  taskId: string;
  action: string;
  tokensUsed: number;
  costUsd: number;
  inputHash: string;
  outputHash: string;
  prevHash: string;
  eventHash: string;
  metadata: Record<string, string>;
}

export interface AuditChainResult {
  agentId: string;
  valid: boolean;
  eventCount: number;
  firstEvent: string;
  lastEvent: string;
  brokenAt: number;
}

export const getAuditEvents = (swarm: string, limit?: number) =>
  apiFetch<AuditEvent[]>(`/api/v1/swarms/${swarm}/audit${limit ? `?limit=${limit}` : ''}`);

export const verifyAuditChain = (swarm: string) =>
  apiFetch<Record<string, AuditChainResult>>(`/api/v1/swarms/${swarm}/audit/verify`);
```

**Step 2: Commit**

```
feat: add lifecycle and audit API client functions
```

---

### Task 3: Frontend — Sync Status Badge component

**Files:**

- Create: `apps/web/src/components/dashboard/sync-status-badge.tsx`

**Step 1: Create the component**

```tsx
'use client';

import { Badge } from '@/components/ui/badge';

interface SyncStatusBadgeProps {
  status: 'synced' | 'out-of-sync' | 'degraded' | 'stopped' | 'unknown';
  desired: number;
  actual: number;
}

const statusConfig: Record<string, { label: string; className: string }> = {
  synced: { label: 'Synced', className: 'bg-emerald-600 text-white' },
  'out-of-sync': { label: 'OutOfSync', className: 'bg-amber-600 text-white' },
  degraded: { label: 'Degraded', className: 'bg-red-600 text-white' },
  stopped: { label: 'Stopped', className: 'bg-zinc-600 text-zinc-300' },
  unknown: { label: 'Unknown', className: 'bg-zinc-700 text-zinc-400' },
};

export function SyncStatusBadge({ status, desired, actual }: SyncStatusBadgeProps) {
  const config = statusConfig[status] ?? statusConfig.unknown;

  return (
    <div className="flex items-center gap-2">
      <Badge className={config.className}>{config.label}</Badge>
      <span className="text-xs text-zinc-500">
        {actual}/{desired} agents
      </span>
    </div>
  );
}
```

**Step 2: Commit**

```
feat: add SyncStatusBadge component
```

---

### Task 4: Frontend — Swarm Command Bar component

**Files:**

- Create: `apps/web/src/components/dashboard/swarm-command-bar.tsx`

**Step 1: Create the component**

```tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Play, Square, RefreshCw, Trash2, Loader2 } from 'lucide-react';
import { SyncStatusBadge } from './sync-status-badge';
import {
  startSwarm,
  stopSwarm,
  deleteSwarm,
  getSyncStatus,
  type SyncStatus,
  type Swarm,
} from '@/lib/api-client';

interface SwarmCommandBarProps {
  swarm: Swarm;
  onSwarmChanged: () => void;
}

export function SwarmCommandBar({ swarm, onSwarmChanged }: SwarmCommandBarProps) {
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  const fetchSyncStatus = useCallback(async () => {
    try {
      const status = await getSyncStatus(swarm.name);
      setSyncStatus(status);
    } catch {
      // Swarm may not exist yet
    }
  }, [swarm.name]);

  // Poll sync status every 5 seconds
  useEffect(() => {
    fetchSyncStatus();
    const interval = setInterval(fetchSyncStatus, 5000);
    return () => clearInterval(interval);
  }, [fetchSyncStatus]);

  async function handleAction(action: string, fn: () => Promise<unknown>) {
    setActionInProgress(action);
    try {
      await fn();
      await fetchSyncStatus();
      onSwarmChanged();
    } catch (err) {
      console.error(`${action} failed:`, err);
    } finally {
      setActionInProgress(null);
    }
  }

  const isRunning = swarm.status === 'running';
  const isStopped = swarm.status === 'stopped' || swarm.status === 'pending';

  return (
    <div className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-3">
      {/* Left: swarm name + sync status */}
      <div className="flex items-center gap-4">
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">{swarm.name}</h2>
          <div className="mt-0.5">
            {syncStatus ? (
              <SyncStatusBadge
                status={syncStatus.syncStatus}
                desired={syncStatus.totalDesired}
                actual={syncStatus.totalActual}
              />
            ) : (
              <span className="text-xs text-zinc-600">Loading status...</span>
            )}
          </div>
        </div>

        {/* Desired vs actual */}
        {syncStatus && (
          <div className="hidden md:flex items-center gap-4 text-xs text-zinc-500 border-l border-zinc-800 pl-4">
            <span>
              Desired: <strong className="text-zinc-300">{syncStatus.totalDesired}</strong>
            </span>
            <span>
              Actual: <strong className="text-zinc-300">{syncStatus.totalActual}</strong>
            </span>
            <span>
              Healthy: <strong className="text-emerald-400">{syncStatus.totalHealthy}</strong>
            </span>
          </div>
        )}
      </div>

      {/* Right: action buttons */}
      <div className="flex items-center gap-2">
        {/* Start */}
        {isStopped && (
          <Button
            size="sm"
            onClick={() => handleAction('start', () => startSwarm(swarm.name))}
            disabled={actionInProgress !== null}
            className="bg-emerald-600 hover:bg-emerald-500 text-white"
          >
            {actionInProgress === 'start' ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5 mr-1.5" />
            )}
            Start
          </Button>
        )}

        {/* Stop */}
        {isRunning && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleAction('stop', () => stopSwarm(swarm.name))}
            disabled={actionInProgress !== null}
            className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
          >
            {actionInProgress === 'stop' ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <Square className="h-3.5 w-3.5 mr-1.5" />
            )}
            Stop
          </Button>
        )}

        {/* Sync (re-apply) */}
        <Button
          size="sm"
          variant="outline"
          onClick={() => handleAction('sync', () => startSwarm(swarm.name))}
          disabled={actionInProgress !== null}
          className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
        >
          {actionInProgress === 'sync' ? (
            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
          )}
          Sync
        </Button>

        {/* Delete */}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              disabled={actionInProgress !== null}
              className="border-red-900/50 text-red-400 hover:bg-red-950/30 hover:text-red-300"
            >
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              Delete
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent className="bg-zinc-900 border-zinc-800">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-zinc-100">
                Delete swarm &ldquo;{swarm.name}&rdquo;?
              </AlertDialogTitle>
              <AlertDialogDescription className="text-zinc-400">
                This will terminate all containers, deregister all agents, and remove the swarm
                definition. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700">
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={() => handleAction('delete', () => deleteSwarm(swarm.name))}
                className="bg-red-600 hover:bg-red-500 text-white"
              >
                Delete Swarm
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```
feat: add SwarmCommandBar with start/stop/sync/delete controls
```

---

### Task 5: Frontend — Audit Panel component

**Files:**

- Create: `apps/web/src/components/dashboard/audit-panel.tsx`

**Step 1: Create the component**

```tsx
'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ShieldCheck, RefreshCw, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import {
  getAuditEvents,
  verifyAuditChain,
  type AuditEvent,
  type AuditChainResult,
} from '@/lib/api-client';

interface AuditPanelProps {
  swarmName: string;
}

const ACTION_COLORS: Record<string, string> = {
  task_started: 'text-amber-400',
  task_completed: 'text-emerald-400',
  task_failed: 'text-red-400',
  tool_call: 'text-cyan-400',
  policy_violation: 'text-red-500',
  swarm_created: 'text-blue-400',
  swarm_deleted: 'text-zinc-400',
  pipeline_message: 'text-purple-400',
};

export function AuditPanel({ swarmName }: AuditPanelProps) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [chainResults, setChainResults] = useState<Record<string, AuditChainResult> | null>(null);
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [actionFilter, setActionFilter] = useState<string>('all');

  const fetchEvents = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getAuditEvents(swarmName, 100);
      setEvents(data ?? []);
    } catch {
      // May have no events
    } finally {
      setLoading(false);
    }
  }, [swarmName]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  async function handleVerify() {
    setVerifying(true);
    try {
      const results = await verifyAuditChain(swarmName);
      setChainResults(results);
    } catch {
      setChainResults(null);
    } finally {
      setVerifying(false);
    }
  }

  const filteredEvents =
    actionFilter === 'all' ? events : events.filter((e) => e.action === actionFilter);

  const uniqueActions = Array.from(new Set(events.map((e) => e.action))).sort();

  // Chain verification summary
  const chainSummary = chainResults
    ? {
        total: Object.keys(chainResults).length,
        valid: Object.values(chainResults).filter((r) => r.valid).length,
      }
    : null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-400" />
              Audit Trail
            </CardTitle>
            <CardDescription>
              {events.length} event{events.length !== 1 ? 's' : ''} recorded
              {chainSummary && (
                <span className="ml-2">
                  · Chain:{' '}
                  {chainSummary.valid === chainSummary.total ? (
                    <span className="text-emerald-400">
                      <CheckCircle2 className="h-3 w-3 inline mr-0.5" />
                      Verified ({chainSummary.total} agents)
                    </span>
                  ) : (
                    <span className="text-red-400">
                      <XCircle className="h-3 w-3 inline mr-0.5" />
                      {chainSummary.valid}/{chainSummary.total} valid
                    </span>
                  )}
                </span>
              )}
            </CardDescription>
          </div>

          <div className="flex items-center gap-2">
            <Select value={actionFilter} onValueChange={setActionFilter}>
              <SelectTrigger className="h-8 w-[160px] bg-zinc-800 border-zinc-700 text-xs">
                <SelectValue placeholder="Filter actions" />
              </SelectTrigger>
              <SelectContent className="bg-zinc-800 border-zinc-700">
                <SelectItem value="all" className="text-zinc-100 text-xs">
                  All actions
                </SelectItem>
                {uniqueActions.map((action) => (
                  <SelectItem key={action} value={action} className="text-zinc-100 text-xs">
                    {action}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              size="sm"
              variant="outline"
              onClick={handleVerify}
              disabled={verifying}
              className="border-zinc-700 text-zinc-300 h-8 text-xs"
            >
              {verifying ? (
                <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
              ) : (
                <ShieldCheck className="h-3 w-3 mr-1.5" />
              )}
              Verify Chain
            </Button>

            <Button
              size="sm"
              variant="outline"
              onClick={fetchEvents}
              disabled={loading}
              className="border-zinc-700 text-zinc-300 h-8 text-xs"
            >
              <RefreshCw className={`h-3 w-3 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="bg-slate-950 rounded-b-lg font-mono text-xs leading-relaxed max-h-[500px] overflow-y-auto">
          {filteredEvents.length === 0 ? (
            <div className="text-zinc-600 text-center py-8">
              {loading ? 'Loading audit events...' : 'No audit events recorded yet.'}
            </div>
          ) : (
            filteredEvents.map((event, i) => (
              <div
                key={`${event.time}-${i}`}
                className="whitespace-nowrap hover:bg-zinc-900/50 px-4 py-1 border-b border-zinc-900/50"
              >
                <span className="text-zinc-600">
                  [{new Date(event.time).toLocaleTimeString('en-US', { hour12: false })}]
                </span>{' '}
                <span
                  className={`font-bold inline-block w-20 ${ACTION_COLORS[event.action] ?? 'text-zinc-500'}`}
                >
                  {event.action.toUpperCase().slice(0, 14)}
                </span>{' '}
                <span className="text-zinc-500 inline-block w-24">
                  {event.agentId ? event.agentId.slice(0, 12) : '\u2014'}
                </span>{' '}
                <span className="text-zinc-400">
                  {event.taskId ? `task:${event.taskId.slice(0, 8)}` : ''}
                  {event.tokensUsed > 0 ? ` ${event.tokensUsed} tok` : ''}
                  {event.costUsd > 0 ? ` $${event.costUsd.toFixed(4)}` : ''}
                  {event.metadata
                    ? Object.entries(event.metadata)
                        .slice(0, 3)
                        .map(([k, v]) => ` ${k}=${String(v).slice(0, 20)}`)
                        .join('')
                    : ''}
                </span>{' '}
                <span className="text-zinc-700" title={event.eventHash}>
                  #{event.eventHash?.slice(0, 8)}
                </span>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
```

**Step 2: Commit**

```
feat: add AuditPanel component with chain verification
```

---

### Task 6: Frontend — Agent Detail Drawer component

**Files:**

- Create: `apps/web/src/components/dashboard/agent-detail-drawer.tsx`

**Step 1: Create the component**

```tsx
'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import type { AgentSpec } from '@/lib/api-client';
import type { AgentExecutionState } from '@/hooks/use-sse';

interface AgentDetailDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentSpec: AgentSpec | null;
  executionState: AgentExecutionState;
  swarmName: string;
}

const stateColors: Record<AgentExecutionState, string> = {
  idle: 'bg-zinc-600',
  running: 'bg-amber-500 animate-pulse',
  completed: 'bg-emerald-500',
  failed: 'bg-red-500',
};

export function AgentDetailDrawer({
  open,
  onOpenChange,
  agentSpec,
  executionState,
  swarmName,
}: AgentDetailDrawerProps) {
  if (!agentSpec) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="bg-zinc-950 border-zinc-800 w-[420px] sm:w-[480px] overflow-y-auto">
        <SheetHeader>
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${stateColors[executionState]}`} />
            <SheetTitle className="text-zinc-100 text-xl">{agentSpec.name}</SheetTitle>
          </div>
          <SheetDescription className="text-zinc-500">Agent role in {swarmName}</SheetDescription>
        </SheetHeader>

        <div className="space-y-6 mt-6">
          {/* Model */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-zinc-500 uppercase tracking-wide">
              Model
            </label>
            <div>
              <Badge variant="outline" className="text-sm">
                {agentSpec.model ?? 'inherited from defaults'}
              </Badge>
            </div>
          </div>

          {/* Replicas */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-zinc-500 uppercase tracking-wide">
              Replicas
            </label>
            <div className="text-zinc-300 text-sm">
              Min: {agentSpec.replicas.min} · Max: {agentSpec.replicas.max}
              {agentSpec.replicas.scaleOn && (
                <span className="text-zinc-500 ml-2">(scale on: {agentSpec.replicas.scaleOn})</span>
              )}
            </div>
          </div>

          <Separator className="bg-zinc-800" />

          {/* SOUL.md */}
          {agentSpec.soul && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-zinc-500 uppercase tracking-wide">
                Soul (Persona)
              </label>
              <div className="bg-zinc-900 rounded-md p-3 text-xs text-zinc-400 font-mono whitespace-pre-wrap max-h-[200px] overflow-y-auto">
                {agentSpec.soul}
              </div>
            </div>
          )}

          {/* Tools */}
          {agentSpec.tools && agentSpec.tools.length > 0 && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-zinc-500 uppercase tracking-wide">
                Tools
              </label>
              <div className="flex gap-1.5 flex-wrap">
                {agentSpec.tools.map((tool) => (
                  <Badge
                    key={tool}
                    variant="secondary"
                    className="bg-cyan-950/50 text-cyan-400 border-cyan-900/50 text-xs"
                  >
                    {tool}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Skills */}
          {agentSpec.skills && agentSpec.skills.length > 0 && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-zinc-500 uppercase tracking-wide">
                Skills (ClawHub)
              </label>
              <div className="flex gap-1.5 flex-wrap">
                {agentSpec.skills.map((skill) => (
                  <Badge key={skill} variant="secondary" className="text-xs">
                    {skill}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Policy */}
          {agentSpec.policy && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-zinc-500 uppercase tracking-wide">
                Policy
              </label>
              <Badge variant="outline" className="text-xs">
                {agentSpec.policy}
              </Badge>
            </div>
          )}

          {/* Genome */}
          {agentSpec.genome?.evolution && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-zinc-500 uppercase tracking-wide">
                Genetics
              </label>
              <div className="text-zinc-300 text-sm">
                Evolution enabled · Population: {agentSpec.genome.populationSize ?? 3}
                {agentSpec.genome.selectionStrategy && (
                  <span className="text-zinc-500 ml-1">({agentSpec.genome.selectionStrategy})</span>
                )}
              </div>
            </div>
          )}

          <Separator className="bg-zinc-800" />

          {/* Dependencies */}
          {agentSpec.dependsOn && agentSpec.dependsOn.length > 0 && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-zinc-500 uppercase tracking-wide">
                Depends On
              </label>
              <div className="flex gap-1.5 flex-wrap">
                {agentSpec.dependsOn.map((dep) => (
                  <Badge key={dep} variant="outline" className="text-xs text-zinc-400">
                    ← {dep}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Config overrides */}
          {agentSpec.config && Object.keys(agentSpec.config).length > 0 && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-zinc-500 uppercase tracking-wide">
                Config Overrides
              </label>
              <div className="bg-zinc-900 rounded-md p-3 text-xs text-zinc-400 font-mono">
                {Object.entries(agentSpec.config).map(([key, val]) => (
                  <div key={key}>
                    {key}: {JSON.stringify(val)}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
```

**Step 2: Commit**

```
feat: add AgentDetailDrawer component
```

---

### Task 7: Frontend — Wire everything into the Dashboard page

**Files:**

- Modify: `apps/web/app/dashboard/page.tsx`
- Modify: `apps/web/src/hooks/use-sse.ts`

**Step 1: Add new SSE events for swarm lifecycle**

In `apps/web/src/hooks/use-sse.ts`, add listeners for `swarm_stopped` and `swarm_started` events inside the `connect` callback (after the existing `swarm_created` listener). These should dispatch `APPEND_EVENT` actions so they appear in the execution log.

**Step 2: Import new components in dashboard page**

Add imports at top of `apps/web/app/dashboard/page.tsx`:

```typescript
import { SwarmCommandBar } from '@/components/dashboard/swarm-command-bar';
import { AuditPanel } from '@/components/dashboard/audit-panel';
import { AgentDetailDrawer } from '@/components/dashboard/agent-detail-drawer';
```

**Step 3: Add state for agent drawer**

After existing useState hooks (around line 38), add:

```typescript
const [drawerAgent, setDrawerAgent] = useState<AgentSpec | null>(null);
const [drawerOpen, setDrawerOpen] = useState(false);
```

Add callback for opening the drawer:

```typescript
function handleAgentClick(agentName: string) {
  const spec = selectedSwarm?.spec.agents.find((a) => a.name === agentName) ?? null;
  setDrawerAgent(spec);
  setDrawerOpen(true);
}
```

**Step 4: Add SwarmCommandBar after stats row**

After the stats row (around line 220), insert:

```tsx
{
  /* Swarm lifecycle command bar */
}
<SwarmCommandBar swarm={selectedSwarm} onSwarmChanged={fetchSwarms} />;
```

**Step 5: Add Audit tab to Tabs**

Add a new `TabsTrigger` in the TabsList:

```tsx
<TabsTrigger value="audit">Audit</TabsTrigger>
```

Add the corresponding `TabsContent`:

```tsx
<TabsContent value="audit">
  {selectedSwarm && <AuditPanel swarmName={selectedSwarm.name} />}
</TabsContent>
```

**Step 6: Add AgentDetailDrawer at the bottom of the page**

Before the closing `</div>` of the page component, add:

```tsx
<AgentDetailDrawer
  open={drawerOpen}
  onOpenChange={setDrawerOpen}
  agentSpec={drawerAgent}
  executionState={drawerAgent ? (agentStates[drawerAgent.name] ?? 'idle') : 'idle'}
  swarmName={selectedSwarm?.name ?? ''}
/>
```

**Step 7: Wire SwarmGraph click handler**

Pass `onNodeClick={handleAgentClick}` to `<SwarmGraph>`. This requires updating the SwarmGraph component to accept and call this prop.

In `apps/web/src/components/dashboard/swarm-graph.tsx`, add the prop:

```typescript
interface SwarmGraphProps {
  spec: SwarmSpec;
  agentStates: Record<string, AgentExecutionState>;
  onNodeClick?: (agentName: string) => void;
}
```

And wire it to React Flow's `onNodeClick`:

```typescript
onNodeClick={(_event, node) => onNodeClick?.(node.id)}
```

**Step 8: Verify lint**

Run: `cd apps/web && pnpm lint`
Expected: no errors

**Step 9: Commit**

```
feat: wire command bar, audit panel, agent drawer into dashboard
```

---

### Task 8: Add new SSE events for lifecycle

**Files:**

- Modify: `apps/web/src/hooks/use-sse.ts`

**Step 1: Add swarm_stopped and swarm_started listeners**

After the `swarm_created` listener, add:

```typescript
// --- swarm_stopped ---
es.addEventListener('swarm_stopped', (e: MessageEvent) => {
  try {
    const data = JSON.parse(e.data) as Record<string, unknown>;
    dispatch({ type: 'SET_LAST_EVENT', event: { type: 'swarm_stopped', data } });
    dispatch({
      type: 'APPEND_EVENT',
      entry: { time: nowTimestamp(), type: 'swarm_stopped', data },
    });
  } catch {
    // Ignore malformed events
  }
});

// --- swarm_started ---
es.addEventListener('swarm_started', (e: MessageEvent) => {
  try {
    const data = JSON.parse(e.data) as Record<string, unknown>;
    dispatch({ type: 'SET_LAST_EVENT', event: { type: 'swarm_started', data } });
    dispatch({
      type: 'APPEND_EVENT',
      entry: { time: nowTimestamp(), type: 'swarm_started', data },
    });
  } catch {
    // Ignore malformed events
  }
});
```

**Step 2: Update execution-log.tsx to display new event types**

In `apps/web/src/components/dashboard/execution-log.tsx`, add to `getEventDisplay`:

```typescript
case 'swarm_stopped':
  return { label: 'STOP', colorClass: 'text-red-300' };
case 'swarm_started':
  return { label: 'START', colorClass: 'text-emerald-300' };
```

And in `formatLogLine`:

```typescript
case 'swarm_stopped':
  details = 'swarm stopped';
  break;
case 'swarm_started':
  details = 'swarm started';
  break;
```

**Step 3: Commit**

```
feat: add swarm lifecycle SSE events to dashboard
```

---

### Task 9: Verify full stack compilation

**Step 1: Go backend**

Run: `cd apps/controlplane && go vet ./...`
Expected: no errors

**Step 2: Frontend lint**

Run: `cd apps/web && pnpm lint`
Expected: no errors or warnings

**Step 3: Frontend build check**

Run: `cd apps/web && pnpm build`
Expected: successful build

**Step 4: Final commit**

If any fixes needed, commit them:

```
fix: address build errors from dashboard controls integration
```

---

## Summary of Changes

### Backend (Go)

- 3 new endpoints: `POST /stop`, `POST /start`, `GET /sync-status`
- 1 replaced stub: `POST /scale` now functional
- 1 new store method: `UpdateSwarmSpec`

### Frontend (TypeScript/React)

- 4 new components: `SwarmCommandBar`, `SyncStatusBadge`, `AuditPanel`, `AgentDetailDrawer`
- Updated: `api-client.ts` (lifecycle + audit functions), `use-sse.ts` (lifecycle events), `execution-log.tsx` (new event types)
- Updated: `dashboard/page.tsx` (wired all new components)
- Updated: `swarm-graph.tsx` (onNodeClick prop)
