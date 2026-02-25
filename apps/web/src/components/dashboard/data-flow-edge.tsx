'use client';

import { memo } from 'react';
import { BaseEdge, getSmoothStepPath, type EdgeProps } from '@xyflow/react';

function DataFlowEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps) {
  const [edgePath] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 16,
  });

  const edgeData = data as { subject?: string; active?: boolean } | undefined;
  const isActive = edgeData?.active !== false;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: isActive ? '#10b981' : '#3f3f46',
          strokeWidth: 2,
          opacity: isActive ? 1 : 0.4,
        }}
      />
      {isActive && (
        <circle r="4" fill="#10b981">
          <animateMotion dur="2s" repeatCount="indefinite" path={edgePath} />
        </circle>
      )}
      {edgeData?.subject && (
        <text>
          <textPath
            href={`#${id}`}
            startOffset="50%"
            textAnchor="middle"
            className="fill-zinc-500 text-[10px]"
          >
            {edgeData.subject}
          </textPath>
        </text>
      )}
    </>
  );
}

export const DataFlowEdge = memo(DataFlowEdgeComponent);
