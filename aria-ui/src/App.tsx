import { useReducer, useRef, useEffect, useState } from 'react'
import './App.css'

// ── Types ────────────────────────────────────────────────────────────────────

interface NodeDef {
  id: string
  role: string
  tools: string[]
  task: string
}

type NodeStatus = 'pending' | 'running' | 'complete'

interface NodeState extends NodeDef {
  status: NodeStatus
  result?: string
  toolCalls: { tool: string; args: Record<string, unknown>; result?: unknown }[]
}

interface LogEntry {
  id: number
  type: string
  node_id?: string
  text: string
}

interface MissingEnv {
  tool_id: string
  var_name: string
  description: string
}

interface MissingTool {
  id: string
  description: string
}

interface SynthesisJob {
  job_id: string
  tool_id: string
  status: string
}

interface AppState {
  phase: 'idle' | 'planning' | 'config' | 'running' | 'complete' | 'error'
  nodes: Record<string, NodeState>
  nodeOrder: string[]
  exitNode: string
  missingTools: MissingTool[]
  logs: LogEntry[]
  finalAnswer: string
  error: string
}

type Action =
  | { type: 'RESET' }
  | { type: 'PLANNING' }
  | { type: 'PLAN_READY'; payload: { nodes: NodeDef[]; order: string[]; exit_node: string; missing_tools: MissingTool[] } }
  | { type: 'NEEDS_CONFIG' }
  | { type: 'NODE_START'; payload: { node_id: string } }
  | { type: 'NODE_RETRY'; payload: { node_id: string; reason: string } }
  | { type: 'TOOL_CALL'; payload: { node_id: string; tool: string; args: Record<string, unknown> } }
  | { type: 'TOOL_RESULT'; payload: { node_id: string; tool: string; result: unknown } }
  | { type: 'NODE_COMPLETE'; payload: { node_id: string; result: string } }
  | { type: 'FLOW_COMPLETE'; payload: { final_answer: string } }
  | { type: 'ERROR'; payload: { message: string } }

const initial: AppState = {
  phase: 'idle', nodes: {}, nodeOrder: [], exitNode: '',
  missingTools: [], logs: [], finalAnswer: '', error: '',
}

let _logId = 0
function mkLog(type: string, text: string, node_id?: string): LogEntry {
  return { id: ++_logId, type, text, node_id }
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'RESET':    return { ...initial }
    case 'PLANNING': return { ...initial, phase: 'planning' }

    case 'PLAN_READY': {
      const { nodes, order, exit_node, missing_tools } = action.payload
      const nodeMap: Record<string, NodeState> = {}
      nodes.forEach(n => { nodeMap[n.id] = { ...n, status: 'pending', toolCalls: [] } })
      // Normalise: planner may return strings (legacy) or objects
      const mt: MissingTool[] = (missing_tools || []).map((t: MissingTool | string) =>
        typeof t === 'string' ? { id: t, description: '' } : t
      )
      return {
        ...state, nodes: nodeMap,
        nodeOrder: order, exitNode: exit_node, missingTools: mt,
        logs: [...state.logs, mkLog('plan', `Plan ready — ${order.join(' → ')}`)],
      }
    }

    case 'NEEDS_CONFIG':
      return { ...state, phase: 'config' }

    case 'NODE_RETRY': {
      const { node_id, reason } = action.payload
      return {
        ...state,
        logs: [...state.logs, mkLog('node_retry', `↺ retrying ${node_id} — ${reason.slice(0, 80)}`, node_id)],
      }
    }

    case 'NODE_START':
      return {
        ...state,
        phase: 'running',
        nodes: { ...state.nodes, [action.payload.node_id]: { ...state.nodes[action.payload.node_id], status: 'running' } },
        logs: [...state.logs, mkLog('node_start', `Starting ${action.payload.node_id}`, action.payload.node_id)],
      }

    case 'TOOL_CALL': {
      const { node_id, tool, args } = action.payload
      const node = state.nodes[node_id]
      return {
        ...state,
        nodes: { ...state.nodes, [node_id]: { ...node, toolCalls: [...node.toolCalls, { tool, args }] } },
        logs: [...state.logs, mkLog('tool_call', `→ ${tool}(${JSON.stringify(args)})`, node_id)],
      }
    }

    case 'TOOL_RESULT': {
      const { node_id, tool, result } = action.payload
      const node  = state.nodes[node_id]
      const calls = [...node.toolCalls]
      const idx   = calls.map(c => c.tool).lastIndexOf(tool)
      if (idx >= 0) calls[idx] = { ...calls[idx], result }
      return {
        ...state,
        nodes: { ...state.nodes, [node_id]: { ...node, toolCalls: calls } },
        logs: [...state.logs, mkLog('tool_result', `← ${tool}: ${JSON.stringify(result).slice(0, 80)}`, node_id)],
      }
    }

    case 'NODE_COMPLETE':
      return {
        ...state,
        nodes: { ...state.nodes, [action.payload.node_id]: { ...state.nodes[action.payload.node_id], status: 'complete', result: action.payload.result } },
        logs: [...state.logs, mkLog('node_complete', `✓ ${action.payload.node_id} done`, action.payload.node_id)],
      }

    case 'FLOW_COMPLETE':
      return { ...state, phase: 'complete', finalAnswer: action.payload.final_answer,
               logs: [...state.logs, mkLog('flow_complete', 'All agents finished')] }

    case 'ERROR':
      return { ...state, phase: 'error', error: action.payload.message,
               logs: [...state.logs, mkLog('error', action.payload.message)] }

    default: return state
  }
}

