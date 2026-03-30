import { SignedIn, SignedOut, SignIn, UserButton, useAuth } from '@clerk/clerk-react'
import { useReducer, useRef, useEffect, useState, useCallback, useMemo } from 'react'
import type { ReactNode } from 'react'
import {
  Sun, Moon, Play, Search, RefreshCw, ChevronRight,
  CheckCircle2, Loader2, AlertTriangle, Zap, Brain,
  Package, Bot, ArrowRight, Hash, Code2, BookOpen,
  Info,
} from 'lucide-react'

import { FullScreen } from '@openuidev/react-ui'
import { EventType } from '@openuidev/react-headless'
import type { AssistantMessage, Message } from '@openuidev/react-headless'
import '@openuidev/react-ui/dist/styles/openui-defaults.css'
import '@openuidev/react-ui/dist/styles/index.css'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'

// ── Safe Clerk auth hook ──────────────────────────────────────────────────────
// ClerkProvider may not be present (e.g. local dev without Clerk key).
// Auth context that works with or without Clerk
const CLERK_ENABLED = !!import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

// Stub for when Clerk is not configured
const AUTH_STUB = { getToken: async () => null as string | null, isSignedIn: false } as const

function useKilnAuth() {
  // Always call useAuth when Clerk is enabled (hook order is stable since
  // CLERK_ENABLED is a module-level constant that never changes between renders)
  const clerkAuth = CLERK_ENABLED ? useAuth() : null // eslint-disable-line react-hooks/rules-of-hooks
  if (!clerkAuth) return AUTH_STUB
  return { getToken: clerkAuth.getToken, isSignedIn: clerkAuth.isSignedIn ?? false }
}

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
    .replace(/`(.+?)`/g, '<code class="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-blue-300 dark:text-blue-300">$1</code>')
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
      <Tag key={`list-${startIdx}`} className={isOrdered ? 'list-decimal pl-5 mb-2.5' : 'list-disc pl-5 mb-2.5'}>
        {items.map((it, j) => (
          <li key={j} className="mb-1">
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
      const headingClasses: Record<number, string> = {
        1: 'text-xl font-bold text-foreground mt-3.5 mb-1.5 first:mt-0',
        2: 'text-lg font-bold text-foreground mt-3.5 mb-1.5 first:mt-0',
        3: 'text-base font-bold text-foreground mt-3.5 mb-1.5 first:mt-0',
        4: 'text-sm font-bold text-foreground mt-3.5 mb-1.5 first:mt-0',
        5: 'text-[13px] font-bold text-foreground mt-3.5 mb-1.5 first:mt-0',
        6: 'text-xs font-bold text-muted-foreground mt-3.5 mb-1.5 first:mt-0',
      }
      const cls = headingClasses[hMatch[1].length] || headingClasses[6]
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
      out.push(<hr key={i} className="border-t border-border my-3" />)
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
    out.push(<p key={i} className="mb-2.5 last:mb-0" dangerouslySetInnerHTML={{ __html: inlineMd(line) }} />)
    i++
  }
  return <>{out}</>
}

// ── NodeCard ───────────────────────────────────────────────────────────────────

function NodeCard({ node, isExit }: { node: NodeState; isExit: boolean }) {
  const statusBorderClass = {
    pending: 'ring-border',
    running: 'ring-blue-500 shadow-[0_0_0_3px_rgba(59,130,246,0.18),0_4px_24px_rgba(59,130,246,0.08)]',
    complete: 'ring-emerald-500/40',
  }[node.status]

  const indicatorBg = {
    pending: 'bg-muted',
    running: 'bg-blue-500/20 text-blue-500',
    complete: 'bg-emerald-500/15 text-emerald-500',
  }[node.status]

  const pillVariant = {
    pending: 'bg-muted text-muted-foreground',
    running: 'bg-blue-500/20 text-blue-500',
    complete: 'bg-emerald-500/15 text-emerald-500',
  }[node.status]

  return (
    <Card
      size="sm"
      className={cn(
        'w-[260px] shrink-0 ring-1 transition-all duration-300',
        statusBorderClass,
        isExit && 'border-dashed'
      )}
    >
      <CardHeader className="gap-0 pb-0">
        <div className="flex items-center gap-2">
          {/* Status indicator circle */}
          <div className={cn('relative flex h-5 w-5 shrink-0 items-center justify-center rounded-full', indicatorBg)}>
            {node.status === 'running' && (
              <>
                <span className="absolute inset-[-4px] animate-ping rounded-full border-[1.5px] border-blue-500 opacity-30" />
                <Loader2 className="h-3 w-3 animate-spin" />
              </>
            )}
            {node.status === 'complete' && (
              <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 5.5L4 7.5L8 3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
            )}
            {node.status === 'pending' && (
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50" />
            )}
          </div>
          <span className="flex-1 truncate text-[13px] font-semibold text-foreground">{node.role}</span>
          {isExit && (
            <Badge variant="secondary" className="border border-purple-500/30 bg-purple-500/15 text-[10px] font-bold tracking-wide text-purple-400">
              SYNTHESIS
            </Badge>
          )}
          <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider', pillVariant)}>
            {node.status}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-2.5 pt-0">
        <div className="font-mono text-[11px] text-muted-foreground">{node.id}</div>
        {node.tools.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {node.tools.map(t => (
              <span key={t} className="rounded border border-blue-500/20 bg-blue-500/10 px-2 py-0.5 font-mono text-[10px] text-blue-300">
                {t.split('.').pop()}
              </span>
            ))}
          </div>
        )}
        {node.toolCalls.length > 0 && (
          <div className="space-y-0.5 rounded-md border border-border bg-background p-2">
            {node.toolCalls.map((c, i) => (
              <div key={i} className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
                <ChevronRight className="h-2.5 w-2.5 shrink-0 text-blue-500" />
                <span className="flex-1 text-foreground/70">{c.tool}</span>
                {c.result !== undefined && <CheckCircle2 className="h-2.5 w-2.5 text-emerald-500" />}
              </div>
            ))}
          </div>
        )}
        {node.result && (
          <div className="border-t border-border pt-2 text-[11px] italic leading-relaxed text-emerald-300">
            {node.result.replace(/\*\*/g, '').slice(0, 140)}{node.result.length > 140 ? '...' : ''}
          </div>
        )}
      </CardContent>
    </Card>
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

  const phaseBadgeClass = {
    planning: 'bg-amber-500/15 text-amber-500',
    running:  'bg-blue-500/20 text-blue-500',
    complete: 'bg-emerald-500/15 text-emerald-500',
  }[phase]

  return (
    <section className="flex flex-col">
      <div className="mb-2.5 flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Task Graph</span>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[11px] font-semibold text-muted-foreground">
            {doneCount}/{totalCount} done
          </Badge>
          {runningCount > 0 && (
            <Badge variant="outline" className="flex items-center gap-1.5 border-blue-500/30 bg-blue-500/20 text-[11px] font-semibold text-blue-500">
              <Loader2 className="h-2 w-2 animate-spin" />
              {runningCount} running
            </Badge>
          )}
          <span className={cn('rounded px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider', phaseBadgeClass)}>
            {phase}
          </span>
        </div>
      </div>
      <div className="flex items-stretch overflow-x-auto py-1 pb-3">
        {entries.length > 0 && (
          <div className="flex shrink-0 flex-col gap-2.5">
            {entries.map(id => <NodeCard key={id} node={nodes[id]} isExit={false} />)}
          </div>
        )}
        {exit && (
          <>
            <div className="flex shrink-0 items-center gap-0 px-1">
              <div className="flex w-6 shrink-0 flex-col items-end justify-center">
                <svg className="block shrink-0" width="24" height="20" viewBox="0 0 24 20" fill="none">
                  <path d="M0 20C0 9 12 0 24 0" stroke="currentColor" className="text-border" strokeWidth="1.5" strokeDasharray="4 2"/>
                </svg>
                <div className="min-h-3 w-[1.5px] flex-1 self-end bg-[repeating-linear-gradient(to_bottom,currentColor_0px,currentColor_4px,transparent_4px,transparent_6px)] text-border" />
                <svg className="block shrink-0" width="24" height="20" viewBox="0 0 24 20" fill="none">
                  <path d="M0 0C0 11 12 20 24 20" stroke="currentColor" className="text-border" strokeWidth="1.5" strokeDasharray="4 2"/>
                </svg>
              </div>
              <div className="flex shrink-0 items-center px-1.5">
                <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                  <circle cx="14" cy="14" r="13" stroke="currentColor" className="text-border" strokeWidth="1"/>
                  <path d="M11 9L17 14L11 19" stroke="currentColor" className="text-border" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
            </div>
            <div className="flex shrink-0 items-center">
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
    <Card className="border-blue-500/30">
      <CardHeader>
        <CardTitle className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          API Keys Required
        </CardTitle>
        <CardDescription className="text-[13px] leading-relaxed">
          These credentials are sent only to your local KilnServer and never stored.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {missing.map(ev => (
          <div key={ev.var_name} className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[13px] font-semibold text-blue-300">{ev.var_name}</span>
              <Badge variant="secondary" className="border border-amber-500/30 bg-amber-500/15 text-[10px] text-amber-500">
                {ev.tool_id.split('.').pop()}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">{ev.description}</p>
            <Input
              type="password"
              placeholder={`Enter ${ev.var_name}`}
              value={values[ev.var_name] || ''}
              onChange={e => onChange(ev.var_name, e.target.value)}
              autoComplete="off"
              className="h-10 bg-background font-mono text-[13px]"
            />
          </div>
        ))}
        <Button onClick={onSubmit} disabled={!allFilled} size="lg" className="mt-2 gap-1.5">
          Continue <ArrowRight className="h-4 w-4" />
        </Button>
      </CardContent>
    </Card>
  )
}

// ── StreamLog ──────────────────────────────────────────────────────────────────

const LOG_TAG_COLORS: Record<string, string> = {
  plan: 'text-purple-400',
  node_start: 'text-blue-400',
  node_retry: 'text-amber-400',
  tool_call: 'text-yellow-400',
  tool_result: 'text-emerald-400',
  node_complete: 'text-emerald-300',
  flow_complete: 'text-purple-400',
  error: 'text-destructive',
}

function StreamLog({ logs }: { logs: LogEntry[] }) {
  const endRef = useRef<HTMLDivElement>(null)
  if (logs.length === 0) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          Execution Log
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="max-h-[360px] rounded-lg border border-border bg-background p-3">
          <div className="font-mono text-[11px] leading-[1.7]">
            {logs.map(e => (
              <div key={e.id} className="flex gap-2 py-px">
                <span className={cn('w-24 shrink-0 font-semibold', LOG_TAG_COLORS[e.type] || 'text-muted-foreground')}>
                  {e.type}
                </span>
                {e.node_id && <span className="max-w-[130px] shrink-0 truncate text-blue-400">[{e.node_id}]</span>}
                <span className="break-all text-muted-foreground">{e.text}</span>
              </div>
            ))}
            <div ref={endRef} />
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
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

  if (loading) return (
    <div className="flex items-center justify-center gap-3 py-20 text-sm text-muted-foreground">
      <Skeleton className="h-4 w-4 rounded-full" />
      Loading tools...
    </div>
  )
  if (error) return <div className="flex items-center justify-center py-20 text-sm text-destructive">{error}</div>

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="whitespace-nowrap text-[13px] text-muted-foreground">{tools.length} tools registered</span>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search tools..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-8 w-[220px] pl-8 text-[13px]"
            />
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={fetchTools} className="gap-1.5">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </Button>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(290px,1fr))] gap-3.5">
        {filtered.map(tool => (
          <Card key={tool.id} className="transition-all hover:-translate-y-0.5 hover:border-blue-500 hover:shadow-lg">
            <CardHeader className="pb-0">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-sm font-bold text-foreground">{tool.name}</span>
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">v{tool.version}</span>
              </div>
              <div className="font-mono text-[10px] text-muted-foreground">{tool.id}</div>
            </CardHeader>
            <CardContent className="space-y-2.5">
              <p className="text-xs leading-relaxed text-muted-foreground">{tool.description}</p>
              {tool.params.length > 0 && (
                <div className="flex flex-col gap-1.5 rounded-md bg-background p-2.5">
                  <span className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Inputs</span>
                  {tool.params.map(p => (
                    <div key={p.name} className="flex items-center gap-2 text-[11px]">
                      <span className="font-mono text-blue-300">{p.name}</span>
                      <span className="font-mono text-yellow-400">{p.type}</span>
                      {!p.required && <span className="text-[10px] text-muted-foreground">optional</span>}
                    </div>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap gap-1.5">
                {tool.category && (
                  <Badge variant="outline" className="text-[10px]">{tool.category}</Badge>
                )}
                {tool.author && (
                  <Badge variant="outline" className="text-[10px]">{tool.author}</Badge>
                )}
                {tool.tags.map(t => (
                  <Badge key={t} variant="secondary" className="border border-blue-500/20 bg-blue-500/10 text-[10px] text-blue-300">
                    {t}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

// ── CodeBlock ──────────────────────────────────────────────────────────────────

function CodeBlock({ code, lang = 'python' }: { code: string; lang?: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex items-center justify-between border-b border-border bg-card px-3.5 py-2">
        <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{lang}</span>
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-xs leading-[1.7] text-foreground"><code>{code}</code></pre>
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
    { icon: Code2,    label: 'spec.yaml', desc: 'Declare tool' },
    { icon: CheckCircle2, label: 'Validate',  desc: 'JSON Schema' },
    { icon: Hash,     label: 'Test',      desc: 'Run fixtures' },
    { icon: Package,  label: 'Register',  desc: 'Into registry' },
    { icon: Zap,      label: 'Compile',   desc: 'To framework' },
    { icon: Bot,      label: 'Execute',   desc: 'Agent calls' },
  ]

  return (
    <div className="flex w-full flex-col gap-8">

      {/* Hero */}
      <div className="flex flex-col gap-3">
        <h1 className="bg-gradient-to-br from-blue-400 to-purple-400 bg-clip-text text-[28px] font-extrabold text-transparent">
          The Kiln Tool Standard
        </h1>
        <p className="text-[15px] leading-[1.7] text-muted-foreground">
          Kiln is a universal tool specification layer for AI agents. Write a tool once — a YAML spec plus a Python function — and compile it instantly to any AI framework from a single source of truth.
        </p>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {['Mistral', 'AG2 / AutoGen', 'Pydantic AI', 'LangChain'].map(f => (
            <Badge key={f} variant="secondary" className="border border-blue-500/30 bg-blue-500/20 px-3 py-0.5 text-xs font-semibold text-blue-500">
              {f}
            </Badge>
          ))}
        </div>
      </div>

      {/* Lifecycle */}
      <div className="flex flex-col gap-3.5">
        <div className="border-b border-border pb-2 text-[13px] font-bold uppercase tracking-widest text-blue-500">
          Tool Lifecycle
        </div>
        <div className="flex flex-wrap items-start gap-1">
          {LIFECYCLE_STEPS.map((step, i) => (
            <div key={step.label} className="flex items-center gap-1">
              <div className="flex min-w-[80px] flex-col items-center gap-1 rounded-lg border border-border bg-card p-2.5 text-center">
                <step.icon className="h-[18px] w-[18px] text-muted-foreground" />
                <span className="text-[11px] font-bold text-foreground">{step.label}</span>
                <span className="text-[10px] text-muted-foreground">{step.desc}</span>
              </div>
              {i < LIFECYCLE_STEPS.length - 1 && <ChevronRight className="h-4 w-4 shrink-0 text-border" />}
            </div>
          ))}
        </div>
      </div>

      {/* Step 1: YAML spec */}
      <div className="flex flex-col gap-3.5">
        <div className="border-b border-border pb-2 text-[13px] font-bold uppercase tracking-widest text-blue-500">
          Step 1 — Write a Kiln Spec
        </div>
        <p className="mb-1 text-[13px] leading-relaxed text-muted-foreground">
          Every Kiln tool starts with a <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-blue-300">spec.yaml</code>. It declares the tool ID, inputs / outputs, implementation entrypoint, supported framework targets, and test fixtures — everything the compiler needs to generate bindings.
        </p>
        <CodeBlock code={SPEC_YAML} lang="yaml" />
        <div className="mt-1 rounded-lg border border-blue-500/20 bg-blue-500/5 p-3.5 text-[13px] leading-relaxed text-muted-foreground">
          <strong className="text-blue-500">Convention:</strong> Tool IDs follow reverse-DNS notation — <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-blue-300">com.org.tools.name</code>. The <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-blue-300">targets</code> list controls which framework adapters are compiled. Add or remove targets without touching tool logic.
        </div>
      </div>

      {/* Step 2: Framework adapters */}
      <div className="flex flex-col gap-3.5">
        <div className="border-b border-border pb-2 text-[13px] font-bold uppercase tracking-widest text-blue-500">
          Step 2 — Adapt to Any Framework
        </div>
        <p className="mb-1 text-[13px] leading-relaxed text-muted-foreground">
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-blue-300">KilnRuntime</code> compiles every registered tool into the right bindings for the chosen framework. Change <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-blue-300">target=</code> and everything else stays the same — same tool IDs, same registry, same one-liner calls.
        </p>
        <div className="mb-1 flex flex-wrap gap-1.5">
          {FW_TABS.map(t => (
            <button
              key={t.key}
              className={cn(
                'flex items-center gap-1.5 rounded-md border border-border bg-card px-3.5 py-1.5 text-[13px] font-semibold transition-all',
                fwTab === t.key
                  ? 'border-blue-500/50 bg-blue-500/20 text-blue-500'
                  : 'text-muted-foreground hover:border-blue-500 hover:text-foreground'
              )}
              onClick={() => setFwTab(t.key)}
            >
              {t.label}
              <span className={cn(
                'rounded border border-border bg-background px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide',
                fwTab === t.key ? 'border-blue-500/30 text-blue-500' : 'text-muted-foreground'
              )}>
                {t.badge}
              </span>
            </button>
          ))}
        </div>
        <p className="my-1 text-[13px] leading-relaxed text-muted-foreground">{FW_DESCS[fwTab]}</p>
        <CodeBlock code={FW_CODES[fwTab]} lang="python" />
      </div>

      {/* Step 3: Register at runtime */}
      <div className="flex flex-col gap-3.5">
        <div className="border-b border-border pb-2 text-[13px] font-bold uppercase tracking-widest text-blue-500">
          Step 3 — Register a New Tool at Runtime
        </div>
        <p className="mb-1 text-[13px] leading-relaxed text-muted-foreground">
          Use the <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-blue-300">@kiln_tool</code> decorator to define a tool in pure Python — no YAML required. One <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-blue-300">register()</code> call makes it immediately available across all framework adapters without restarting the server.
        </p>
        <CodeBlock code={REGISTER_CODE} lang="python" />
        <div className="mt-1 grid grid-cols-3 gap-3 max-sm:grid-cols-1">
          {[
            ['One definition', 'Write the function once — Kiln derives the JSON schema automatically from type annotations and param_descriptions.'],
            ['All adapters', 'After register(), use the same tool with Mistral, AG2, and Pydantic AI — no per-framework boilerplate.'],
            ['Persistent', 'Registered tools survive across queries. The synthesiser saves them to the registry so future runs skip synthesis entirely.'],
          ].map(([title, desc]) => (
            <Card key={title}>
              <CardContent className="pt-3.5">
                <div className="text-[13px] font-bold text-foreground">{title}</div>
                <div className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{desc}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Step 4: Load from disk */}
      <div className="flex flex-col gap-3.5">
        <div className="border-b border-border pb-2 text-[13px] font-bold uppercase tracking-widest text-blue-500">
          Step 4 — Load Tools from the Registry on Disk
        </div>
        <p className="mb-1 text-[13px] leading-relaxed text-muted-foreground">
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-blue-300">KilnLoader</code> validates a spec against the Kiln JSON Schema, runs test fixtures, and registers the tool — replicating exactly what the Vibe synthesiser does before publishing a generated tool.
        </p>
        <CodeBlock code={LOADER_CODE} lang="python" />
      </div>

      {/* Kiln end-to-end */}
      <div className="flex flex-col gap-3.5">
        <div className="border-b border-border pb-2 text-[13px] font-bold uppercase tracking-widest text-blue-500">
          Using Kiln End-to-End
        </div>
        {[
          ['Type your question', 'Go to the Agent tab and ask anything. Kiln plans accordingly — simple queries get one agent; complex requests spawn a parallel task graph.'],
          ['Mistral plans the graph', 'KilnPlanner uses Mistral Large to decompose the request into a directed acyclic graph of agents, each assigned a role and a set of Kiln tools from the registry.'],
          ['Agents run in parallel', 'KilnGraphFlow executes the graph with AG2. Nodes without dependencies run concurrently; results flow downstream through edges. Watch the graph light up in real time.'],
          ['Missing tools are synthesised on the fly', 'If Kiln needs a capability not in the registry, Mistral Codestral Vibe generates the spec + implementation, registers it, and uses it — all within the same request.'],
          ['Synthesis node delivers the answer', 'The exit node combines all agent results into a final formatted answer rendered with Markdown.'],
        ].map(([title, desc], i) => (
          <div key={i} className="flex gap-4 items-start">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-blue-500/40 bg-blue-500/20 text-xs font-bold text-blue-500">
              {i + 1}
            </div>
            <div>
              <div className="mb-1 text-sm font-semibold text-foreground">{title}</div>
              <div className="text-[13px] leading-relaxed text-muted-foreground">{desc}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Example queries */}
      <div className="flex flex-col gap-3.5">
        <div className="border-b border-border pb-2 text-[13px] font-bold uppercase tracking-widest text-blue-500">
          Example Queries to Try
        </div>
        <div className="grid grid-cols-2 gap-2.5 max-sm:grid-cols-1">
          {EXAMPLES.map(ex => (
            <div key={ex.label} className="flex flex-col gap-1.5 rounded-lg border border-border bg-card p-3.5 text-[13px] leading-relaxed text-muted-foreground transition-colors hover:border-blue-500 hover:text-foreground">
              <span className="text-[10px] font-bold uppercase tracking-wider text-blue-500">{ex.label}</span>
              <span className="text-xs leading-relaxed text-muted-foreground">{ex.q}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Registry note */}
      <div className="flex flex-col gap-3.5">
        <div className="border-b border-border pb-2 text-[13px] font-bold uppercase tracking-widest text-blue-500">
          The Tool Registry
        </div>
        <div className="flex gap-4 items-start">
          <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-blue-500/40 bg-blue-500/20 text-xs font-bold text-blue-500">
            <ChevronRight className="h-3.5 w-3.5" />
          </div>
          <div>
            <div className="mb-1 text-sm font-semibold text-foreground">Browse available tools</div>
            <div className="text-[13px] leading-relaxed text-muted-foreground">The Registry tab shows every tool Kiln can use — pre-built and synthesised. Search by name, ID, or description. Each card shows parameter types and metadata.</div>
          </div>
        </div>
        <div className="flex gap-4 items-start">
          <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-blue-500/40 bg-blue-500/20 text-xs font-bold text-blue-500">
            <ChevronRight className="h-3.5 w-3.5" />
          </div>
          <div>
            <div className="mb-1 text-sm font-semibold text-foreground">Tools grow over time</div>
            <div className="text-[13px] leading-relaxed text-muted-foreground">Every synthesised tool is saved to disk under <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-blue-300">registry/tools/</code> and is available for all future queries. Re-run the same query after synthesis for faster, more accurate results.</div>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3.5 text-[13px] leading-relaxed text-muted-foreground">
        <strong className="text-blue-500">Tip:</strong> If a query triggers synthesis, the missing tool banner will say "synthesising via Vibe Coder". Once done, simply re-run the same query — Kiln executes it directly from the registry without synthesis.
      </div>
    </div>
  )
}

// ── AboutPage ──────────────────────────────────────────────────────────────────

function AboutPage() {
  return (
    <div className="flex w-full flex-col gap-10">
      <div className="flex flex-col items-center gap-4 pt-12 pb-6 text-center">
        <h1 className="bg-gradient-to-br from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-5xl font-black tracking-widest text-transparent">
          Kiln
        </h1>
        <p className="max-w-[520px] text-lg font-medium leading-relaxed text-muted-foreground">
          An AI assistant that doesn't say "I can't do that" — it builds the tool and does it.
        </p>
        <Badge variant="secondary" className="border border-purple-500/30 bg-purple-500/15 px-3.5 py-1 text-xs font-semibold tracking-wide text-purple-400">
          Built in 48 hours · Mistral Hackathon
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-3.5 max-sm:grid-cols-1">
        {[
          [Brain, 'Adaptive by Design', 'When Kiln encounters a capability gap, Mistral Codestral Vibe synthesizes a new tool on the fly — spec, implementation, registration, and execution happen in a single request.'],
          [Zap, 'Multi-Agent Execution', 'Every request is broken into a directed task graph. Nodes run in parallel where dependencies allow, each powered by an AG2 agent pair with Mistral Large.'],
          [Package, 'Kiln Tool Standard', 'Every tool is described by a Kiln YAML spec. The compiler generates framework-native bindings for AG2, LangChain, and Pydantic-AI from one source of truth.'],
          [BookOpen, 'Observable by Default', 'Every tool call, node transition, and synthesis event is streamed live and logged to W&B Weave with registry hit rate and full execution traces.'],
        ].map(([IconComp, title, body]) => {
          const Icon = IconComp as typeof Brain
          return (
            <Card key={title as string} className="transition-all hover:-translate-y-0.5 hover:border-muted-foreground/30">
              <CardContent className="flex flex-col gap-2.5 pt-5">
                <Icon className="h-6 w-6 text-muted-foreground" />
                <div className="text-sm font-bold text-foreground">{title as string}</div>
                <div className="text-[13px] leading-relaxed text-muted-foreground">{body as string}</div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-[13px] font-bold uppercase tracking-widest text-blue-500">
            The Team
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3.5">
          {[
            ['E1', 'bg-blue-500/15 text-blue-400 border-blue-500/30', 'Voice & Planning', 'Voxtral STT · Intent Parser · Mistral Large · Graph Validator'],
            ['E2', 'bg-purple-500/15 text-purple-400 border-purple-500/30', 'Kiln Tool Standard', 'Spec · Compiler · Registry · Runtime · CLI · Pre-built Tools'],
            ['E3', 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30', 'Execution & Synthesis', 'AG2 GraphFlow · Mistral Vibe · W&B Weave Observability'],
            ['E4', 'bg-amber-500/15 text-amber-400 border-amber-500/30', 'Frontend & Voice', 'React · AG-UI Event Stream · 11Labs TTS'],
          ].map(([badge, badgeCls, role, tech]) => (
            <div key={badge as string} className="flex items-start gap-3.5 rounded-lg border border-border bg-background p-3">
              <span className={cn('mt-0.5 shrink-0 rounded border px-2.5 py-1 text-[11px] font-bold tracking-wider', badgeCls as string)}>
                {badge as string}
              </span>
              <div className="flex flex-col gap-1">
                <div className="text-[13px] font-semibold text-foreground">{role as string}</div>
                <div className="font-mono text-xs text-muted-foreground">{tech as string}</div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="border-t border-border py-4 text-center text-[13px] text-muted-foreground">
        Powered by <strong className="text-foreground/70">Mistral AI</strong> · <strong className="text-foreground/70">AG2</strong> · <strong className="text-foreground/70">Kiln</strong>
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
    <div className={cn(
      'overflow-hidden rounded-lg border transition-colors duration-300',
      done ? 'border-emerald-500' : 'border-purple-500'
    )}>
      <div className={cn(
        'flex items-center justify-between border-b px-3.5 py-2.5',
        done
          ? 'border-emerald-500 bg-emerald-500/15'
          : 'border-purple-500 bg-purple-500/15'
      )}>
        <span className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
          <span className={cn('inline-block text-lg leading-none', !done && 'animate-bounce')}>
            {done ? '\uD83C\uDFC1' : '\u2692\uFE0F'}
          </span>
          Synthesizing <span className="font-mono text-purple-400">{toolName}</span>
        </span>
        <Badge
          variant="secondary"
          className={cn(
            'gap-1.5 text-[11px] font-semibold',
            done
              ? 'bg-emerald-500/15 text-emerald-500'
              : 'bg-purple-500/15 text-purple-400'
          )}
        >
          {done ? 'done' : (
            <>
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
              building
            </>
          )}
        </Badge>
      </div>
      <div className="flex items-stretch">
        <ScrollArea className="max-h-[180px] flex-1 p-3.5 font-mono text-[11px] leading-[1.7]">
          {lines.map(l => (
            <div key={l.id} className="flex gap-2.5">
              <span className="w-[110px] shrink-0 font-semibold text-purple-400">{l.stage}</span>
              {l.message && <span className="break-words text-muted-foreground">{l.message}</span>}
            </div>
          ))}
          <div ref={endRef} />
        </ScrollArea>
        <div className={cn(
          'flex w-12 shrink-0 items-center justify-center border-l border-border',
          done ? 'bg-emerald-500/15' : 'bg-purple-500/15'
        )}>
          <div className={cn('flex flex-col items-center', !done && 'animate-bounce')}>
            <div className={cn('h-2.5 w-2.5 rounded-sm', done ? 'bg-emerald-500' : 'bg-purple-500')} />
            <div className={cn('mt-0.5 h-2.5 w-3.5 rounded-[1px]', done ? 'bg-emerald-500' : 'bg-purple-500')} />
            <div className="mt-0.5 flex gap-1">
              <div className={cn('h-2 w-1 rounded-[1px]', done ? 'bg-emerald-500' : 'bg-purple-500')} />
              <div className={cn('h-2 w-1 rounded-[1px]', done ? 'bg-emerald-500' : 'bg-purple-500')} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── KilnDagPanel — renders below assistant message in the OpenUI chat ────────
// This component is placed outside the chat flow, driven by the shared reducer state.

function KilnDagPanel({
  state, synthesisJobs, missingEnvs, envValues, audioUrls,
  onEnvChange, onEnvSubmit,
}: {
  state: AppState
  synthesisJobs: SynthesisJob[]
  missingEnvs: MissingEnv[]
  envValues: Record<string, string>
  audioUrls: string[]
  onEnvChange: (k: string, v: string) => void
  onEnvSubmit: () => void
}) {
  if (state.phase === 'idle') return null

  return (
    <div className="flex flex-col gap-4 px-2 py-3">
      {/* Missing tools banner */}
      {state.missingTools.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/15 px-4 py-2.5 text-[13px] text-amber-300">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span className="font-semibold">Missing tools:</span>
          {state.missingTools.map(t => (
            <span key={t.id} className="rounded border border-blue-500/20 bg-blue-500/10 px-2 py-0.5 font-mono text-[10px] text-blue-300">
              {t.id.split('.').pop()}
            </span>
          ))}
          <span className="text-xs opacity-80">
            {synthesisJobs.length > 0
              ? `Synthesizing ${synthesisJobs.length} tool${synthesisJobs.length > 1 ? 's' : ''} via Vibe Coder — re-run this query when done`
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
        <EnvConfigPanel
          missing={missingEnvs}
          values={envValues}
          onChange={onEnvChange}
          onSubmit={onEnvSubmit}
        />
      )}

      {/* Log + Answer row */}
      {(state.logs.length > 0 || state.phase === 'complete' || state.phase === 'error') && (
        <div className="grid grid-cols-2 items-start gap-4 max-md:grid-cols-1">
          <StreamLog logs={state.logs} />
          {(state.phase === 'complete' || state.phase === 'error') && (
            <Card>
              <CardHeader>
                <CardTitle className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  {state.phase === 'complete' ? 'Final Answer' : 'Error'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className={cn(
                  'max-h-[360px] overflow-y-auto rounded-lg border p-4 text-sm leading-[1.8] text-foreground',
                  state.phase === 'error'
                    ? 'border-destructive/30 text-red-300'
                    : 'border-emerald-500/30 bg-background'
                )}>
                  {state.phase === 'complete' ? <Markdown text={state.finalAnswer} /> : state.error}
                </div>
                {audioUrls.length > 0 && (
                  <div className="mt-3.5 flex flex-col gap-2.5">
                    {audioUrls.map((url, i) => (
                      <div key={i} className="flex items-center gap-3 rounded-lg border border-border bg-background p-2.5">
                        <span className="whitespace-nowrap text-[11px] font-semibold text-purple-400">
                          Generated Audio {audioUrls.length > 1 ? `#${i + 1}` : ''}
                        </span>
                        <audio controls src={url} className="h-9 min-w-0 flex-1 rounded-md" />
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}

// ── Custom AssistantMessage for OpenUI ─────────────────────────────────────────
// Renders the text content from the AG-UI stream, plus a reference to the
// external DAG panel via shared state.

function KilnAssistantMessage({ message }: { message: AssistantMessage }) {
  const content = message.content ?? ''
  return (
    <div className="text-sm leading-[1.8] text-foreground">
      {content ? <Markdown text={content} /> : (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Processing...</span>
        </div>
      )}
    </div>
  )
}

// ── KilnStreamAdapter ─────────────────────────────────────────────────────────
// Converts our custom SSE from /kiln/stream/{run_id} into AG-UI protocol events
// so that OpenUI can render them as assistant messages.

function createKilnStreamAdapter(
  dispatch: React.Dispatch<Action>,
  setAudioUrls: React.Dispatch<React.SetStateAction<string[]>>,
) {
  return {
    async *parse(response: Response) {
      // The response body is an SSE stream with AG-UI formatted events
      // produced by our createKilnStreamResponse function
      const reader = response.body?.getReader()
      if (!reader) throw new Error('No response body')
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6).trim()
          if (!data || data === '[DONE]') continue
          try {
            const event = JSON.parse(data)
            // Dispatch Kiln-specific side effects from rawEvent
            if (event.rawEvent) {
              const raw = event.rawEvent
              if (raw._kilnType === 'plan_ready' || raw._kilnType === 'plan_updated') {
                const order = [...raw.nodes.map((n: NodeDef) => n.id).filter((id: string) => id !== raw.exit_node), raw.exit_node]
                dispatch({ type: 'PLAN_READY', payload: { nodes: raw.nodes, order, exit_node: raw.exit_node, missing_tools: raw.missing_tools || [] } })
              } else if (raw._kilnType === 'node_start') {
                dispatch({ type: 'NODE_START', payload: { node_id: raw.node_id } })
              } else if (raw._kilnType === 'tool_call') {
                dispatch({ type: 'TOOL_CALL', payload: { node_id: raw.node_id, tool: raw.tool, args: raw.args } })
              } else if (raw._kilnType === 'tool_result') {
                dispatch({ type: 'TOOL_RESULT', payload: { node_id: raw.node_id, tool: raw.tool, result: raw.result } })
                // Detect audio
                const r = raw.result as Record<string, unknown> | undefined
                if (r && typeof r === 'object') {
                  const fp = (r.file_path || r.audio_path || r.output_path) as string | undefined
                  if (fp && /\.(mp3|wav|ogg|flac)$/i.test(fp)) {
                    setAudioUrls(prev => [...prev, `/audio?path=${encodeURIComponent(fp)}`])
                  }
                }
              } else if (raw._kilnType === 'node_retry') {
                dispatch({ type: 'NODE_RETRY', payload: { node_id: raw.node_id, reason: raw.reason } })
              } else if (raw._kilnType === 'node_complete') {
                dispatch({ type: 'NODE_COMPLETE', payload: { node_id: raw.node_id, result: raw.result } })
              } else if (raw._kilnType === 'flow_complete') {
                dispatch({ type: 'FLOW_COMPLETE', payload: { final_answer: raw.final_answer } })
              } else if (raw._kilnType === 'error') {
                dispatch({ type: 'ERROR', payload: { message: raw.message } })
              }
            }
            // Yield the AG-UI event for OpenUI to process
            yield event
          } catch (e) {
            console.error('Failed to parse SSE event', e)
          }
        }
      }
    },
  }
}

// ── Helper: create a Response that streams our SSE events as AG-UI ────────────

function createKilnStreamResponse(
  run_id: string,
  abortSignal: AbortSignal,
): Response {
  const messageId = `kiln-${run_id}`
  let toolCallCounter = 0

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder()
      let closed = false

      function send(event: Record<string, unknown>) {
        if (closed) return
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }

      function closeStream() {
        if (closed) return
        closed = true
        send({ type: EventType.TEXT_MESSAGE_END, messageId })
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      }

      // Send TEXT_MESSAGE_START
      send({
        type: EventType.TEXT_MESSAGE_START,
        messageId,
        role: 'assistant',
      })

      const src = new EventSource(`/kiln/stream/${run_id}`)

      abortSignal.addEventListener('abort', () => {
        src.close()
        closeStream()
      })

      src.onmessage = (e) => {
        try {
          const ev = JSON.parse(e.data)

          if (ev.type === 'plan_ready' || ev.type === 'plan_updated') {
            // Send a text content delta describing the plan, plus rawEvent for DAG
            const nodeNames = ev.nodes.map((n: NodeDef) => n.role).join(', ')
            send({
              type: EventType.TEXT_MESSAGE_CONTENT,
              messageId,
              delta: `**Planning complete** — agents: ${nodeNames}\n\n`,
              rawEvent: { ...ev, _kilnType: ev.type },
            })
          } else if (ev.type === 'node_start') {
            send({
              type: EventType.STEP_STARTED,
              stepName: ev.node_id,
              rawEvent: { ...ev, _kilnType: 'node_start' },
            })
          } else if (ev.type === 'tool_call') {
            const tcId = `tc-${++toolCallCounter}`
            send({
              type: EventType.TOOL_CALL_START,
              toolCallId: tcId,
              toolCallName: ev.tool,
              rawEvent: { ...ev, _kilnType: 'tool_call' },
            })
            send({
              type: EventType.TOOL_CALL_ARGS,
              toolCallId: tcId,
              delta: JSON.stringify(ev.args),
            })
            send({
              type: EventType.TOOL_CALL_END,
              toolCallId: tcId,
            })
          } else if (ev.type === 'tool_result') {
            send({
              type: EventType.TOOL_CALL_RESULT,
              toolCallId: `tc-result-${toolCallCounter}`,
              result: JSON.stringify(ev.result),
              rawEvent: { ...ev, _kilnType: 'tool_result' },
            })
          } else if (ev.type === 'node_retry') {
            send({
              type: EventType.TEXT_MESSAGE_CONTENT,
              messageId,
              delta: `*Retrying ${ev.node_id}...*\n`,
              rawEvent: { ...ev, _kilnType: 'node_retry' },
            })
          } else if (ev.type === 'node_complete') {
            send({
              type: EventType.STEP_FINISHED,
              stepName: ev.node_id,
              rawEvent: { ...ev, _kilnType: 'node_complete' },
            })
          } else if (ev.type === 'flow_complete') {
            // Stream the final answer as text content
            send({
              type: EventType.TEXT_MESSAGE_CONTENT,
              messageId,
              delta: `\n\n---\n\n${ev.final_answer}`,
              rawEvent: { ...ev, _kilnType: 'flow_complete' },
            })
            send({ type: EventType.RUN_FINISHED })
            src.close()
            closeStream()
          } else if (ev.type === 'error') {
            send({
              type: EventType.TEXT_MESSAGE_CONTENT,
              messageId,
              delta: `\n\n**Error:** ${ev.message}`,
              rawEvent: { ...ev, _kilnType: 'error' },
            })
            send({
              type: EventType.TEXT_MESSAGE_END,
              messageId,
            })
            send({
              type: EventType.RUN_ERROR,
              message: ev.message,
            })
            controller.enqueue(encoder.encode('data: [DONE]\n\n'))
            src.close()
            controller.close()
          }
        } catch (err) {
          console.error('Error processing Kiln SSE event', err)
        }
      }

      src.onerror = () => {
        send({
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId,
          delta: '\n\n**Error:** Stream connection lost',
          rawEvent: { _kilnType: 'error', message: 'Stream connection lost' },
        })
        send({
          type: EventType.TEXT_MESSAGE_END,
          messageId,
        })
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        src.close()
        try { controller.close() } catch { /* already closed */ }
      }
    },
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

// ── KilnAgentView — the OpenUI-powered chat view ─────────────────────────────

function KilnAgentView() {
  const [state, dispatch]       = useReducer(reducer, initial)
  const runIdRef                = useRef<string>('')
  const [missingEnvs, setMissingEnvs]     = useState<MissingEnv[]>([])
  const [envValues, setEnvValues]         = useState<Record<string, string>>({})
  const [synthesisJobs, setSynthesisJobs] = useState<SynthesisJob[]>([])
  const [audioUrls, setAudioUrls]         = useState<string[]>([])

  // Auth
  const clerkAuth = useKilnAuth()

  const authFetch = useCallback(async (url: string, options: RequestInit = {}) => {
    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string> || {}),
    }
    try {
      const token = clerkAuth ? await clerkAuth.getToken() : null
      if (token) {
        headers['Authorization'] = `Bearer ${token}`
      }
    } catch { /* Clerk not configured */ }
    return fetch(url, { ...options, headers })
  }, [clerkAuth])

  const streamAdapter = useMemo(
    () => createKilnStreamAdapter(dispatch, setAudioUrls),
    [dispatch, setAudioUrls],
  )

  // processMessage for OpenUI's ChatProvider
  const processMessage = useCallback(async ({
    messages,
    abortController,
  }: {
    threadId: string
    messages: Message[]
    abortController: AbortController
  }): Promise<Response> => {
    // Get the last user message
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')
    const queryText = typeof lastUserMsg?.content === 'string'
      ? lastUserMsg.content
      : ''

    if (!queryText.trim()) {
      return new Response('data: [DONE]\n\n', {
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }

    // Reset DAG state
    dispatch({ type: 'RESET' })
    dispatch({ type: 'PLANNING' })
    setMissingEnvs([])
    setEnvValues({})
    setSynthesisJobs([])
    setAudioUrls([])

    try {
      const res = await authFetch('/kiln/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request: queryText }),
      })

      if (!res.ok) {
        const err = await res.json()
        dispatch({ type: 'ERROR', payload: { message: err.detail || 'Server error' } })
        const errorMessageId = `kiln-error-${Date.now()}`
        const errorStream = new ReadableStream({
          start(controller) {
            const enc = new TextEncoder()
            controller.enqueue(enc.encode(`data: ${JSON.stringify({ type: EventType.TEXT_MESSAGE_START, messageId: errorMessageId, role: 'assistant' })}\n\n`))
            controller.enqueue(enc.encode(`data: ${JSON.stringify({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: errorMessageId, delta: `**Error:** ${err.detail || 'Server error'}` })}\n\n`))
            controller.enqueue(enc.encode(`data: ${JSON.stringify({ type: EventType.TEXT_MESSAGE_END, messageId: errorMessageId })}\n\n`))
            controller.enqueue(enc.encode('data: [DONE]\n\n'))
            controller.close()
          },
        })
        return new Response(errorStream, {
          headers: { 'Content-Type': 'text/event-stream' },
        })
      }

      const data = await res.json()
      runIdRef.current = data.run_id

      if (data.synthesis_jobs?.length) {
        setSynthesisJobs(data.synthesis_jobs)
      }

      if (data.status === 'needs_config') {
        const plan = data.plan
        const order = [...plan.nodes.map((n: NodeDef) => n.id).filter((id: string) => id !== plan.exit_node), plan.exit_node]
        dispatch({ type: 'PLAN_READY', payload: { nodes: plan.nodes, order, exit_node: plan.exit_node, missing_tools: plan.missing_tools || [] } })
        dispatch({ type: 'NEEDS_CONFIG' })
        setMissingEnvs(data.missing_envs)

        // Return a response indicating config is needed
        const configMessageId = `kiln-config-${Date.now()}`
        const configStream = new ReadableStream({
          start(controller) {
            const enc = new TextEncoder()
            controller.enqueue(enc.encode(`data: ${JSON.stringify({ type: EventType.TEXT_MESSAGE_START, messageId: configMessageId, role: 'assistant' })}\n\n`))
            controller.enqueue(enc.encode(`data: ${JSON.stringify({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: configMessageId, delta: '**Configuration required** — please provide the missing API keys below to continue.' })}\n\n`))
            controller.enqueue(enc.encode(`data: ${JSON.stringify({ type: EventType.TEXT_MESSAGE_END, messageId: configMessageId })}\n\n`))
            controller.enqueue(enc.encode('data: [DONE]\n\n'))
            controller.close()
          },
        })
        return new Response(configStream, {
          headers: { 'Content-Type': 'text/event-stream' },
        })
      }

      // Normal flow: connect to the SSE stream and convert to AG-UI events
      return createKilnStreamResponse(data.run_id, abortController.signal)
    } catch (err) {
      dispatch({ type: 'ERROR', payload: { message: String(err) } })
      const errorMessageId = `kiln-catch-${Date.now()}`
      const errorStream = new ReadableStream({
        start(controller) {
          const enc = new TextEncoder()
          controller.enqueue(enc.encode(`data: ${JSON.stringify({ type: EventType.TEXT_MESSAGE_START, messageId: errorMessageId, role: 'assistant' })}\n\n`))
          controller.enqueue(enc.encode(`data: ${JSON.stringify({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: errorMessageId, delta: `**Error:** ${String(err)}` })}\n\n`))
          controller.enqueue(enc.encode(`data: ${JSON.stringify({ type: EventType.TEXT_MESSAGE_END, messageId: errorMessageId })}\n\n`))
          controller.enqueue(enc.encode('data: [DONE]\n\n'))
          controller.close()
        },
      })
      return new Response(errorStream, {
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }
  }, [authFetch, dispatch, setMissingEnvs, setEnvValues, setSynthesisJobs, setAudioUrls])

  async function executeWithEnv() {
    const run_id = runIdRef.current
    if (!run_id) return
    dispatch({ type: 'PLANNING' })
    try {
      const res = await authFetch(`/kiln/execute/${run_id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ env_vars: envValues }),
      })
      if (!res.ok) {
        const err = await res.json()
        dispatch({ type: 'ERROR', payload: { message: err.detail || 'Server error' } })
        return
      }
      // After env config, we need to manually connect to the stream
      // and dispatch events. The OpenUI chat has already finished its
      // processMessage cycle, so we update the DAG state directly.
      connectStream(run_id)
    } catch (err) {
      dispatch({ type: 'ERROR', payload: { message: String(err) } })
    }
  }

  function connectStream(run_id: string) {
    const src = new EventSource(`/kiln/stream/${run_id}`)
    src.onmessage = (e) => {
      const ev = JSON.parse(e.data)
      if (ev.type === 'plan_ready' || ev.type === 'plan_updated') {
        const order = [...ev.nodes.map((n: NodeDef) => n.id).filter((id: string) => id !== ev.exit_node), ev.exit_node]
        dispatch({ type: 'PLAN_READY', payload: { nodes: ev.nodes, order, exit_node: ev.exit_node, missing_tools: ev.missing_tools || [] } })
      } else if (ev.type === 'node_start')    { dispatch({ type: 'NODE_START',    payload: { node_id: ev.node_id } })
      } else if (ev.type === 'tool_call')     { dispatch({ type: 'TOOL_CALL',     payload: { node_id: ev.node_id, tool: ev.tool, args: ev.args } })
      } else if (ev.type === 'tool_result')   {
        dispatch({ type: 'TOOL_RESULT', payload: { node_id: ev.node_id, tool: ev.tool, result: ev.result } })
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

  const welcomeConfig = {
    title: 'Ask Kiln anything',
    description: 'Kiln plans, fetches, synthesizes, and answers — building new tools on the fly when needed.',
  }

  const conversationStarters = {
    variant: 'long' as const,
    options: EXAMPLES.map(ex => ({
      displayText: ex.q,
      prompt: ex.q,
    })),
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      <div className="flex min-h-0 flex-1">
        <FullScreen
          processMessage={processMessage}
          streamProtocol={streamAdapter}
          agentName="Kiln"
          welcomeMessage={welcomeConfig}
          conversationStarters={conversationStarters}
          assistantMessage={KilnAssistantMessage}
          disableThemeProvider
        />
      </div>
      {/* DAG visualization panel below the chat */}
      {state.phase !== 'idle' && (
        <div className="shrink-0 overflow-y-auto border-t border-border bg-background px-6 pb-4" style={{ maxHeight: '50vh' }}>
          <KilnDagPanel
            state={state}
            synthesisJobs={synthesisJobs}
            missingEnvs={missingEnvs}
            envValues={envValues}
            audioUrls={audioUrls}
            onEnvChange={(k, v) => setEnvValues(prev => ({ ...prev, [k]: v }))}
            onEnvSubmit={executeWithEnv}
          />
        </div>
      )}
    </div>
  )
}

// ── App ────────────────────────────────────────────────────────────────────────

type View = 'kiln' | 'tools' | 'howto' | 'about'

export default function App() {
  const [view, setView] = useState<View>('kiln')
  const [dark, setDark]  = useState(true)

  // Auth: safely get whether signed in
  const clerkAuth = useKilnAuth()
  const isSignedIn = clerkAuth?.isSignedIn ?? false

  // Sync theme to <html>
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
    if (dark) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }, [dark])

  const NAV: { key: View; label: string; icon: typeof Play }[] = [
    { key: 'kiln',  label: 'Agent',      icon: Play },
    { key: 'tools', label: 'Registry',   icon: Package },
    { key: 'howto', label: 'How to Use', icon: BookOpen },
    { key: 'about', label: 'About',      icon: Info },
  ]

  return (
    <div className={cn('flex min-h-screen w-full flex-col bg-background text-foreground transition-colors duration-300', dark && 'dark')}>
      {/* Header */}
      <header className="sticky top-0 z-50 flex h-14 items-center justify-between gap-4 border-b border-border bg-background/80 px-7 backdrop-blur-xl">
        <div className="flex shrink-0 items-center gap-3">
          <span className="bg-gradient-to-br from-blue-400 to-purple-400 bg-clip-text text-lg font-extrabold tracking-[0.14em] text-transparent">
            Kiln
          </span>
          <Separator orientation="vertical" className="h-4" />
          <span className="truncate text-[11px] text-muted-foreground">
            Self-Evolving Tool Registry
          </span>
        </div>

        <nav className="flex shrink-0 items-center gap-0.5 rounded-lg border border-border bg-muted p-[3px]">
          {NAV.map(n => (
            <Button
              key={n.key}
              variant={view === n.key ? 'secondary' : 'ghost'}
              size="sm"
              className={cn(
                'gap-1.5 text-[13px]',
                view === n.key
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground'
              )}
              onClick={() => setView(n.key)}
            >
              {n.label}
            </Button>
          ))}
        </nav>

        <div className="flex shrink-0 items-center gap-2.5">
          <Badge variant="outline" className="whitespace-nowrap text-[11px]">
            Kiln · Mistral · AG2
          </Badge>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => setDark(d => !d)}
            title="Toggle theme"
          >
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
          {isSignedIn && <UserButton afterSignOutUrl="/" />}
        </div>
      </header>

      {/* Pages */}
      {view === 'tools' && <main className="flex flex-1 flex-col gap-4 px-10 py-7 max-sm:px-4"><ToolsPage /></main>}
      {view === 'howto' && <main className="flex flex-1 flex-col gap-4 px-10 py-7 max-sm:px-4"><HowToUsePage /></main>}
      {view === 'about' && <main className="flex flex-1 flex-col gap-4 px-10 py-7 max-sm:px-4"><AboutPage /></main>}

      {view === 'kiln' && (
        <>
          <SignedOut>
            <div className="flex justify-center py-16">
              <SignIn routing="hash" />
            </div>
          </SignedOut>
          <SignedIn>
            <KilnAgentView />
          </SignedIn>
        </>
      )}
    </div>
  )
}
