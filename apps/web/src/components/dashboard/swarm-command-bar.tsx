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
  const [error, setError] = useState<string | null>(null);

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
      setError(err instanceof Error ? err.message : 'Action failed');
      setTimeout(() => setError(null), 5000);
    } finally {
      setActionInProgress(null);
    }
  }

  const isRunning = swarm.status === 'running';
  const isStopped = swarm.status === 'stopped' || swarm.status === 'pending';

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-3">
      <div className="flex items-center justify-between">
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
      {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
    </div>
  );
}
