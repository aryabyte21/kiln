"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Show, SignInButton, useAuth } from "@clerk/nextjs"
import type { UIMessage } from "ai"
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  Eye,
  EyeOff,
  Flame,
  Key,
  Loader2,
  Search,
  Send,
  Sparkles,
  Wrench,
  Zap,
  Code,
} from "lucide-react"

import { ChatSidebar } from "./_components/chat-sidebar"
import { useChatStore } from "@/lib/chat-store"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation"
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message"
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input"
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion"
import { KilnDag, type DagPlan, type NodeStatus } from "@/components/kiln-dag"

const REGISTRY_URL =
  process.env.NEXT_PUBLIC_REGISTRY_URL || "http://localhost:8766"
const CHAT_BACKEND =
  process.env.NEXT_PUBLIC_CHAT_BACKEND || "http://localhost:8765"

const CONFIG_PREFIX = "__KILN_CONFIG__"
const TRACE_RE = /^__KILN_TRACE__([\s\S]+?)__END__/

const EXAMPLE_QUERIES = [
  { icon: Search, text: "Find tools for web scraping" },
  { icon: Code, text: "How do I publish a new tool?" },
  { icon: Wrench, text: "What MCP tools are available?" },
  { icon: Zap, text: "Show me the most popular tools" },
  { icon: BookOpen, text: "Explain how the registry works" },
  { icon: Sparkles, text: "Suggest tools for data analysis" },
]

type Phase = "planning" | "synthesizing" | "executing" | "complete" | "error"

type TraceEvent =
  | { kind: "plan"; plan?: DagPlan; nodes?: Array<{ id: string; role: string; task?: string; tools: string[] }> }
  | { kind: "synthesis_wait"; tool_ids: string[] }
  | { kind: "tool_ready"; tool_id: string }
  | { kind: "node_start"; node_id: string; role?: string }
  | { kind: "tool_call"; tool: string; node_id?: string }
  | { kind: "tool_result"; node_id?: string; resultPreview?: string }
  | { kind: "node_complete"; node_id: string; resultPreview?: string }
  | { kind: "node_retry"; node_id: string; reason?: string }
  | { kind: "synthesis_timeout"; missing: string[] }

interface ParsedAssistantMessage {
  trace: TraceEvent[] | null
  body: string
  configRunId: string | null
  configMissingEnvs: Array<{ var_name: string; description: string; tool_id?: string }>
}

interface ExecutionState {
  phase: Phase
  plan: DagPlan | null
  nodeStatuses: Record<string, NodeStatus>
  nodeResults: Record<string, string>
  events: string[]
  error: string | null
}

function makeTextMessage(role: "user" | "assistant", text: string): UIMessage {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    parts: [{ type: "text", text }],
  }
}

function getMessageText(message: UIMessage): string {
  return message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
}

function parseAssistantMessage(text: string): ParsedAssistantMessage {
  if (text.startsWith(CONFIG_PREFIX)) {
    try {
      const payload = JSON.parse(text.slice(CONFIG_PREFIX.length))
      return {
        trace: null,
        body: "",
        configRunId: payload.run_id ?? null,
        configMissingEnvs: payload.missing_envs ?? [],
      }
    } catch {
      // fall through
    }
  }

  const match = text.match(TRACE_RE)
  if (match) {
    let trace: TraceEvent[] = []
    try {
      trace = JSON.parse(match[1])
    } catch {
      trace = []
    }
    return {
      trace,
      body: text.slice(match[0].length),
      configRunId: null,
      configMissingEnvs: [],
    }
  }

  return { trace: null, body: text, configRunId: null, configMissingEnvs: [] }
}

