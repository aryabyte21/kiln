'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { SSEBudget } from '@/hooks/use-sse';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CostGaugeProps {
  budget: SSEBudget | null;
  /** Fallback values from the swarm spec when no SSE budget has arrived yet. */
  specBudget?: {
    total: string;
    alertAt: number;
    hardStop: number;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function percentColor(percent: number): string {
  if (percent >= 80) return 'bg-red-500';
  if (percent >= 60) return 'bg-amber-500';
  return 'bg-emerald-500';
}

function percentTextColor(percent: number): string {
  if (percent >= 80) return 'text-red-400';
  if (percent >= 60) return 'text-amber-400';
  return 'text-emerald-400';
}

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CostGauge({ budget, specBudget }: CostGaugeProps) {
  // Derive display values, preferring live budget from SSE
  const total = budget?.total ?? parseFloat(specBudget?.total?.replace('$', '') ?? '0');
  const spent = budget?.spent ?? 0;
  const percent = budget?.percent ?? (total > 0 ? (spent / total) * 100 : 0);
  const taskCount = budget?.taskCount ?? 0;
  const clampedPercent = Math.min(percent, 100);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">Cost Tracker</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Spend summary */}
        <div className="flex items-baseline justify-between">
          <span className={`text-2xl font-bold ${percentTextColor(clampedPercent)}`}>
            {formatUsd(spent)}
          </span>
          <span className="text-sm text-zinc-500">/ {formatUsd(total)}</span>
        </div>

        {/* Progress bar */}
        <div className="relative h-3 w-full overflow-hidden rounded-full bg-zinc-800">
          <div
            className={`h-full rounded-full transition-all duration-500 ${percentColor(clampedPercent)}`}
            style={{ width: `${clampedPercent}%` }}
          />
        </div>

        {/* Stats row */}
        <div className="flex items-center justify-between text-xs text-zinc-500">
          <span>{clampedPercent.toFixed(1)}% used</span>
          <span>
            {taskCount} {taskCount === 1 ? 'task' : 'tasks'}
          </span>
        </div>

        {/* Alert thresholds */}
        {(budget ?? specBudget) && (
          <div className="flex gap-3 text-xs text-zinc-600">
            <span>Alert at {budget?.alertAt ?? specBudget?.alertAt ?? 0}%</span>
            <span className="text-zinc-700">|</span>
            <span>Hard stop at {budget?.hardStop ?? specBudget?.hardStop ?? 0}%</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
