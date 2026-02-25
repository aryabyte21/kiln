'use client';

import { Badge } from '@/components/ui/badge';
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
