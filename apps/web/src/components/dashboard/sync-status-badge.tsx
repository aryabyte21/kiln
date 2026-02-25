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