// ── NodeCard ──────────────────────────────────────────────────────────────────

function NodeCard({ node, isExit }: { node: NodeState; isExit: boolean }) {
  const icon = node.status === 'running' ? '⚡' : node.status === 'complete' ? '✓' : '○'
  return (
    <div className={`node-card node-${node.status}${isExit ? ' node-exit' : ''}`}>
      <div className="node-header">
        <span className="node-icon">{icon}</span>
        <span className="node-role">{node.role}</span>
        {isExit && <span className="node-badge">SYNTHESIS</span>}
      </div>
      <div className="node-id">{node.id}</div>
      {node.tools.length > 0 && (
        <div className="node-tools">
          {node.tools.map(t => <span key={t} className="tool-chip">{t.split('.').pop()}</span>)}
        </div>
      )}
      {node.toolCalls.map((c, i) => (
        <div key={i} className="tool-call-row">
          <span className="call-arrow">→</span>
          <span className="call-name">{c.tool}</span>
          {c.result !== undefined && <span className="call-done">✓</span>}
        </div>
      ))}
      {node.result && (
        <div className="node-result">{node.result.slice(0, 100)}{node.result.length > 100 ? '…' : ''}</div>
      )}
    </div>
  )
}

// ── GraphView ─────────────────────────────────────────────────────────────────

function GraphView({ state }: { state: AppState }) {
  const { nodes, nodeOrder, exitNode } = state
  if (nodeOrder.length === 0) return null
  const entries = nodeOrder.filter(id => id !== exitNode)
  const exit    = nodes[exitNode]
  return (
    <section className="graph-section">
      <h2>Task Graph</h2>
      <div className="graph-layout">
        <div className="graph-entries">
          {entries.map(id => <NodeCard key={id} node={nodes[id]} isExit={false} />)}
        </div>
        {exit && <><div className="graph-arrow">→</div><NodeCard node={exit} isExit={true} /></>}
      </div>
    </section>
  )
}

// ── EnvConfigPanel ────────────────────────────────────────────────────────────

function EnvConfigPanel({
  missing,
  values,
  onChange,
  onSubmit,
}: {
  missing: MissingEnv[]
  values: Record<string, string>
  onChange: (key: string, val: string) => void
  onSubmit: () => void
}) {
  const allFilled = missing.every(ev => (values[ev.var_name] || '').trim() !== '')
  return (
    <section className="env-config">
      <h2>API Keys Required</h2>
      <p className="env-config-hint">
        The planned tools need these credentials. They are sent only to your local BabelServer and never stored.
      </p>
      <div className="env-fields">
        {missing.map(ev => (
          <div key={ev.var_name} className="env-row">
            <div className="env-row-meta">
              <span className="env-var-name">{ev.var_name}</span>
              <span className="env-tool-badge">{ev.tool_id.split('.').pop()}</span>
            </div>
            <p className="env-desc">{ev.description}</p>
            <input
              className="env-input"
              type="password"
              placeholder={`Enter ${ev.var_name}`}
              value={values[ev.var_name] || ''}
              onChange={e => onChange(ev.var_name, e.target.value)}
              autoComplete="off"
            />
          </div>
        ))}
      </div>
      <button className="query-btn env-submit-btn" onClick={onSubmit} disabled={!allFilled}>
        Continue →
      </button>
    </section>
  )
}