function buildFallbackPlan(
  nodes: Array<{ id: string; role: string; task?: string; tools: string[] }>,
): DagPlan {
  return {
    task: "Kiln execution",
    nodes: nodes.map((node) => ({
      id: node.id,
      role: node.role,
      task: node.task ?? node.role,
      tools: node.tools,
    })),
    edges: nodes.slice(1).map((node, index) => [nodes[index].id, node.id] as [string, string]),
    entry_nodes: nodes[0] ? [nodes[0].id] : [],
    exit_node: nodes.at(-1)?.id ?? "",
  }
}

function previewResult(result: unknown): string | undefined {
  if (result === undefined || result === null) return undefined
  const text =
    typeof result === "string" ? result : JSON.stringify(result)
  return text.length > 180 ? text.slice(0, 180) + "..." : text
}

const FAILURE_PATTERNS = [
  '"error"',
  "(no result)",
  "(error:",
  "failed to",
  "api key not set",
  '"success": false',
  '"success":false',
]

function looksLikeFailure(text: string | undefined): boolean {
  if (!text) return false
  const lower = text.toLowerCase()
  return FAILURE_PATTERNS.some((p) => lower.includes(p))
}

function emptyExecutionState(): ExecutionState {
  return {
    phase: "planning",
    plan: null,
    nodeStatuses: {},
    nodeResults: {},
    events: [],
    error: null,
  }
}

function deriveExecutionState(trace: TraceEvent[]): ExecutionState {
  const state = emptyExecutionState()

  for (const event of trace) {
    switch (event.kind) {
      case "plan": {
        const plan = event.plan ?? buildFallbackPlan(event.nodes ?? [])
        state.plan = plan
        state.phase = "planning"
        state.events.push(`Plan ready: ${plan.nodes.length} nodes`)
        state.nodeStatuses = Object.fromEntries(
          plan.nodes.map((node) => [node.id, state.nodeStatuses[node.id] ?? "pending"]),
        )
        break
      }
      case "synthesis_wait":
        state.phase = "synthesizing"
        state.events.push(`Synthesizing missing tools: ${event.tool_ids.join(", ")}`)
        break
      case "tool_ready":
        state.events.push(`Tool ready: ${event.tool_id}`)
        break
      case "node_start":
        state.phase = "executing"
        state.nodeStatuses[event.node_id] = "running"
        state.events.push(`Starting ${event.node_id}`)
        break
      case "tool_call":
        state.phase = "executing"
        state.events.push(`Calling ${event.tool}`)
        break
      case "tool_result":
        state.phase = "executing"
        if (event.resultPreview && event.node_id) {
          state.nodeResults[event.node_id] = event.resultPreview
        }
        state.events.push(
          event.node_id ? `Result received for ${event.node_id}` : "Result received",
        )
        break
      case "node_complete":
        state.phase = "executing"
        state.nodeStatuses[event.node_id] = looksLikeFailure(event.resultPreview) ? "error" : "complete"
        if (event.resultPreview) {
          state.nodeResults[event.node_id] = event.resultPreview
        }
        state.events.push(`Completed ${event.node_id}`)
        break
      case "node_retry":
        state.phase = "executing"
        state.nodeStatuses[event.node_id] = "running"
        state.events.push(`Retrying ${event.node_id}${event.reason ? `: ${event.reason.slice(0, 100)}` : ""}`)
        break
      case "synthesis_timeout":
        state.phase = "error"
        state.error = `Synthesis timed out: ${event.missing.join(", ")}`
        state.events.push(state.error)
        break
    }
  }

  if (state.error) {
    state.phase = "error"
  } else if (Object.values(state.nodeStatuses).some((status) => status === "running")) {
    state.phase = "executing"
  } else if (Object.values(state.nodeStatuses).some((status) => status === "complete")) {
    state.phase = "complete"
  }

  return state
}

function buildHistory(messages: UIMessage[]): string[] {
  const recent = messages.slice(-10)
  return recent
    .map((message) => {
      const parsed = parseAssistantMessage(getMessageText(message))
      const text = parsed.body
      if (!text) return null
      const trimmed = text.length > 500 ? text.slice(0, 500) + "..." : text
      return `${message.role}: ${trimmed}`
    })
    .filter((line): line is string => line !== null)
}

