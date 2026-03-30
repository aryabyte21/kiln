import { SignedIn, SignedOut, SignIn, UserButton, useAuth } from '@clerk/clerk-react'
import { useReducer, useRef, useEffect, useState, useCallback } from 'react'
import type { ReactNode } from 'react'
import './App.css'

// ── Types ─────────────────────────────────────────────────────────────────────

interface NodeDef { id: string; role: string; tools: string[]; task: string }
type NodeStatus = 'pending' | 'running' | 'complete'
interface NodeState extends NodeDef {
  status: NodeStatus
  result?: string
  toolCalls: { tool: string; args: Record<string, unknown>; result?: unknown }[]
}
interface LogEntry { id: number; type: string; node_id?: string; text: string }
interface MissingEnv { tool_id: string; var_name: string; description: string }
interface MissingTool { id: string; description: string }
interface SynthesisJob { job_id: string; tool_id: string; status: string }
interface AppState {
  phase: 'idle' | 'planning' | 'config' | 'running' | 'complete' | 'error'
  nodes: Record<string, NodeState>; nodeOrder: string[]; exitNode: string
  missingTools: MissingTool[]; logs: LogEntry[]; finalAnswer: string; error: string
}
type Action =
  | { type: 'RESET' } | { type: 'PLANNING' }
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
      const mt: MissingTool[] = (missing_tools || []).map((t: MissingTool | string) =>
        typeof t === 'string' ? { id: t, description: '' } : t)
      return { ...state, nodes: nodeMap, nodeOrder: order, exitNode: exit_node, missingTools: mt,
        logs: [...state.logs, mkLog('plan', `Plan ready — ${order.join(' → ')}`)],
      }
    }
    case 'NEEDS_CONFIG': return { ...state, phase: 'config' }
    case 'NODE_RETRY': {
      const { node_id, reason } = action.payload
      return { ...state, logs: [...state.logs, mkLog('node_retry', `↺ retrying ${node_id} — ${reason.slice(0, 80)}`, node_id)] }
    }
    case 'NODE_START':
      return {
        ...state, phase: 'running',
        nodes: { ...state.nodes, [action.payload.node_id]: { ...state.nodes[action.payload.node_id], status: 'running' } },
        logs: [...state.logs, mkLog('node_start', `Starting ${action.payload.node_id}`, action.payload.node_id)],
      }
    case 'TOOL_CALL': {
      const { node_id, tool, args } = action.payload
      const node = state.nodes[node_id]
      return { ...state,
        nodes: { ...state.nodes, [node_id]: { ...node, toolCalls: [...node.toolCalls, { tool, args }] } },
        logs: [...state.logs, mkLog('tool_call', `→ ${tool}(${JSON.stringify(args)})`, node_id)],
      }
    }
    case 'TOOL_RESULT': {
      const { node_id, tool, result } = action.payload
      const node = state.nodes[node_id]; const calls = [...node.toolCalls]
      const idx = calls.map(c => c.tool).lastIndexOf(tool)
      if (idx >= 0) calls[idx] = { ...calls[idx], result }
      return { ...state,
        nodes: { ...state.nodes, [node_id]: { ...node, toolCalls: calls } },
        logs: [...state.logs, mkLog('tool_result', `← ${tool}: ${JSON.stringify(result).slice(0, 80)}`, node_id)],
      }
    }
    case 'NODE_COMPLETE':
      return { ...state,
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

// ── Markdown renderer ──────────────────────────────────────────────────────────

function inlineMd(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code class="inline-code">$1</code>')
}

function Markdown({ text }: { text: string }): ReactNode {
  const lines = text.split('\n')
  const out: ReactNode[] = []
  let i = 0

  function isList(ln: string) { return /^(\s*)[-*]\s/.test(ln) || /^(\s*)\d+\.\s/.test(ln) }

  function parseList(startIdx: number): [ReactNode, number] {
    const items: { html: string; children?: ReactNode }[] = []
    let idx = startIdx
    const baseIndent = (lines[idx].match(/^(\s*)/) || ['', ''])[1].length

    while (idx < lines.length) {
      const ln = lines[idx]
      const indent = (ln.match(/^(\s*)/) || ['', ''])[1].length
      if (ln.trim() === '') { idx++; continue }
      if (!isList(ln) || indent < baseIndent) break
      if (indent > baseIndent) {
        const [child, nextIdx] = parseList(idx)
        if (items.length > 0) items[items.length - 1].children = child
        idx = nextIdx
        continue
      }
      const content = ln.replace(/^\s*[-*]\s/, '').replace(/^\s*\d+\.\s/, '')
      items.push({ html: inlineMd(content) })
      idx++
    }

    const isOrdered = /^\s*\d+\.\s/.test(lines[startIdx])
    const Tag = isOrdered ? 'ol' : 'ul'
    return [
      <Tag key={`list-${startIdx}`}>
        {items.map((it, j) => (
          <li key={j}>
            <span dangerouslySetInnerHTML={{ __html: it.html }} />
            {it.children}
          </li>
        ))}
      </Tag>,
      idx,
    ]
  }

  while (i < lines.length) {
    const line = lines[i]
    // headings
    const hMatch = line.match(/^(#{1,6})\s+(.+)$/)
    if (hMatch) {
      const html = inlineMd(hMatch[2])
      const cls = `md-h${hMatch[1].length}`
      switch (hMatch[1].length) {
        case 1: out.push(<h1 key={i} className={cls} dangerouslySetInnerHTML={{ __html: html }} />); break
        case 2: out.push(<h2 key={i} className={cls} dangerouslySetInnerHTML={{ __html: html }} />); break
        case 3: out.push(<h3 key={i} className={cls} dangerouslySetInnerHTML={{ __html: html }} />); break
        case 4: out.push(<h4 key={i} className={cls} dangerouslySetInnerHTML={{ __html: html }} />); break
        case 5: out.push(<h5 key={i} className={cls} dangerouslySetInnerHTML={{ __html: html }} />); break
        default: out.push(<h6 key={i} className={cls} dangerouslySetInnerHTML={{ __html: html }} />); break
      }
      i++; continue
    }
    // horizontal rule
    if (/^(-{3,}|_{3,}|\*{3,})\s*$/.test(line.trim())) {
      out.push(<hr key={i} className="md-hr" />)
      i++; continue
    }
    // lists (unordered & ordered, with nesting)
    if (isList(line)) {
      const [listNode, nextIdx] = parseList(i)
      out.push(listNode)
      i = nextIdx; continue
    }
    // blank line
    if (line.trim() === '') { i++; continue }
    // paragraph
    out.push(<p key={i} dangerouslySetInnerHTML={{ __html: inlineMd(line) }} />)
    i++
  }
  return <>{out}</>
}

// ── NodeCard ───────────────────────────────────────────────────────────────────

function NodeCard({ node, isExit }: { node: NodeState; isExit: boolean }) {
  return (
    <div className={`gnode gnode-${node.status}${isExit ? ' gnode-exit' : ''}`}>
      <div className="gnode-header">
        <div className={`gnode-indicator gnode-indicator-${node.status}`}>
          {node.status === 'running' && <><span className="gnode-ring" /><span className="gnode-spinner" /></>}
          {node.status === 'complete' && <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 5.5L4 7.5L8 3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>}
          {node.status === 'pending' && <span className="gnode-dot" />}
        </div>
        <span className="gnode-role">{node.role}</span>
        {isExit && <span className="gnode-badge">SYNTHESIS</span>}
        <span className={`gnode-status-pill gnode-pill-${node.status}`}>{node.status}</span>
      </div>
      <div className="gnode-id">{node.id}</div>
      {node.tools.length > 0 && (
        <div className="gnode-tools">
          {node.tools.map(t => <span key={t} className="tool-chip">{t.split('.').pop()}</span>)}
        </div>
      )}
      {node.toolCalls.length > 0 && (
        <div className="gnode-calls">
          {node.toolCalls.map((c, i) => (
            <div key={i} className="gnode-call-row">
              <span className="gnode-call-arrow">›</span>
              <span className="gnode-call-name">{c.tool}</span>
              {c.result !== undefined && <span className="gnode-call-done">✓</span>}
            </div>
          ))}
        </div>
      )}
      {node.result && (
        <div className="gnode-result">{node.result.replace(/\*\*/g, '').slice(0, 140)}{node.result.length > 140 ? '…' : ''}</div>
      )}
    </div>
  )
}

// ── GraphView ──────────────────────────────────────────────────────────────────

function GraphView({ state }: { state: AppState }) {
  const { nodes, nodeOrder, exitNode } = state
  if (nodeOrder.length === 0) return null
  const entries = nodeOrder.filter(id => id !== exitNode)
  const exit = nodes[exitNode]

  const allNodes = Object.values(nodes)
  const doneCount    = allNodes.filter(n => n.status === 'complete').length
  const runningCount = allNodes.filter(n => n.status === 'running').length
  const totalCount   = allNodes.length

  const phase = state.phase === 'complete' ? 'complete'
    : runningCount > 0 ? 'running' : 'planning'

  return (
    <section className="graph-section">
      <div className="graph-header">
        <div className="section-label" style={{ marginBottom: 0 }}>Task Graph</div>
        <div className="graph-header-pills">
          <span className="graph-count-pill">{doneCount}/{totalCount} done</span>
          {runningCount > 0 && (
            <span className="graph-running-pill">
              <span className="gnode-spinner" style={{ width: 8, height: 8 }} />
              {runningCount} running
            </span>
          )}
          <span className={`graph-phase-badge graph-phase-${phase}`}>{phase}</span>
        </div>
      </div>
      <div className="graph-canvas">
        {entries.length > 0 && (
          <div className="graph-workers">
            {entries.map(id => <NodeCard key={id} node={nodes[id]} isExit={false} />)}
          </div>
        )}
        {exit && (
          <>
            <div className="graph-pipe">
              <div className="graph-pipe-track">
                <svg className="graph-pipe-top" width="24" height="20" viewBox="0 0 24 20" fill="none">
                  <path d="M0 20C0 9 12 0 24 0" stroke="var(--border-lit)" strokeWidth="1.5" strokeDasharray="4 2"/>
                </svg>
                <div className="graph-pipe-mid" />
                <svg className="graph-pipe-bot" width="24" height="20" viewBox="0 0 24 20" fill="none">
                  <path d="M0 0C0 11 12 20 24 20" stroke="var(--border-lit)" strokeWidth="1.5" strokeDasharray="4 2"/>
                </svg>
              </div>
              <div className="graph-pipe-arrow">
                <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                  <circle cx="14" cy="14" r="13" stroke="var(--border-lit)" strokeWidth="1"/>
                  <path d="M11 9L17 14L11 19" stroke="var(--border-lit)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
            </div>
            <div className="graph-exit-col">
              <NodeCard node={exit} isExit />
            </div>
          </>
        )}
      </div>
    </section>
  )
}

// ── EnvConfigPanel ─────────────────────────────────────────────────────────────

function EnvConfigPanel({ missing, values, onChange, onSubmit }: {
  missing: MissingEnv[]; values: Record<string, string>
  onChange: (k: string, v: string) => void; onSubmit: () => void
}) {
  const allFilled = missing.every(ev => (values[ev.var_name] || '').trim() !== '')
  return (
    <section className="env-config">
      <div className="section-label">API Keys Required</div>
      <p className="env-hint">These credentials are sent only to your local KilnServer and never stored.</p>
      <div className="env-fields">
        {missing.map(ev => (
          <div key={ev.var_name} className="env-row">
            <div className="env-meta">
              <span className="env-var">{ev.var_name}</span>
              <span className="env-tool">{ev.tool_id.split('.').pop()}</span>
            </div>
            <p className="env-desc">{ev.description}</p>
            <input className="env-input" type="password" placeholder={`Enter ${ev.var_name}`}
              value={values[ev.var_name] || ''} onChange={e => onChange(ev.var_name, e.target.value)} autoComplete="off" />
          </div>
        ))}
      </div>
      <button className="btn-primary" onClick={onSubmit} disabled={!allFilled}>Continue →</button>
    </section>
  )
}

// ── StreamLog ──────────────────────────────────────────────────────────────────

function StreamLog({ logs }: { logs: LogEntry[] }) {
  const endRef = useRef<HTMLDivElement>(null)
  if (logs.length === 0) return null
  return (
    <section className="panel">
      <div className="section-label">Execution Log</div>
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

// ── IdleLanding ────────────────────────────────────────────────────────────────

const EXAMPLES = [
  { label: 'Finance', q: 'What is the current gold price and predict if it will rise tomorrow?' },
  { label: 'Research', q: 'Find the latest papers on transformer attention and summarize the top 3.' },
  { label: 'Crypto', q: 'Get Bitcoin historical data for last 30 days and analyze the trend.' },
  { label: 'FX', q: 'Convert 5000 SGD to USD and show the current exchange rate.' },
  { label: 'News', q: 'What are the top geopolitical events this week?' },
  { label: 'Market', q: 'Analyze the market impact of recent Fed policy changes on tech stocks.' },
]

function IdleLanding({ onSelect }: { onSelect: (q: string) => void }) {
  return (
    <div className="idle-landing">
      <div className="idle-hero">
        <div className="idle-icon">⚡</div>
        <h1 className="idle-title">Ask Kiln anything</h1>
        <p className="idle-sub">Kiln plans, fetches, synthesizes, and answers — building new tools on the fly when needed.</p>
      </div>
      <div className="idle-pills-label">Try an example</div>
      <div className="idle-examples">
        {EXAMPLES.map(ex => (
          <button key={ex.label} className="idle-example" onClick={() => onSelect(ex.q)}>
            <span className="idle-example-label">{ex.label}</span>
            <span className="idle-example-q">{ex.q}</span>
          </button>
        ))}
      </div>
      <div className="idle-features">
        <div className="idle-feature">
          <span className="idle-feature-icon">🧠</span>
          <span className="idle-feature-text">Mistral Large planner</span>
        </div>
        <div className="idle-feature">
          <span className="idle-feature-icon">🔧</span>
          <span className="idle-feature-text">Live tool synthesis</span>
        </div>
        <div className="idle-feature">
          <span className="idle-feature-icon">📦</span>
          <span className="idle-feature-text">Kiln tool registry</span>
        </div>
        <div className="idle-feature">
          <span className="idle-feature-icon">🤖</span>
          <span className="idle-feature-text">AG2 multi-agent</span>
        </div>
      </div>
    </div>
  )
}

// ── ToolsPage ──────────────────────────────────────────────────────────────────

interface ToolParam { name: string; type: string; description: string; required: boolean; default?: unknown }
interface Tool { id: string; name: string; version: string; description: string; author: string; category: string; tags: string[]; params: ToolParam[] }

function ToolsPage() {
  const [tools, setTools] = useState<Tool[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  async function fetchTools() {
    setLoading(true); setError('')
    try {
      const res = await fetch('/tools')
      if (!res.ok) throw new Error(`Server returned ${res.status}`)
      setTools(await res.json())
    } catch (e) { setError(String(e)) } finally { setLoading(false) }
  }

  useEffect(() => { fetchTools() }, [])

  const filtered = tools.filter(t =>
    search === '' || t.name.includes(search) || t.id.includes(search) || t.description.toLowerCase().includes(search.toLowerCase())
  )

  if (loading) return <div className="centered-msg"><span className="spinner" /> Loading tools…</div>
  if (error)   return <div className="centered-msg error-text">{error}</div>

  return (
    <div className="tools-page">
      <div className="tools-toolbar">
        <div className="tools-toolbar-left">
          <span className="tools-count">{tools.length} tools registered</span>
          <input className="search-input" placeholder="Search tools…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <button className="btn-outline" onClick={fetchTools}>↻ Refresh</button>
      </div>
      <div className="tools-grid">
        {filtered.map(tool => (
          <div key={tool.id} className="tool-card">
            <div className="tool-card-header">
              <span className="tool-name">{tool.name}</span>
              <span className="tool-version">v{tool.version}</span>
            </div>
            <div className="tool-id">{tool.id}</div>
            <p className="tool-desc">{tool.description}</p>
            {tool.params.length > 0 && (
              <div className="tool-params">
                <div className="params-label">Inputs</div>
                {tool.params.map(p => (
                  <div key={p.name} className="param-row">
                    <span className="param-name">{p.name}</span>
                    <span className="param-type">{p.type}</span>
                    {!p.required && <span className="param-opt">optional</span>}
                  </div>
                ))}
              </div>
            )}
            <div className="tool-tags">
              {tool.category && <span className="tag tag-meta">{tool.category}</span>}
              {tool.author   && <span className="tag tag-meta">{tool.author}</span>}
              {tool.tags.map(t => <span key={t} className="tag tag-blue">{t}</span>)}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── CodeBlock ──────────────────────────────────────────────────────────────────

function CodeBlock({ code, lang = 'python' }: { code: string; lang?: string }) {
  return (
    <div className="code-block">
      <div className="code-block-header">
        <span className="code-lang">{lang}</span>
      </div>
      <pre className="code-pre"><code>{code}</code></pre>
    </div>
  )
}

// ── HowToUsePage ───────────────────────────────────────────────────────────────

function HowToUsePage() {
  const [fwTab, setFwTab] = useState<'mistral' | 'ag2' | 'pydantic_ai'>('mistral')

  const SPEC_YAML = `kiln_version: "1.0"

tool:
  id: com.kiln.tools.weather
  name: get_weather
  version: 1.0.0
  description: "Get current weather conditions and temperature for any city worldwide."
  author: shekhar
  license: MIT

interface:
  inputs:
    - name: location
      type: string
      required: true
      description: "City name or coordinates, e.g. 'Singapore'"
    - name: units
      type: string
      required: false
      default: celsius
      enum: [celsius, fahrenheit]

  outputs:
    - name: temperature
      type: integer
      description: "Current temperature in the requested unit"
    - name: conditions
      type: string
      description: "Short weather conditions description"
    - name: success
      type: boolean

implementation:
  runtime: python3.10
  entrypoint: weather.py
  execution:
    timeout: 5000ms
    retries: 1

targets: [ag2, mistral, pydantic_ai, langchain]

testing:
  fixtures:
    - input:
        location: Singapore
      expected_output_contains: [temperature, conditions, success]
    - input:
        location: Tokyo
        units: fahrenheit
      expected_output_contains: [temperature, success]

metadata:
  tags: [weather, real-time]
  category: data`

  const MISTRAL_CODE = `from kiln_registry import KilnRuntime, get_global_registry
import kiln_shared.tools.core_tools  # side-effect: auto-registers pre-built tools

from mistralai import Mistral
import json

registry       = get_global_registry()
runtime        = KilnRuntime(target="mistral", registry=registry)
compiled_tools = runtime.get_all()
tool_map       = {t.name: t for t in compiled_tools}

client   = Mistral(api_key=api_key)
messages = [{"role": "user", "content": "What's the weather in Singapore?"}]

# Agentic loop — keeps calling tools until model produces a final answer
while True:
    response = client.chat.complete(
        model="mistral-large-latest",
        messages=messages,
        tools=[t.tool_def for t in compiled_tools],
        tool_choice="auto",
    )
    msg = response.choices[0].message
    messages.append(msg)

    if not msg.tool_calls:
        print(msg.content)   # Final text answer
        break

    for tc in msg.tool_calls:
        args   = json.loads(tc.function.arguments)
        result = tool_map[tc.function.name].call(args)
        messages.append({
            "role": "tool", "tool_call_id": tc.id,
            "name": tc.function.name, "content": json.dumps(result),
        })`

  const AG2_CODE = `from kiln_registry import KilnRuntime, get_global_registry
import kiln_shared.tools.core_tools  # side-effect: auto-registers pre-built tools

from autogen import AssistantAgent, UserProxyAgent

registry = get_global_registry()
runtime  = KilnRuntime(target="ag2", registry=registry)

llm_config = {
    "config_list": [{
        "model":    "mistral-large-latest",
        "api_key":  api_key,
        "api_type": "mistral",
    }],
    "cache_seed": None,
}

assistant = AssistantAgent(
    name="assistant",
    llm_config=llm_config,
    system_message=(
        "You are a helpful assistant. Use tools to answer. "
        "Reply TERMINATE when the task is fully complete."
    ),
    is_termination_msg=lambda m: "TERMINATE" in m.get("content", ""),
)
user_proxy = UserProxyAgent(
    name="user_proxy",
    human_input_mode="NEVER",
    max_consecutive_auto_reply=10,
    code_execution_config=False,
)

# Compile & register ALL Kiln tools with AG2 — one loop
for compiled in runtime.get_all():
    compiled.register(caller=assistant, executor=user_proxy)

# Run a multi-tool query in parallel (weather + currency)
user_proxy.initiate_chat(
    assistant,
    message="What's the weather in Singapore, and convert 500 SGD to EUR?",
    max_turns=10,
)`

  const PYDANTIC_CODE = `from kiln_registry import KilnRuntime, get_global_registry
import kiln_shared.tools.core_tools  # side-effect: auto-registers pre-built tools

from pydantic_ai import Agent
from pydantic_ai.models.mistral import MistralModel
from pydantic_ai.providers.mistral import MistralProvider

registry       = get_global_registry()
runtime        = KilnRuntime(target="pydantic_ai", registry=registry)
compiled_tools = runtime.get_all()
pai_tools      = [t.as_tool() for t in compiled_tools]

model = MistralModel(
    "mistral-large-latest",
    provider=MistralProvider(api_key=api_key),
)
agent = Agent(model, tools=pai_tools)

result = agent.run_sync(
    "Find an Italian restaurant near Marina Bay, then create a calendar event."
)

# Inspect the full tool-call trace from message history
for msg in result.all_messages():
    for part in getattr(msg, "parts", []):
        kind = getattr(part, "part_kind", None)
        if kind == "tool-call":
            args_raw = getattr(getattr(part, "args", ""), "args_dict", part.args)
            print(f"  → {part.tool_name}({args_raw})")
        elif kind == "tool-return":
            print(f"  ← {part.content}")

print(result.output)   # Final answer`

  const REGISTER_CODE = `from kiln_registry import kiln_tool, register, get_global_registry, KilnRuntime

# Define a new tool using the decorator — no YAML required
@kiln_tool(
    id="com.myorg.tools.stock_price",
    description=(
        "Fetch the current stock price for a given ticker symbol. "
        "Returns price, currency, and percentage change."
    ),
    tags=["finance", "stocks", "real-time"],
    category="finance",
    param_descriptions={
        "ticker":   "Stock ticker symbol, e.g. AAPL, TSLA, NVDA",
        "currency": "Currency for the returned price (default USD)",
    },
)
def stock_price(ticker: str, currency: str = "USD") -> dict:
    # Swap this mock for a live API (e.g. Yahoo Finance, Alpha Vantage)
    return {"ticker": ticker, "price": 182.50, "currency": currency, "success": True}

# One call — instantly available across ALL framework adapters
register(stock_price)

# Verify it's in the registry
registry = get_global_registry()
spec = registry.get("com.myorg.tools.stock_price").spec
print(f"Registered: {spec.id}  params={[p.name for p in spec.params]}")

# Use immediately — works with target="ag2" or "pydantic_ai" too
runtime  = KilnRuntime(target="mistral", registry=registry)
compiled = runtime.get("com.myorg.tools.stock_price")
result   = compiled.call({"ticker": "AAPL", "currency": "USD"})
print(result)`

  const LOADER_CODE = `from kiln_registry import KilnLoader, KilnRuntime, get_global_registry

loader = KilnLoader(auto_register=True)

# ── Validate spec against JSON Schema before loading ──────────────────────────
# KilnLoader raises jsonschema.ValidationError if the spec is invalid
# e.g. tool ID with spaces, description < 10 chars, missing required fields

# ── Run test fixtures (same check Vibe does before publishing) ────────────────
report = loader.test("registry/tools/com.kiln.tools.weather/1.0.0")
for r in report["results"]:
    status = "PASS" if r["passed"] else "FAIL"
    print(f"  Fixture {r['fixture']}: {status}")
print(f"  {report['passed']}/{report['passed'] + report['failed']} fixtures passed")

# ── Load a single tool from its directory (spec.yaml + impl.py) ──────────────
loader.load("registry/tools/com.kiln.tools.weather/1.0.0")

# ── Or scan and load every tool in the registry at once ──────────────────────
tools = loader.load_all("registry/tools")
print(f"Loaded {len(tools)} tools")
for t in tools:
    print(f"  {t.spec.id:<45} v{t.spec.version}")

# ── After loading, tools are in the registry — use with any adapter ──────────
runtime  = KilnRuntime(target="mistral", registry=get_global_registry())
compiled = runtime.get("com.kiln.tools.weather")
result   = compiled.call({"location": "Singapore"})`

  const FW_TABS: { key: 'mistral' | 'ag2' | 'pydantic_ai'; label: string; badge: string }[] = [
    { key: 'mistral',     label: 'Mistral',     badge: 'direct'  },
    { key: 'ag2',         label: 'AG2',          badge: 'autogen' },
    { key: 'pydantic_ai', label: 'Pydantic AI',  badge: 'agents'  },
  ]
  const FW_DESCS: Record<'mistral' | 'ag2' | 'pydantic_ai', string> = {
    mistral:     'Compile Kiln tools into Mistral JSON schema definitions. Inject via tools= in chat.complete() and run the agentic loop manually — full control over each step.',
    ag2:         'Compile Kiln tools into typed AG2 wrapper functions with correct inspect.signature() introspection. Register with register_function so AssistantAgent plans calls and UserProxyAgent executes them.',
    pydantic_ai: 'Compile Kiln tools into pydantic_ai.Tool objects via annotated wrapper functions that Pydantic AI introspects to generate the schema it sends to the model.',
  }
  const FW_CODES: Record<'mistral' | 'ag2' | 'pydantic_ai', string> = {
    mistral: MISTRAL_CODE, ag2: AG2_CODE, pydantic_ai: PYDANTIC_CODE,
  }

  const LIFECYCLE_STEPS = [
    { icon: '📝', label: 'spec.yaml', desc: 'Declare tool' },
    { icon: '✓',  label: 'Validate',  desc: 'JSON Schema' },
    { icon: '🧪', label: 'Test',      desc: 'Run fixtures' },
    { icon: '📦', label: 'Register',  desc: 'Into registry' },
    { icon: '⚡', label: 'Compile',   desc: 'To framework' },
    { icon: '🤖', label: 'Execute',   desc: 'Agent calls' },
  ]

  return (
    <div className="docs-page">

      {/* ── Hero ── */}
      <div className="docs-hero">
        <h1 className="docs-title">The Kiln Tool Standard</h1>
        <p className="docs-sub">
          Kiln is a universal tool specification layer for AI agents. Write a tool once — a YAML spec plus a Python function — and compile it instantly to any AI framework from a single source of truth.
        </p>
        <div className="docs-pills-row">
          {['Mistral', 'AG2 / AutoGen', 'Pydantic AI', 'LangChain'].map(f => (
            <span key={f} className="docs-fw-pill">{f}</span>
          ))}
        </div>
      </div>

      {/* ── Lifecycle ── */}
      <div className="docs-block">
        <div className="docs-block-title">Tool Lifecycle</div>
        <div className="lifecycle-flow">
          {LIFECYCLE_STEPS.map((step, i) => (
            <div key={step.label} className="lifecycle-flow-item">
              <div className="lifecycle-step">
                <div className="lifecycle-icon">{step.icon}</div>
                <div className="lifecycle-label">{step.label}</div>
                <div className="lifecycle-desc">{step.desc}</div>
              </div>
              {i < LIFECYCLE_STEPS.length - 1 && <div className="lifecycle-arrow">›</div>}
            </div>
          ))}
        </div>
      </div>

      {/* ── Step 1: YAML spec ── */}
      <div className="docs-block">
        <div className="docs-block-title">Step 1 — Write a Kiln Spec</div>
        <p className="docs-step-desc" style={{ marginBottom: 14 }}>
          Every Kiln tool starts with a <code className="inline-code">spec.yaml</code>. It declares the tool ID, inputs / outputs, implementation entrypoint, supported framework targets, and test fixtures — everything the compiler needs to generate bindings.
        </p>
        <CodeBlock code={SPEC_YAML} lang="yaml" />
        <div className="docs-note" style={{ marginTop: 12 }}>
          <strong>Convention:</strong> Tool IDs follow reverse-DNS notation — <code className="inline-code">com.org.tools.name</code>. The <code className="inline-code">targets</code> list controls which framework adapters are compiled. Add or remove targets without touching tool logic.
        </div>
      </div>

      {/* ── Step 2: Framework adapters ── */}
      <div className="docs-block">
        <div className="docs-block-title">Step 2 — Adapt to Any Framework</div>
        <p className="docs-step-desc" style={{ marginBottom: 14 }}>
          <code className="inline-code">KilnRuntime</code> compiles every registered tool into the right bindings for the chosen framework. Change <code className="inline-code">target=</code> and everything else stays the same — same tool IDs, same registry, same one-liner calls.
        </p>
        <div className="fw-tabs">
          {FW_TABS.map(t => (
            <button
              key={t.key}
              className={`fw-tab-btn${fwTab === t.key ? ' fw-tab-active' : ''}`}
              onClick={() => setFwTab(t.key)}
            >
              {t.label}
              <span className="fw-tab-badge">{t.badge}</span>
            </button>
          ))}
        </div>
        <p className="docs-step-desc fw-desc">{FW_DESCS[fwTab]}</p>
        <CodeBlock code={FW_CODES[fwTab]} lang="python" />
      </div>

      {/* ── Step 3: Register at runtime ── */}
      <div className="docs-block">
        <div className="docs-block-title">Step 3 — Register a New Tool at Runtime</div>
        <p className="docs-step-desc" style={{ marginBottom: 14 }}>
          Use the <code className="inline-code">@kiln_tool</code> decorator to define a tool in pure Python — no YAML required. One <code className="inline-code">register()</code> call makes it immediately available across all framework adapters without restarting the server.
        </p>
        <CodeBlock code={REGISTER_CODE} lang="python" />
        <div className="docs-three-col" style={{ marginTop: 14 }}>
          {[
            ['One definition', 'Write the function once — Kiln derives the JSON schema automatically from type annotations and param_descriptions.'],
            ['All adapters', 'After register(), use the same tool with Mistral, AG2, and Pydantic AI — no per-framework boilerplate.'],
            ['Persistent', 'Registered tools survive across queries. The synthesiser saves them to the registry so future runs skip synthesis entirely.'],
          ].map(([title, desc]) => (
            <div key={title} className="docs-feat-card">
              <div className="docs-feat-title">{title}</div>
              <div className="docs-feat-desc">{desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Step 4: Load from disk ── */}
      <div className="docs-block">
        <div className="docs-block-title">Step 4 — Load Tools from the Registry on Disk</div>
        <p className="docs-step-desc" style={{ marginBottom: 14 }}>
          <code className="inline-code">KilnLoader</code> validates a spec against the Kiln JSON Schema, runs test fixtures, and registers the tool — replicating exactly what the Vibe synthesiser does before publishing a generated tool.
        </p>
        <CodeBlock code={LOADER_CODE} lang="python" />
      </div>

      {/* ── Kiln end-to-end ── */}
      <div className="docs-block">
        <div className="docs-block-title">Using Kiln End-to-End</div>
        {[
          ['Type your question', 'Go to the Agent tab and ask anything. Kiln plans accordingly — simple queries get one agent; complex requests spawn a parallel task graph.'],
          ['Mistral plans the graph', 'KilnPlanner uses Mistral Large to decompose the request into a directed acyclic graph of agents, each assigned a role and a set of Kiln tools from the registry.'],
          ['Agents run in parallel', 'KilnGraphFlow executes the graph with AG2. Nodes without dependencies run concurrently; results flow downstream through edges. Watch the graph light up in real time.'],
          ['Missing tools are synthesised on the fly', 'If Kiln needs a capability not in the registry, Mistral Codestral Vibe generates the spec + implementation, registers it, and uses it — all within the same request.'],
          ['Synthesis node delivers the answer', 'The exit node combines all agent results into a final formatted answer rendered with Markdown.'],
        ].map(([title, desc], i) => (
          <div key={i} className="docs-step">
            <div className="docs-step-num">{i + 1}</div>
            <div>
              <div className="docs-step-title">{title}</div>
              <div className="docs-step-desc">{desc}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Example queries ── */}
      <div className="docs-block">
        <div className="docs-block-title">Example Queries to Try</div>
        <div className="docs-examples-grid">
          {EXAMPLES.map(ex => (
            <div key={ex.label} className="docs-example">
              <span className="docs-example-label">{ex.label}</span>
              <span className="docs-example-q">{ex.q}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Registry note ── */}
      <div className="docs-block">
        <div className="docs-block-title">The Tool Registry</div>
        <div className="docs-step">
          <div className="docs-step-num">›</div>
          <div>
            <div className="docs-step-title">Browse available tools</div>
            <div className="docs-step-desc">The Registry tab shows every tool Kiln can use — pre-built and synthesised. Search by name, ID, or description. Each card shows parameter types and metadata.</div>
          </div>
        </div>
        <div className="docs-step">
          <div className="docs-step-num">›</div>
          <div>
            <div className="docs-step-title">Tools grow over time</div>
            <div className="docs-step-desc">Every synthesised tool is saved to disk under <code className="inline-code">registry/tools/</code> and is available for all future queries. Re-run the same query after synthesis for faster, more accurate results.</div>
          </div>
        </div>
      </div>

      <div className="docs-note">
        <strong>Tip:</strong> If a query triggers synthesis, the missing tool banner will say "synthesising via Vibe Coder". Once done, simply re-run the same query — Kiln executes it directly from the registry without synthesis.
      </div>
    </div>
  )
}

// ── AboutPage ──────────────────────────────────────────────────────────────────

function AboutPage() {
  return (
    <div className="about-page">
      <div className="about-hero">
        <div className="about-logo">Kiln</div>
        <p className="about-tagline">An AI assistant that doesn't say "I can't do that" — it builds the tool and does it.</p>
        <span className="about-pill">Built in 48 hours · Mistral Hackathon</span>
      </div>

      <div className="about-cards">
        {[
          ['🧠', 'Adaptive by Design', 'When Kiln encounters a capability gap, Mistral Codestral Vibe synthesizes a new tool on the fly — spec, implementation, registration, and execution happen in a single request.'],
          ['⚡', 'Multi-Agent Execution', 'Every request is broken into a directed task graph. Nodes run in parallel where dependencies allow, each powered by an AG2 agent pair with Mistral Large.'],
          ['📦', 'Kiln Tool Standard', 'Every tool is described by a Kiln YAML spec. The compiler generates framework-native bindings for AG2, LangChain, and Pydantic-AI from one source of truth.'],
          ['🔭', 'Observable by Default', 'Every tool call, node transition, and synthesis event is streamed live and logged to W&B Weave with registry hit rate and full execution traces.'],
        ].map(([icon, title, body]) => (
          <div key={title as string} className="about-card">
            <span className="about-card-icon">{icon}</span>
            <div className="about-card-title">{title}</div>
            <div className="about-card-body">{body}</div>
          </div>
        ))}
      </div>

      <div className="about-team">
        <div className="docs-block-title">The Team</div>
        {[
          ['E1', 'e1', 'Voice & Planning', 'Voxtral STT · Intent Parser · Mistral Large · Graph Validator'],
          ['E2', 'e2', 'Kiln Tool Standard', 'Spec · Compiler · Registry · Runtime · CLI · Pre-built Tools'],
          ['E3', 'e3', 'Execution & Synthesis', 'AG2 GraphFlow · Mistral Vibe · W&B Weave Observability'],
          ['E4', 'e4', 'Frontend & Voice', 'React · AG-UI Event Stream · 11Labs TTS'],
        ].map(([badge, cls, role, tech]) => (
          <div key={badge as string} className="team-row">
            <span className={`team-badge badge-${cls}`}>{badge}</span>
            <div className="team-info">
              <div className="team-role">{role}</div>
              <div className="team-tech">{tech}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="about-footer">
        Powered by <strong>Mistral AI</strong> · <strong>AG2</strong> · <strong>Kiln</strong>
      </div>
    </div>
  )
}

// ── VibeStreamPanel ───────────────────────────────────────────────────────────

interface VibeLine {
  id: number
  stage: string
  message?: string
}

let _vibeLineId = 0

function VibeStreamPanel({ job }: { job: SynthesisJob }) {
  const [lines, setLines] = useState<VibeLine[]>([])
  const [done, setDone]   = useState(false)
  const endRef  = useRef<HTMLDivElement>(null)
  const closed  = useRef(false)

  useEffect(() => {
    closed.current = false
    const src = new EventSource(`/synthesis/events/synthesize/${job.job_id}/events`)

    function finish() {
      if (closed.current) return
      closed.current = true
      setDone(true)
      src.close()
    }

    src.onmessage = (e) => {
      if (closed.current) return
      const ev = JSON.parse(e.data)
      if (ev.stage === 'stream_closed') { finish(); return }
      if (ev.stage === 'done') {
        setLines(prev => [...prev, {
          id:      ++_vibeLineId,
          stage:   'done',
          message: ev.status === 'succeeded' ? `Tool ${ev.tool_id || ''} registered` : ev.error || 'finished',
        }])
        finish()
        return
      }
      const stage = ev.stage || ev.role || ev.type || ''
      const message = ev.message || ev.content || ''
      if (stage || message) {
        setLines(prev => [...prev, { id: ++_vibeLineId, stage, message }])
      }
    }

    src.onerror = () => finish()

    return () => { closed.current = true; src.close() }
  }, [job.job_id])


  const toolName = job.tool_id.split('.').pop() ?? job.tool_id

  return (
    <div className={`vibe-panel${done ? ' vibe-panel-done' : ''}`}>
      <div className="vibe-panel-header">
        <span className="vibe-panel-title">
          <span className={`vibe-mascot${done ? ' vibe-mascot-done' : ''}`}>{done ? '🏁' : '⚒️'}</span>
          Synthesizing <span className="vibe-tool-name">{toolName}</span>
        </span>
        <span className={`vibe-status-badge${done ? ' vibe-status-done' : ' vibe-status-active'}`}>
          {done ? 'done' : <><span className="spinner vibe-spinner" /> building</>}
        </span>
      </div>
      <div className="vibe-body">
        <div className="vibe-log">
          {lines.map(l => (
            <div key={l.id} className="vibe-log-entry">
              <span className="vibe-stage">{l.stage}</span>
              {l.message && <span className="vibe-msg">{l.message}</span>}
            </div>
          ))}
          <div ref={endRef} />
        </div>
        <div className={`vibe-pixel-art${done ? ' vibe-pixel-art-done' : ''}`}>
          <div className="pixel-char">
            <div className="pixel-head" />
            <div className="pixel-body-part" />
            <div className="pixel-legs">
              <div className="pixel-leg pixel-leg-l" />
              <div className="pixel-leg pixel-leg-r" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Spinner ────────────────────────────────────────────────────────────────────

function Spinner() { return <span className="spinner" /> }

// ── App ────────────────────────────────────────────────────────────────────────

type View = 'kiln' | 'tools' | 'howto' | 'about'

export default function App() {
  const [view, setView]         = useState<View>('kiln')
  const [dark, setDark]         = useState(true)
  const [state, dispatch]       = useReducer(reducer, initial)
  const [query, setQuery]       = useState('')
  const srcRef                  = useRef<EventSource | null>(null)
  const runIdRef                = useRef<string>('')
  const [missingEnvs, setMissingEnvs]     = useState<MissingEnv[]>([])
  const [envValues, setEnvValues]         = useState<Record<string, string>>({})
  const [synthesisJobs, setSynthesisJobs] = useState<SynthesisJob[]>([])
  const [audioUrls, setAudioUrls]         = useState<string[]>([])

  // Auth: safely get JWT token (works even without ClerkProvider)
  const clerkAuth = (() => {
    try { return useAuth() } catch { return null }
  })()
  const isSignedIn = clerkAuth?.isSignedIn ?? false

  const authFetch = useCallback(async (url: string, options: RequestInit = {}) => {
    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string> || {}),
    }
    try {
      const token = clerkAuth ? await clerkAuth.getToken() : null
      if (token) {
        headers['Authorization'] = `Bearer ${token}`
      }
    } catch { /* Clerk not configured — proceed without auth */ }
    return fetch(url, { ...options, headers })
  }, [clerkAuth])

  // Sync theme to <html> so body background also responds to light/dark
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
  }, [dark])

  // Cleanup EventSource on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      srcRef.current?.close()
    }
  }, [])

  const isRunning = state.phase === 'planning' || state.phase === 'running'
  const isActive  = state.phase !== 'idle'

  function connectStream(run_id: string) {
    srcRef.current?.close()
    const src = new EventSource(`/kiln/stream/${run_id}`)
    srcRef.current = src
    src.onmessage = (e) => {
      const ev = JSON.parse(e.data)
      if (ev.type === 'plan_ready' || ev.type === 'plan_updated') {
        const order = [...ev.nodes.map((n: NodeDef) => n.id).filter((id: string) => id !== ev.exit_node), ev.exit_node]
        dispatch({ type: 'PLAN_READY', payload: { nodes: ev.nodes, order, exit_node: ev.exit_node, missing_tools: ev.missing_tools || [] } })
      } else if (ev.type === 'node_start')    { dispatch({ type: 'NODE_START',    payload: { node_id: ev.node_id } })
      } else if (ev.type === 'tool_call')     { dispatch({ type: 'TOOL_CALL',     payload: { node_id: ev.node_id, tool: ev.tool, args: ev.args } })
      } else if (ev.type === 'tool_result')   {
        dispatch({ type: 'TOOL_RESULT', payload: { node_id: ev.node_id, tool: ev.tool, result: ev.result } })
        // Detect audio file paths in tool results
        const r = ev.result as Record<string, unknown> | undefined
        if (r && typeof r === 'object') {
          const fp = (r.file_path || r.audio_path || r.output_path) as string | undefined
          if (fp && /\.(mp3|wav|ogg|flac)$/i.test(fp)) {
            setAudioUrls(prev => [...prev, `/audio?path=${encodeURIComponent(fp)}`])
          }
        }
      } else if (ev.type === 'node_retry')    { dispatch({ type: 'NODE_RETRY',    payload: { node_id: ev.node_id, reason: ev.reason } })
      } else if (ev.type === 'node_complete') { dispatch({ type: 'NODE_COMPLETE', payload: { node_id: ev.node_id, result: ev.result } })
      } else if (ev.type === 'flow_complete') { dispatch({ type: 'FLOW_COMPLETE', payload: { final_answer: ev.final_answer } }); src.close()
      } else if (ev.type === 'error')         { dispatch({ type: 'ERROR',         payload: { message: ev.message } }); src.close() }
    }
    src.onerror = () => {
      if (state.phase !== 'complete') dispatch({ type: 'ERROR', payload: { message: 'Stream connection lost' } })
      src.close()
    }
  }

  async function submit(e?: React.FormEvent) {
    e?.preventDefault()
    if (!query.trim() || isRunning) return
    srcRef.current?.close()
    dispatch({ type: 'RESET' }); dispatch({ type: 'PLANNING' })
    setMissingEnvs([]); setEnvValues({}); setSynthesisJobs([]); setAudioUrls([])
    try {
      const res = await authFetch('/kiln/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request: query }) })
      if (!res.ok) { const err = await res.json(); dispatch({ type: 'ERROR', payload: { message: err.detail || 'Server error' } }); return }
      const data = await res.json()
      runIdRef.current = data.run_id
      if (data.synthesis_jobs?.length) setSynthesisJobs(data.synthesis_jobs)
      if (data.status === 'needs_config') {
        const plan = data.plan
        const order = [...plan.nodes.map((n: NodeDef) => n.id).filter((id: string) => id !== plan.exit_node), plan.exit_node]
        dispatch({ type: 'PLAN_READY', payload: { nodes: plan.nodes, order, exit_node: plan.exit_node, missing_tools: plan.missing_tools || [] } })
        dispatch({ type: 'NEEDS_CONFIG' }); setMissingEnvs(data.missing_envs)
      } else { connectStream(data.run_id) }
    } catch (err) { dispatch({ type: 'ERROR', payload: { message: String(err) } }) }
  }

  async function executeWithEnv() {
    const run_id = runIdRef.current; if (!run_id) return
    dispatch({ type: 'PLANNING' })
    try {
      const res = await authFetch(`/kiln/execute/${run_id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ env_vars: envValues }) })
      if (!res.ok) { const err = await res.json(); dispatch({ type: 'ERROR', payload: { message: err.detail || 'Server error' } }); return }
      connectStream(run_id)
    } catch (err) { dispatch({ type: 'ERROR', payload: { message: String(err) } }) }
  }

  const NAV: { key: View; label: string }[] = [
    { key: 'kiln',  label: 'Agent' },
    { key: 'tools', label: 'Registry' },
    { key: 'howto', label: 'How to Use' },
    { key: 'about', label: 'About' },
  ]

  return (
    <div className="app" data-theme={dark ? 'dark' : 'light'}>
      {/* ── Header ── */}
      <header className="app-header">
        <div className="header-brand">
          <span className="aria-logo">Kiln</span>
          <span className="header-sep" />
          <span className="header-sub">Self-Evolving Tool Registry</span>
        </div>
        <nav className="app-nav">
          {NAV.map(n => (
            <button key={n.key} className={`nav-btn${view === n.key ? ' nav-active' : ''}`} onClick={() => setView(n.key)}>
              {n.label}
            </button>
          ))}
        </nav>
        <div className="header-right">
          <span className="powered-badge">Kiln · Mistral · AG2</span>
          <button className="theme-toggle" onClick={() => setDark(d => !d)} title="Toggle theme">
            {dark ? '☀' : '☾'}
          </button>
          {isSignedIn && <UserButton afterSignOutUrl="/" />}
        </div>
      </header>

      {/* ── Pages ── */}
      {view === 'tools' && <main className="app-main"><ToolsPage /></main>}
      {view === 'howto' && <main className="app-main"><HowToUsePage /></main>}
      {view === 'about' && <main className="app-main"><AboutPage /></main>}

      {view === 'kiln' && (
        <main className="app-main">
          {/* Auth gate for chat — sign in required to run queries */}
          <SignedOut>
            <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem 0' }}>
              <SignIn routing="hash" />
            </div>
          </SignedOut>
          <SignedIn>
          {/* Query bar — always on top */}
          <form onSubmit={submit} className="query-form">
            <input
              className="query-input"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Ask Kiln anything — e.g. Get the latest Bitcoin price and predict tomorrow's trend"
              disabled={isRunning}
            />
            {isActive && (
              <button type="button" className="btn-ghost" onClick={() => { dispatch({ type: 'RESET' }); setQuery(''); setSynthesisJobs([]) }}>
                Clear
              </button>
            )}
            <button className="btn-primary" type="submit" disabled={isRunning || !query.trim()}>
              {isRunning ? <><Spinner /> Running</> : 'Run →'}
            </button>
          </form>

          {/* Idle state */}
          {state.phase === 'idle' && <IdleLanding onSelect={q => { setQuery(q) }} />}

          {/* Missing tools banner */}
          {state.missingTools.length > 0 && (
            <div className="banner-warn">
              <span className="banner-icon">⚠</span>
              <span className="banner-label">Missing tools:</span>
              {state.missingTools.map(t => <span key={t.id} className="tool-chip">{t.id.split('.').pop()}</span>)}
              <span className="banner-status">
                {synthesisJobs.length > 0
                  ? `⟳ Synthesizing ${synthesisJobs.length} tool${synthesisJobs.length > 1 ? 's' : ''} via Vibe Coder — re-run this query when done`
                  : 'Start Vibe Coder to auto-build these tools'}
              </span>
            </div>
          )}

          {/* Vibe synthesis streams */}
          {synthesisJobs.map(job => (
            <VibeStreamPanel key={job.job_id} job={job} />
          ))}

          {/* Task graph */}
          <GraphView state={state} />

          {/* Config panel */}
          {state.phase === 'config' && missingEnvs.length > 0 && (
            <EnvConfigPanel missing={missingEnvs} values={envValues}
              onChange={(k, v) => setEnvValues(prev => ({ ...prev, [k]: v }))} onSubmit={executeWithEnv} />
          )}

          {/* Log + Answer row */}
          {(state.logs.length > 0 || state.phase === 'complete' || state.phase === 'error') && (
            <div className="results-row">
              <StreamLog logs={state.logs} />
              {(state.phase === 'complete' || state.phase === 'error') && (
                <section className="panel">
                  <div className="section-label">{state.phase === 'complete' ? 'Final Answer' : 'Error'}</div>
                  <div className={`answer-box${state.phase === 'error' ? ' answer-error' : ''}`}>
                    {state.phase === 'complete' ? <Markdown text={state.finalAnswer} /> : state.error}
                  </div>
                  {audioUrls.length > 0 && (
                    <div className="audio-player-section">
                      {audioUrls.map((url, i) => (
                        <div key={i} className="audio-player-row">
                          <span className="audio-label">Generated Audio {audioUrls.length > 1 ? `#${i + 1}` : ''}</span>
                          <audio controls src={url} className="audio-player" />
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              )}
            </div>
          )}
          </SignedIn>
        </main>
      )}
    </div>
  )
}
