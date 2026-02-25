'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { AgentExecutionState } from '@/hooks/use-sse';

export interface AgentNodeData {
  label: string;
  role: string;
  model: string;
  status: 'pending' | 'online' | 'busy' | 'draining' | 'offline' | 'error';
  replicas: { min: number; max: number; current: number };
  skills?: string[];
  executionState?: AgentExecutionState;
  tokenCount?: number;
  [key: string]: unknown;
}

const statusColors: Record<string, string> = {
  online: 'bg-emerald-500',
  busy: 'bg-amber-500',
  pending: 'bg-blue-400',
  draining: 'bg-orange-400',
  offline: 'bg-gray-400',
  error: 'bg-red-500',
};

const statusBorders: Record<string, string> = {
  online: 'border-emerald-500/50',
  busy: 'border-amber-500/50',
  pending: 'border-blue-400/50',
  draining: 'border-orange-400/50',
  offline: 'border-gray-400/50',
  error: 'border-red-500/50',
};

function getExecutionClasses(executionState?: AgentExecutionState): string {
  switch (executionState) {
    case 'running':
      return 'ring-2 ring-cyan-400 shadow-lg shadow-cyan-400/20';
    case 'completed':
      return 'ring-2 ring-emerald-400 shadow-lg shadow-emerald-400/20';
    case 'failed':
      return 'ring-2 ring-red-500 shadow-lg shadow-red-500/20 animate-pulse';
    default:
      return '';
  }
}

function AgentNodeComponent({ data }: NodeProps) {
  const nodeData = data as unknown as AgentNodeData;
  const status = nodeData.status || 'pending';
  const dotColor = statusColors[status] || 'bg-gray-400';
  const borderColor = statusBorders[status] || 'border-gray-400/50';
  const executionClasses = getExecutionClasses(nodeData.executionState);

  return (
    <div
      className={`rounded-xl border-2 ${borderColor} bg-zinc-900/90 backdrop-blur-sm px-4 py-3 shadow-lg min-w-[180px] transition-all duration-300 ${executionClasses}`}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!bg-zinc-500 !w-3 !h-3 !border-2 !border-zinc-800"
      />

      <div className="flex items-center gap-2 mb-2">
        <span className={`w-2.5 h-2.5 rounded-full ${dotColor} animate-pulse`} />
        <span className="font-semibold text-white text-sm">{nodeData.label}</span>
        {/* Execution state indicators */}
        {nodeData.executionState === 'completed' && (
          <span className="ml-auto text-emerald-400 text-xs font-bold" title="Completed">
            &#10003;
          </span>
        )}
        {nodeData.executionState === 'failed' && (
          <span className="ml-auto text-red-400 text-xs font-bold" title="Failed">
            &#10007;
          </span>
        )}
      </div>

      {/* Execution state label */}
      {nodeData.executionState === 'running' && (
        <div className="text-[10px] text-cyan-400 font-medium mb-1 animate-pulse">
          Processing...
        </div>
      )}

      <div className="text-xs text-zinc-400 space-y-1">
        <div className="flex justify-between">
          <span>Model</span>
          <span className="text-zinc-300 font-mono">{shortenModel(nodeData.model)}</span>
        </div>
        <div className="flex justify-between">
          <span>Replicas</span>
          <span className="text-zinc-300">
            {nodeData.replicas?.current ?? nodeData.replicas?.min ?? 0}/
            {nodeData.replicas?.max ?? 0}
          </span>
        </div>
        <div className="flex justify-between">
          <span>Status</span>
          <span className="text-zinc-300 capitalize">{status}</span>
        </div>
        {/* Token count overlay when completed */}
        {nodeData.executionState === 'completed' &&
          nodeData.tokenCount != null &&
          nodeData.tokenCount > 0 && (
            <div className="flex justify-between text-emerald-400">
              <span>Tokens</span>
              <span className="font-mono">{nodeData.tokenCount.toLocaleString()}</span>
            </div>
          )}
        {nodeData.skills && nodeData.skills.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1">
            {nodeData.skills.map((s: string) => (
              <span key={s} className="bg-zinc-800 text-zinc-400 text-[10px] px-1.5 py-0.5 rounded">
                {s}
              </span>
            ))}
          </div>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-zinc-500 !w-3 !h-3 !border-2 !border-zinc-800"
      />
    </div>
  );
}

function shortenModel(model: string): string {
  if (model.includes('haiku')) return 'Haiku';
  if (model.includes('sonnet')) return 'Sonnet';
  if (model.includes('opus')) return 'Opus';
  return model.split('-').slice(0, 2).join('-');
}

export const AgentNode = memo(AgentNodeComponent);