function ApiKeyConfigCard({
  missingEnvs,
  onSubmit,
  isSubmitting,
}: {
  missingEnvs: Array<{ var_name: string; description: string; has_saved_value?: boolean }>
  onSubmit: (envVars: Record<string, string>) => void
  isSubmitting: boolean
}) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [visibility, setVisibility] = useState<Record<string, boolean>>({})
  const hasSavedKeys = missingEnvs.some((e) => e.has_saved_value)

  const allFilled = missingEnvs.every(
    (env) => env.has_saved_value || values[env.var_name]?.trim(),
  )

  return (
    <Card className="border-primary/20 bg-card/85 p-4">
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Key className="size-4 text-primary" />
          API keys required
        </div>
        <p className="text-xs text-muted-foreground">
          Enter the required API keys below. They will be saved to your account for future use.
        </p>
        <div className="space-y-3">
          {missingEnvs.map((env) => (
            <div key={env.var_name} className="space-y-1.5">
              <label className="text-xs font-medium text-foreground/80">
                {env.var_name}
                {env.description && (
                  <span className="ml-1.5 font-normal text-muted-foreground">
                    {" "}
                    - {env.description}
                  </span>
                )}
                {env.has_saved_value && (
                  <span className="ml-1.5 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-400">
                    saved key exists
                  </span>
                )}
              </label>
              <div className="relative">
                <input
                  type={visibility[env.var_name] ? "text" : "password"}
                  value={values[env.var_name] || ""}
                  onChange={(e) =>
                    setValues((prev) => ({ ...prev, [env.var_name]: e.target.value }))
                  }
                  autoComplete="off"
                  placeholder={`Enter ${env.var_name}`}
                  className="w-full rounded-lg border border-border/70 bg-card/75 px-3 py-2 pr-9 text-sm text-foreground shadow-inner shadow-black/10 ring-1 ring-border/70 placeholder:text-muted-foreground/50 outline-none transition-all focus:border-border focus:ring-2 focus:ring-primary/30"
                />
                <button
                  type="button"
                  onClick={() =>
                    setVisibility((prev) => ({
                      ...prev,
                      [env.var_name]: !prev[env.var_name],
                    }))
                  }
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/50 transition-colors hover:text-muted-foreground"
                >
                  {visibility[env.var_name] ? (
                    <EyeOff className="size-3.5" />
                  ) : (
                    <Eye className="size-3.5" />
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
        <Button
          onClick={() => onSubmit(values)}
          disabled={!allFilled || isSubmitting}
          className="w-full"
          size="sm"
        >
          {isSubmitting
            ? "Saving and continuing..."
            : hasSavedKeys
              ? "Use saved keys and continue"
              : "Save and continue"}
        </Button>
      </div>
    </Card>
  )
}

function ExecutionPanel({
  state,
  isStreaming,
}: {
  state: ExecutionState
  isStreaming: boolean
}) {
  const phaseLabel =
    state.phase === "planning"
      ? "Planning execution graph..."
      : state.phase === "synthesizing"
        ? "Synthesizing missing tools..."
        : state.phase === "executing"
          ? "Executing workflow..."
          : state.phase === "complete"
            ? "Execution complete"
            : "Execution failed"

  return (
    <Card className="border-border/70 bg-card/70 p-4">
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-sm">
          {state.phase === "complete" && !isStreaming ? (
            <CheckCircle2 className="size-4 text-emerald-400" />
          ) : state.phase === "error" ? (
            <AlertCircle className="size-4 text-red-400" />
          ) : (
            <Loader2 className="size-4 animate-spin text-primary" />
          )}
          <span className="font-medium text-foreground">{phaseLabel}</span>
        </div>

        {state.plan && (
          <KilnDag
            plan={state.plan}
            nodeStatuses={state.nodeStatuses}
            nodeResults={state.nodeResults}
          />
        )}

        {state.events.length > 0 && (
          <div className="space-y-1">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/50">
              Event log
            </p>
            <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-border/70 bg-background/40 p-3 font-mono text-[11px]">
              {state.events.map((event, index) => (
                <div key={`${event}-${index}`} className="leading-relaxed text-muted-foreground/70">
                  {event}
                </div>
              ))}
            </div>
          </div>
        )}

        {state.error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-300/80">
            {state.error}
          </div>
        )}
      </div>
    </Card>
  )
}

export default function ChatPage() {
  return (
    <>
      <Show when="signed-out">
        <div className="hero-surface flex min-h-[32rem] flex-col items-center justify-center gap-5 text-center">
          <div className="relative">
            <span className="absolute -inset-4 rounded-2xl bg-gradient-to-br from-primary/30 to-primary/10 blur-xl" />
            <div className="relative flex size-16 items-center justify-center rounded-2xl border border-primary/30 bg-primary/15">
              <Flame className="size-8 text-primary" />
            </div>
          </div>
          <div className="space-y-1.5">
            <p className="text-xl font-semibold tracking-tight">Sign in to use Kiln</p>
            <p className="text-sm text-muted-foreground">
              Describe a task in natural language. Kiln plans, synthesizes tools, and executes.
            </p>
          </div>
          <SignInButton mode="modal">
            <Button className="mt-1" size="lg">Sign in</Button>
          </SignInButton>
        </div>
      </Show>
      <Show when="signed-in">
        <KilnChat />
      </Show>
    </>
  )
}

function KilnChat() {
  const { getToken } = useAuth()
  const {
    hydrated,
    conversations,
    activeConversation,
    activeId,
    createConversation,
    setActiveConversation,
    deleteConversation,
    renameConversation,
    persistMessages,
  } = useChatStore()

  const [messages, setMessages] = useState<UIMessage[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [streamState, setStreamState] = useState<ExecutionState | null>(null)
  const [configPrompt, setConfigPrompt] = useState<{
    runId: string
    missingEnvs: Array<{ var_name: string; description: string; has_saved_value?: boolean }>
    originalQuery: string
  } | null>(null)
  const [isSubmittingConfig, setIsSubmittingConfig] = useState(false)

  const abortRef = useRef<AbortController | null>(null)
  const lastLoadedIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!hydrated) return
    if (activeId === null && conversations.length === 0) {
      createConversation()
    } else if (activeId === null && conversations.length > 0) {
      setActiveConversation(conversations[0].id)
    }
  }, [hydrated, activeId, conversations, createConversation, setActiveConversation])

  useEffect(() => {
    if (!activeConversation) return
    if (lastLoadedIdRef.current === activeConversation.id) return
    lastLoadedIdRef.current = activeConversation.id
    setMessages(activeConversation.messages)
    setStreamState(null)
    setConfigPrompt(null)
    setIsLoading(false)
  }, [activeConversation])

  useEffect(() => {
    if (!hydrated || !activeId) return
    if (lastLoadedIdRef.current !== activeId) return
    persistMessages(activeId, messages)
  }, [messages, activeId, hydrated, persistMessages])

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setIsLoading(false)
    setStreamState(null)
  }, [])

  const appendAssistantMessage = useCallback((text: string) => {
    setMessages((prev) => [...prev, makeTextMessage("assistant", text)])
  }, [])

  const startStream = useCallback(
    async (runId: string, headers: Record<string, string>) => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      const trace: TraceEvent[] = []
      let finished = false

      const finalize = (answer: string) => {
        if (finished) return
        finished = true
        const tracePrefix =
          trace.length > 0
            ? `__KILN_TRACE__${JSON.stringify(trace)}__END__`
            : ""
        appendAssistantMessage(tracePrefix + answer)
        setStreamState(null)
        setIsLoading(false)
      }

      const finalizeError = (message: string) => {
        setStreamState((prev) => ({
          ...(prev ?? emptyExecutionState()),
          phase: "error",
          error: message,
          events: [...(prev?.events ?? []), `Error: ${message}`],
        }))
        finalize(`I hit an error: ${message}`)
      }

      const applyEvent = (event: TraceEvent, nextState: (prev: ExecutionState) => ExecutionState) => {
        trace.push(event)
        setStreamState((prev) => nextState(prev ?? emptyExecutionState()))
      }

      try {
        const response = await fetch(`${CHAT_BACKEND}/kiln/stream/${runId}`, {
          headers,
          signal: controller.signal,
        })

        if (!response.ok || !response.body) {
          throw new Error("Failed to connect to the execution stream")
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ""

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split("\n")
          buffer = lines.pop() || ""

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue
            const raw = line.slice(6).trim()
            if (!raw || raw === "[DONE]") continue

            let event: { type: string; [key: string]: unknown }
            try {
              event = JSON.parse(raw)
            } catch {
              continue
            }

            switch (event.type) {
              case "plan_ready":
              case "plan_updated": {
                const plan: DagPlan = {
                  task: typeof event.task === "string" ? event.task : "Kiln execution",
                  nodes: Array.isArray(event.nodes)
                    ? event.nodes.map((node) => ({
                        id: String((node as Record<string, unknown>).id),
                        role: String((node as Record<string, unknown>).role ?? "Agent"),
                        task: String((node as Record<string, unknown>).task ?? (node as Record<string, unknown>).role ?? "Task"),
                        tools: Array.isArray((node as Record<string, unknown>).tools)
                          ? ((node as Record<string, unknown>).tools as unknown[]).map(String)
                          : [],
                      }))
                    : [],
                  edges: Array.isArray(event.edges)
                    ? (event.edges as unknown[]).map((edge) => [
                        String((edge as unknown[])[0]),
                        String((edge as unknown[])[1]),
                      ] as [string, string])
                    : [],
                  entry_nodes: Array.isArray(event.entry_nodes)
                    ? (event.entry_nodes as unknown[]).map(String)
                    : [],
                  exit_node: typeof event.exit_node === "string" ? event.exit_node : "",
                  missing_tools: Array.isArray(event.missing_tools)
                    ? event.missing_tools as DagPlan["missing_tools"]
                    : undefined,
                }

                applyEvent(
                  { kind: "plan", plan },
                  (prev) => ({
                    ...prev,
                    phase: "planning",
                    plan,
                    nodeStatuses: Object.fromEntries(
                      plan.nodes.map((node) => [node.id, prev.nodeStatuses[node.id] ?? "pending"]),
                    ),
                    events: [...prev.events, `Plan ready: ${plan.nodes.length} nodes`],
                  }),
                )
                break
              }
              case "synthesis_wait":
                applyEvent(
                  { kind: "synthesis_wait", tool_ids: Array.isArray(event.tool_ids) ? event.tool_ids.map(String) : [] },
                  (prev) => ({
                    ...prev,
                    phase: "synthesizing",
                    events: [
                      ...prev.events,
                      `Synthesizing missing tools: ${
                        Array.isArray(event.tool_ids) ? event.tool_ids.map(String).join(", ") : ""
                      }`,
                    ],
                  }),
                )
                break
              case "tool_ready":
                applyEvent(
                  { kind: "tool_ready", tool_id: String(event.tool_id ?? "") },
                  (prev) => ({
                    ...prev,
                    events: [...prev.events, `Tool ready: ${String(event.tool_id ?? "")}`],
                  }),
                )
                break
              case "node_start":
                applyEvent(
                  { kind: "node_start", node_id: String(event.node_id ?? ""), role: typeof event.role === "string" ? event.role : undefined },
                  (prev) => ({
                    ...prev,
                    phase: prev.error ? "error" : "executing",
                    nodeStatuses: {
                      ...prev.nodeStatuses,
                      [String(event.node_id ?? "")]: "running",
                    },
                    events: [...prev.events, `Starting ${String(event.node_id ?? "")}`],
                  }),
                )
                break
              case "tool_call":
                applyEvent(
                  { kind: "tool_call", tool: String(event.tool ?? ""), node_id: typeof event.node_id === "string" ? event.node_id : undefined },
                  (prev) => ({
                    ...prev,
                    phase: "executing",
                    events: [...prev.events, `Calling ${String(event.tool ?? "")}`],
                  }),
                )
                break
              case "tool_result": {
                const resultPreview = previewResult(event.result)
                applyEvent(
                  { kind: "tool_result", node_id: typeof event.node_id === "string" ? event.node_id : undefined, resultPreview },
                  (prev) => ({
                    ...prev,
                    phase: "executing",
                    nodeResults:
                      resultPreview && typeof event.node_id === "string"
                        ? { ...prev.nodeResults, [event.node_id]: resultPreview }
                        : prev.nodeResults,
                    events: [
                      ...prev.events,
                      typeof event.node_id === "string"
                        ? `Result received for ${event.node_id}`
                        : "Result received",
                    ],
                  }),
                )
                break
              }
              case "node_complete": {
                const resultPreview = previewResult(event.result)
                const nodeId = String(event.node_id ?? "")
                const failed = looksLikeFailure(resultPreview)
                applyEvent(
                  { kind: "node_complete", node_id: nodeId, resultPreview },
                  (prev) => ({
                    ...prev,
                    phase: "executing",
                    nodeStatuses: {
                      ...prev.nodeStatuses,
                      [nodeId]: failed ? "error" : "complete",
                    },
                    nodeResults:
                      resultPreview
                        ? { ...prev.nodeResults, [nodeId]: resultPreview }
                        : prev.nodeResults,
                    events: [...prev.events, failed ? `Node ${nodeId} completed with errors` : `Completed ${nodeId}`],
                  }),
                )
                break
              }
              case "node_retry": {
                const nodeId = String(event.node_id ?? "")
                const reason = typeof event.reason === "string" ? event.reason.slice(0, 100) : ""
                applyEvent(
                  { kind: "node_retry", node_id: nodeId, reason },
                  (prev) => ({
                    ...prev,
                    phase: "executing",
                    nodeStatuses: {
                      ...prev.nodeStatuses,
                      [nodeId]: "running",
                    },
                    events: [...prev.events, `Retrying ${nodeId}${reason ? `: ${reason}` : ""}`],
                  }),
                )
                break
              }
              case "synthesis_timeout":
                applyEvent(
                  { kind: "synthesis_timeout", missing: Array.isArray(event.missing) ? event.missing.map(String) : [] },
                  (prev) => ({
                    ...prev,
                    phase: "error",
                    error: `Synthesis timed out: ${
                      Array.isArray(event.missing) ? event.missing.map(String).join(", ") : ""
                    }`,
                    events: [
                      ...prev.events,
                      `Synthesis timed out: ${
                        Array.isArray(event.missing) ? event.missing.map(String).join(", ") : ""
                      }`,
                    ],
                  }),
                )
                break
              case "flow_complete":
                finalize(String(event.final_answer ?? "(no answer returned)"))
                return
              case "error":
                finalizeError(String(event.message ?? "Unknown error"))
                return
            }
          }
        }

        if (!finished) finalize("(no answer returned)")
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return
        finalizeError(error instanceof Error ? error.message : "Unknown error")
      }
    },
    [appendAssistantMessage],
  )

  const runQuery = useCallback(
    async (query: string) => {
      const trimmed = query.trim()
      if (!trimmed || isLoading) return

      const conversationId = activeId ?? createConversation()
      if (activeId !== conversationId) {
        setActiveConversation(conversationId)
      }

      const historySource = activeId === conversationId ? messages : []
      setMessages((prev) => [...prev, makeTextMessage("user", trimmed)])
      setConfigPrompt(null)
      setStreamState(emptyExecutionState())
      setIsLoading(true)

      try {
        const token = await getToken()
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        }
        if (token) headers.Authorization = `Bearer ${token}`

        const response = await fetch(`${CHAT_BACKEND}/kiln/start`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            request: trimmed,
            history: buildHistory(historySource),
          }),
        })

        if (!response.ok) {
          const payload = await response.json().catch(() => ({ detail: "Request failed" }))
          throw new Error(payload.detail || `HTTP ${response.status}`)
        }

        const data = await response.json()

        if (data.status === "needs_config") {
          const payload = JSON.stringify({
            type: "needs_config",
            run_id: data.run_id,
            missing_envs: data.missing_envs,
          })
          appendAssistantMessage(`${CONFIG_PREFIX}${payload}`)
          setConfigPrompt({
            runId: data.run_id,
            missingEnvs: data.missing_envs,
            originalQuery: trimmed,
          })
          setStreamState(null)
          setIsLoading(false)
          return
        }

        await startStream(data.run_id, token ? { Authorization: `Bearer ${token}` } : {})
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error"
        setStreamState({
          ...emptyExecutionState(),
          phase: "error",
          error: message,
          events: [`Error: ${message}`],
        })
        appendAssistantMessage(`I hit an error: ${message}`)
        setIsLoading(false)
      }
    },
    [
      activeId,
      appendAssistantMessage,
      createConversation,
      getToken,
      isLoading,
      messages,
      setActiveConversation,
      startStream,
    ],
  )

  const handleConfigSubmit = useCallback(
    async (envVars: Record<string, string>) => {
      if (!configPrompt) return
      setIsSubmittingConfig(true)
      try {
        const token = await getToken()
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        }

        // Only include non-empty values (empty means "use saved key from Clerk")
        const nonEmpty: Record<string, string> = {}
        for (const [k, v] of Object.entries(envVars)) {
          if (v.trim()) nonEmpty[k] = v.trim()
        }

        // Save new keys to Clerk for future use (best-effort)
        if (Object.keys(nonEmpty).length > 0) {
          fetch(`${REGISTRY_URL}/auth/tool-env-vars`, {
            method: "PUT",
            headers,
            body: JSON.stringify({ env_vars: nonEmpty }),
          }).catch(() => {})
        }

        // Execute with the provided keys
        const runId = configPrompt.runId
        await fetch(`${CHAT_BACKEND}/kiln/execute/${runId}`, {
          method: "POST",
          headers,
          body: JSON.stringify({ env_vars: nonEmpty }),
        })

        setConfigPrompt(null)
        setStreamState(emptyExecutionState())
        setIsLoading(true)
        await startStream(runId, token ? { Authorization: `Bearer ${token}` } : {})
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error"
        appendAssistantMessage(`Failed to execute with API keys: ${msg}. Please try again.`)
      } finally {
        setIsSubmittingConfig(false)
      }
    },
    [appendAssistantMessage, configPrompt, getToken, startStream],
  )

  const handleNewChat = useCallback(() => {
    stopStreaming()
    setMessages([])
    createConversation()
  }, [createConversation, stopStreaming])

  const handleSelectChat = useCallback(
    (id: string) => {
      stopStreaming()
      setActiveConversation(id)
    },
    [setActiveConversation, stopStreaming],
  )

  const handlePromptSubmit = useCallback(
    (message: PromptInputMessage) => {
      if (!message.text) return
      void runQuery(message.text)
    },
    [runQuery],
  )

  const handleExampleClick = useCallback(
    (text: string) => {
      void runQuery(text)
    },
    [runQuery],
  )

  const hasMessages = messages.length > 0

  const renderedMessages = useMemo(
    () =>
      messages.map((message) => {
        const text = getMessageText(message)
        const parsed = parseAssistantMessage(text)
        return { message, parsed }
      }),
    [messages],
  )

  return (
    <div className="section-surface flex h-[calc(100vh-12.5rem)] min-h-[38rem] overflow-hidden p-0">
      <ChatSidebar
        conversations={conversations}
        activeId={activeId}
        onNew={handleNewChat}
        onSelect={handleSelectChat}
        onDelete={deleteConversation}
        onRename={renameConversation}
      />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Conversation className="flex-1">
          <ConversationContent className="mx-auto w-full max-w-3xl space-y-6 px-6 py-6">
            {!hasMessages ? (
              <ConversationEmptyState
                icon={
                  <div className="relative">
                    <span className="absolute -inset-4 animate-pulse rounded-3xl bg-gradient-to-br from-primary/30 to-primary/10 blur-2xl" />
                    <div className="relative flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 ring-1 ring-primary/30">
                      <Flame className="size-8 text-primary" />
                    </div>
                  </div>
                }
                title="Ask Kiln anything"
                description="Explore the registry, find tools, learn how to publish, or get help with your setup."
              >
                <Suggestions className="mt-2 max-w-2xl">
                  {EXAMPLE_QUERIES.map(({ icon: Icon, text }) => (
                    <Suggestion
                      key={text}
                      suggestion={text}
                      onClick={handleExampleClick}
                      className="gap-2"
                    >
                      <Icon className="size-3.5 text-muted-foreground/70" />
                      {text}
                    </Suggestion>
                  ))}
                </Suggestions>
              </ConversationEmptyState>
            ) : (
              <>
                {renderedMessages.map(({ message, parsed }) => {
                  if (message.role === "user") {
                    return (
                      <Message key={message.id} from="user">
                        <MessageContent>{getMessageText(message)}</MessageContent>
                      </Message>
                    )
                  }

                  if (parsed.configRunId !== null) {
                    return (
                      <Message key={message.id} from="assistant">
                        <div className="flex w-full max-w-[85%] flex-col gap-2">
                          {configPrompt ? (
                            <ApiKeyConfigCard
                              missingEnvs={configPrompt.missingEnvs}
                              onSubmit={handleConfigSubmit}
                              isSubmitting={isSubmittingConfig}
                            />
                          ) : (
                            <p className="text-sm text-muted-foreground">
                              API keys saved. Retrying...
                            </p>
                          )}
                        </div>
                      </Message>
                    )
                  }

                  const historicalState =
                    parsed.trace && parsed.trace.length > 0
                      ? deriveExecutionState(parsed.trace)
                      : null

                  return (
                    <Message key={message.id} from="assistant">
                      <div className="flex w-full max-w-[85%] flex-col gap-3">
                        {historicalState && (
                          <ExecutionPanel state={historicalState} isStreaming={false} />
                        )}
                        {parsed.body && (
                          <MessageContent>
                            <MessageResponse>{parsed.body}</MessageResponse>
                          </MessageContent>
                        )}
                      </div>
                    </Message>
                  )
                })}

                {streamState && (
                  <Message from="assistant">
                    <div className="flex w-full max-w-[85%] flex-col gap-3">
                      <ExecutionPanel state={streamState} isStreaming />
                    </div>
                  </Message>
                )}
              </>
            )}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        <div className="shrink-0 border-t border-border/70 bg-background/85 px-6 py-4 backdrop-blur-xl">
          <div className="mx-auto max-w-3xl">
            <PromptInput onSubmit={handlePromptSubmit}>
              <PromptInputBody>
                <PromptInputTextarea
                  placeholder="Ask Kiln something..."
                  disabled={isLoading}
                />
              </PromptInputBody>
              <PromptInputFooter>
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/60">
                  <Flame className="size-3 text-primary/70" />
                  Powered by Kiln
                </div>
                <PromptInputSubmit disabled={isLoading}>
                  {isLoading ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Send className="size-3.5" />
                  )}
                </PromptInputSubmit>
              </PromptInputFooter>
            </PromptInput>
          </div>
        </div>
      </div>
    </div>
  )
}
