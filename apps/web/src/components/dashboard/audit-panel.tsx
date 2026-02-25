'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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
  const [fetchError, setFetchError] = useState<string | null>(null);

  const fetchEvents = useCallback(async () => {
    try {
      setLoading(true);
      setFetchError(null);
      const data = await getAuditEvents(swarmName, 100);
      setEvents(data ?? []);
    } catch (err) {
      setEvents([]);
      const message = err instanceof Error ? err.message : 'Unknown error';
      if (message.includes('404') || message.includes('Not Found')) {
        setFetchError('Audit endpoint unavailable \u2014 rebuild the control plane');
      } else {
        setFetchError(`Failed to load audit events: ${message}`);
      }
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
          {fetchError ? (
            <div className="text-red-400 text-center py-8">{fetchError}</div>
          ) : filteredEvents.length === 0 ? (
            <div className="text-zinc-500 text-center py-8">
              {loading
                ? 'Loading audit events...'
                : 'No audit events yet. Events will appear here as agents execute tasks.'}
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