// ── StreamLog ─────────────────────────────────────────────────────────────────

function StreamLog({ logs }: { logs: LogEntry[] }) {
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [logs.length])
  if (logs.length === 0) return null
  return (
    <section className="log-section">
      <h2>Execution Log</h2>
      <div className="log-scroll">
        {logs.map(e => (
          <div key={e.id} className={`log-entry log-${e.type}`}>
            <span className="log-tag">{e.type}</span>
            {e.node_id && <span className="log-node">[{e.node_id}]</span>}
            <span className="log-text">{e.text}</span>
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </section>
  )
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [state, dispatch] = useReducer(reducer, initial)
  const [query, setQuery] = useReducer((_: string, v: string) => v, '')
  const srcRef   = useRef<EventSource | null>(null)
  const runIdRef = useRef<string>('')

  const [missingEnvs,    setMissingEnvs]    = useState<MissingEnv[]>([])
  const [envValues,      setEnvValues]      = useState<Record<string, string>>({})
  const [synthesisJobs,  setSynthesisJobs]  = useState<SynthesisJob[]>([])

  const isRunning = state.phase === 'planning' || state.phase === 'running'

  // ── Connect to SSE stream ──────────────────────────────────────────────────
  function connectStream(run_id: string) {
    srcRef.current?.close()
    const src = new EventSource(`/aria/stream/${run_id}`)
    srcRef.current = src

    src.onmessage = (e) => {
      const ev = JSON.parse(e.data)
      if (ev.type === 'plan_ready') {
        const order = [
          ...(ev.entry_nodes || ev.nodes.map((n: NodeDef) => n.id).filter((id: string) => id !== ev.exit_node)),
          ev.exit_node,
        ]
        dispatch({ type: 'PLAN_READY', payload: { nodes: ev.nodes, order, exit_node: ev.exit_node, missing_tools: ev.missing_tools || [] } })
      } else if (ev.type === 'node_start') {
        dispatch({ type: 'NODE_START', payload: { node_id: ev.node_id } })
      } else if (ev.type === 'tool_call') {
        dispatch({ type: 'TOOL_CALL', payload: { node_id: ev.node_id, tool: ev.tool, args: ev.args } })
      } else if (ev.type === 'tool_result') {
        dispatch({ type: 'TOOL_RESULT', payload: { node_id: ev.node_id, tool: ev.tool, result: ev.result } })
      } else if (ev.type === 'node_retry') {
        dispatch({ type: 'NODE_RETRY', payload: { node_id: ev.node_id, reason: ev.reason } })
      } else if (ev.type === 'node_complete') {
        dispatch({ type: 'NODE_COMPLETE', payload: { node_id: ev.node_id, result: ev.result } })
      } else if (ev.type === 'flow_complete') {
        dispatch({ type: 'FLOW_COMPLETE', payload: { final_answer: ev.final_answer } })
        src.close()
      } else if (ev.type === 'error') {
        dispatch({ type: 'ERROR', payload: { message: ev.message } })
        src.close()
      }
    }
    src.onerror = () => {
      if (state.phase !== 'complete') {
        dispatch({ type: 'ERROR', payload: { message: 'Stream connection lost' } })
      }
      src.close()
    }
  }

  // ── Phase 1: Plan ──────────────────────────────────────────────────────────
  async function submit(e: React.FormEvent<HTMLFormElement> | null) {
    e?.preventDefault()
    if (!query.trim() || isRunning) return
    srcRef.current?.close()
    dispatch({ type: 'RESET' })
    dispatch({ type: 'PLANNING' })
    setMissingEnvs([])
    setEnvValues({})
    setSynthesisJobs([])

    try {
      const res = await fetch('/aria/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request: query }),
      })
      if (!res.ok) {
        const err = await res.json()
        dispatch({ type: 'ERROR', payload: { message: err.detail || 'Server error' } })
        return
      }
      const data = await res.json()
      runIdRef.current = data.run_id

      if (data.synthesis_jobs?.length) setSynthesisJobs(data.synthesis_jobs)

      if (data.status === 'needs_config') {
        // Show plan graph in pending state + config panel
        const plan = data.plan
        const order = [
          ...(plan.entry_nodes || plan.nodes.map((n: NodeDef) => n.id).filter((id: string) => id !== plan.exit_node)),
          plan.exit_node,
        ]
        dispatch({ type: 'PLAN_READY', payload: { nodes: plan.nodes, order, exit_node: plan.exit_node, missing_tools: plan.missing_tools || [] } })
        dispatch({ type: 'NEEDS_CONFIG' })
        setMissingEnvs(data.missing_envs)
      } else {
        // All keys present — stream starts immediately
        connectStream(data.run_id)
      }
    } catch (err) {
      dispatch({ type: 'ERROR', payload: { message: String(err) } })
    }
  }

  // ── Phase 2: Execute with supplied env vars ────────────────────────────────
  async function executeWithEnv() {
    const run_id = runIdRef.current
    if (!run_id) return
    dispatch({ type: 'PLANNING' })

    try {
      const res = await fetch(`/aria/execute/${run_id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ env_vars: envValues }),
      })
      if (!res.ok) {
        const err = await res.json()
        dispatch({ type: 'ERROR', payload: { message: err.detail || 'Server error' } })
        return
      }
      connectStream(run_id)
    } catch (err) {
      dispatch({ type: 'ERROR', payload: { message: String(err) } })
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-title">
          <span className="aria-logo">ARIA</span>
          <span className="header-sub">Adaptive Runtime Intelligence Architecture</span>
        </div>
        <div className="header-powered">Powered by Babel + Mistral + AG2</div>
      </header>

      <main className="app-main">
        <form onSubmit={submit} className="query-form">
          <input
            className="query-input"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="What would you like ARIA to do?  e.g. Search for AI news and send a Slack summary"
            disabled={isRunning}
          />
          <button className="query-btn" type="submit" disabled={isRunning || !query.trim()}>
            {state.phase === 'planning' ? <span className="spinner" /> : 'Run →'}
          </button>
        </form>

        {state.missingTools.length > 0 && (
          <div className="banner banner-warn">
            <span>⚠ Missing tools:</span>
            {state.missingTools.map(t => (
              <span key={t.id} className="tool-chip" title={t.description}>{t.id.split('.').pop()}</span>
            ))}
            {synthesisJobs.length > 0
              ? <span className="synth-status">⟳ Synthesizing {synthesisJobs.length} tool{synthesisJobs.length > 1 ? 's' : ''} via Vibe Coder — will be available on next run</span>
              : <span className="synth-status">Start Vibe Coder to auto-build these tools</span>
            }
          </div>
        )}

        {/* Plan graph visible immediately after planning, even during config */}
        <GraphView state={state} />

        {/* Config panel appears inline below the graph */}
        {state.phase === 'config' && missingEnvs.length > 0 && (
          <EnvConfigPanel
            missing={missingEnvs}
            values={envValues}
            onChange={(key, val) => setEnvValues(prev => ({ ...prev, [key]: val }))}
            onSubmit={executeWithEnv}
          />
        )}

        <div className="bottom-row">
          <StreamLog logs={state.logs} />
          {(state.phase === 'complete' || state.phase === 'error') && (
            <section className="answer-section">
              <h2>{state.phase === 'complete' ? 'Final Answer' : 'Error'}</h2>
              <div className={`answer-box${state.phase === 'error' ? ' answer-error' : ''}`}>
                {state.phase === 'complete' ? state.finalAnswer : state.error}
              </div>
            </section>
          )}
        </div>
      </main>
    </div>
  )
}
