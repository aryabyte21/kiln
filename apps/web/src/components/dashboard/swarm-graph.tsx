'use client';

import { useCallback, useMemo, useEffect } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { AgentNode, type AgentNodeData } from './agent-node';
import { DataFlowEdge } from './data-flow-edge';
import type { SwarmSpec, AgentSpec as ApiAgentSpec } from '@/lib/api-client';
import type { AgentExecutionState } from '@/hooks/use-sse';

const nodeTypes = { agent: AgentNode };
const edgeTypes = { dataflow: DataFlowEdge };

interface SwarmGraphProps {
  spec: SwarmSpec;
  agentStates?: Record<string, AgentExecutionState>;
  className?: string;
}

export function SwarmGraph({ spec, agentStates, className }: SwarmGraphProps) {
  const { initialNodes, initialEdges } = useMemo(() => buildGraph(spec), [spec]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);

  // Update node data with execution states when agentStates changes
  useEffect(() => {
    if (!agentStates) return;

    setNodes((prevNodes) =>
      prevNodes.map((node) => {
        const nodeData = node.data as unknown as AgentNodeData;
        const execState = agentStates[nodeData.role];
        if (execState && execState !== nodeData.executionState) {
          return {
            ...node,
            data: {
              ...node.data,
              executionState: execState,
            },
          };
        }
        return node;
      })
    );
  }, [agentStates, setNodes]);

  const onInit = useCallback(() => {
    // Could fit view here
  }, []);

  return (
    <div
      className={`w-full h-[600px] rounded-xl border border-zinc-800 bg-zinc-950 ${className || ''}`}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onInit={onInit}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        proOptions={{ hideAttribution: true }}
        colorMode="dark"
      >
        <Background color="#27272a" gap={20} />
        <Controls className="!bg-zinc-900 !border-zinc-700 !rounded-lg [&>button]:!bg-zinc-800 [&>button]:!border-zinc-700 [&>button]:!text-zinc-300 [&>button:hover]:!bg-zinc-700" />
        <MiniMap
          nodeColor="#3f3f46"
          maskColor="rgba(0, 0, 0, 0.7)"
          className="!bg-zinc-900 !border-zinc-700 !rounded-lg"
        />
      </ReactFlow>
    </div>
  );
}

function buildGraph(spec: SwarmSpec): { initialNodes: Node[]; initialEdges: Edge[] } {
  const agents = spec.agents || [];
  const topology = spec.topology || [];

  // Auto-layout: arrange nodes in a DAG layout
  const levels = computeLevels(agents, topology);
  const maxLevel = Math.max(...Object.values(levels), 0);

  const nodesPerLevel: Record<number, string[]> = {};
  for (const agent of agents) {
    const level = levels[agent.name] ?? 0;
    if (!nodesPerLevel[level]) nodesPerLevel[level] = [];
    nodesPerLevel[level].push(agent.name);
  }

  const xSpacing = 280;
  const ySpacing = 160;

  const initialNodes: Node[] = agents.map((agent) => {
    const level = levels[agent.name] ?? 0;
    const siblings = nodesPerLevel[level] || [agent.name];
    const index = siblings.indexOf(agent.name);
    const totalWidth = (siblings.length - 1) * xSpacing;

    return {
      id: agent.name,
      type: 'agent',
      position: {
        x:
          maxLevel > 0
            ? index * xSpacing - totalWidth / 2 + ((maxLevel + 1) * xSpacing) / 2
            : index * xSpacing,
        y: level * ySpacing,
      },
      data: {
        label: agent.name,
        role: agent.name,
        model: agent.model,
        status: 'pending',
        replicas: { min: agent.replicas.min, max: agent.replicas.max, current: agent.replicas.min },
        skills: agent.skills,
        tools: agent.tools,
        hasSoul: Boolean(agent.soul),
        hasCron: Boolean(agent.cron && agent.cron.length > 0),
        dependsOn: agent.dependsOn,
        executionState: 'idle',
      } satisfies AgentNodeData,
    };
  });

  const initialEdges: Edge[] = topology.map((edge, i) => ({
    id: `e-${i}`,
    source: edge.from,
    target: edge.to,
    type: 'dataflow',
    data: { subject: edge.subject, active: true },
    animated: true,
  }));

  return { initialNodes, initialEdges };
}

function computeLevels(
  agents: Pick<ApiAgentSpec, 'name' | 'dependsOn'>[],
  topology: { from: string; to: string }[]
): Record<string, number> {
  const deps: Record<string, string[]> = {};
  for (const a of agents) {
    deps[a.name] = a.dependsOn || [];
  }
  // Also infer from topology
  for (const e of topology) {
    if (!deps[e.to]) deps[e.to] = [];
    if (!deps[e.to].includes(e.from)) {
      deps[e.to].push(e.from);
    }
  }

  const levels: Record<string, number> = {};

  function getLevel(name: string, visited: Set<string>): number {
    if (levels[name] !== undefined) return levels[name];
    if (visited.has(name)) return 0; // cycle protection
    visited.add(name);

    const parents = deps[name] || [];
    if (parents.length === 0) {
      levels[name] = 0;
      return 0;
    }

    const maxParent = Math.max(...parents.map((p) => getLevel(p, visited)));
    levels[name] = maxParent + 1;
    return levels[name];
  }

  for (const a of agents) {
    getLevel(a.name, new Set());
  }

  return levels;
}
