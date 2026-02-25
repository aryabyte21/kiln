'use client';

import { useEffect, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { EventLogEntry } from '@/hooks/use-sse';

interface ExecutionLogProps {
  events: EventLogEntry[];
}

/**
 * Maps SSE event types to short display labels and color classes.
 */
function getEventDisplay(type: string): { label: string; colorClass: string } {
  switch (type) {
    case 'task_submitted':
      return { label: 'SUBMIT', colorClass: 'text-cyan-400' };
    case 'task_assigned':
      return { label: 'ASSIGN', colorClass: 'text-blue-400' };
    case 'task_running':
      return { label: 'RUN', colorClass: 'text-amber-400' };
    case 'task_completed':
      return { label: 'DONE', colorClass: 'text-emerald-400' };
    case 'task_failed':
      return { label: 'FAIL', colorClass: 'text-red-400' };
    case 'pipeline_message':
      return { label: 'PIPE', colorClass: 'text-purple-400' };
    case 'budget_update':
      return { label: 'BUDGET', colorClass: 'text-yellow-400' };
    case 'agent_registered':
      return { label: 'AGENT', colorClass: 'text-blue-300' };
    case 'task_update':
      return { label: 'UPDATE', colorClass: 'text-zinc-400' };
    case 'swarm_created':
      return { label: 'SWARM', colorClass: 'text-cyan-300' };
    case 'connected':
      return { label: 'CONN', colorClass: 'text-emerald-300' };
    case 'swarm_stopped':
      return { label: 'STOP', colorClass: 'text-red-300' };
    case 'swarm_started':
      return { label: 'START', colorClass: 'text-emerald-300' };
    default:
      return { label: type.toUpperCase().slice(0, 6), colorClass: 'text-zinc-500' };
  }
}

function formatLogLine(entry: EventLogEntry): {
  label: string;
  colorClass: string;
  details: string;
} {
  const { label, colorClass } = getEventDisplay(entry.type);
  const data = entry.data;

  const taskId = typeof data.taskId === 'string' ? data.taskId.slice(0, 8) : '';
  const role =
    typeof data.agentRole === 'string'
      ? data.agentRole
      : typeof data.role === 'string'
        ? data.role
        : '';

  let details = '';

  switch (entry.type) {
    case 'task_submitted':
      details = `${taskId} -> ${role}`;
      break;
    case 'task_assigned':
      details = `${taskId} -> ${role}`;
      break;
    case 'task_running':
      details = `${taskId} -> ${role} | executing`;
      break;
    case 'task_completed': {
      const tokens = typeof data.tokens === 'number' ? data.tokens : 0;
      const cost = typeof data.costUsd === 'number' ? (data.costUsd as number).toFixed(4) : '0';
      const latency = typeof data.latencyMs === 'number' ? data.latencyMs : 0;
      details = `${taskId} -> ${role} | ${tokens} tok, $${cost}, ${latency}ms`;
      break;
    }
    case 'task_failed': {
      const errMsg = typeof data.error === 'string' ? data.error.slice(0, 50) : 'unknown';
      details = `${taskId} -> ${role} | ${errMsg}`;
      break;
    }
    case 'pipeline_message': {
      const subject = typeof data.subject === 'string' ? data.subject : '';
      const from = typeof data.from === 'string' ? data.from : '';
      details = `${from} | ${subject}`;
      break;
    }
    case 'budget_update': {
      const spent = typeof data.spent === 'number' ? (data.spent as number).toFixed(4) : '0';
      const percent = typeof data.percent === 'number' ? (data.percent as number).toFixed(1) : '0';
      details = `spent=$${spent} (${percent}%)`;
      break;
    }
    case 'agent_registered': {
      const agentId = typeof data.agentId === 'string' ? data.agentId.slice(0, 8) : '';
      details = `${agentId} | ${role}`;
      break;
    }
    case 'task_update': {
      const status = typeof data.status === 'string' ? data.status : '';
      details = `${taskId} -> ${role} | ${status}`;
      break;
    }
    case 'connected':
      details = 'SSE stream connected';
      break;
    case 'swarm_created':
      details = 'swarm initialized';
      break;
    case 'swarm_stopped':
      details = 'swarm stopped';
      break;
    case 'swarm_started':
      details = 'swarm started';
      break;
    default:
      details = JSON.stringify(data).slice(0, 60);
  }

  return { label, colorClass, details };
}

export function ExecutionLog({ events }: ExecutionLogProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new events
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Execution Log</CardTitle>
        <CardDescription>
          {events.length} event{events.length !== 1 ? 's' : ''} captured
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <div
          ref={scrollRef}
          className="bg-slate-950 rounded-b-lg font-mono text-xs leading-relaxed max-h-[400px] overflow-y-auto p-4"
        >
          {events.length === 0 ? (
            <div className="text-zinc-600 text-center py-8">Waiting for events...</div>
          ) : (
            events.map((entry, i) => {
              const { label, colorClass, details } = formatLogLine(entry);
              return (
                <div key={i} className="whitespace-nowrap hover:bg-zinc-900/50 px-1 py-0.5 rounded">
                  <span className="text-zinc-600">[{entry.time}]</span>{' '}
                  <span className={`${colorClass} font-bold inline-block w-16`}>
                    {label.padEnd(6)}
                  </span>{' '}
                  <span className="text-zinc-300">{details}</span>
                </div>
              );
            })
          )}
        </div>
      </CardContent>
    </Card>
  );
}
