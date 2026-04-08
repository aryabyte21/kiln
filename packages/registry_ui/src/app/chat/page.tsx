"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"
import { Show, SignInButton, useAuth } from "@clerk/nextjs"

import { ChatSidebar } from "./_components/chat-sidebar"
import { useChatStore } from "@/lib/chat-store"
import {
  Flame,
  Send,
  Sparkles,
  Search,
  Code,
  Wrench,
  Zap,
  BookOpen,
  Key,
  Eye,
  EyeOff,
  Brain,
} from "lucide-react"

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
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning"
import {
  PromptInput,
  PromptInputBody,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputSubmit,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input"
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion"
import { Loader } from "@/components/ai-elements/loader"

const REGISTRY_URL =
  process.env.NEXT_PUBLIC_REGISTRY_URL || "http://localhost:8766"

// Use [\s\S] instead of `.` + /s flag so we don't require ES2018 dotAll.
const TRACE_RE = /^__KILN_TRACE__([\s\S]+?)__END__/
const CONFIG_PREFIX = "__KILN_CONFIG__"

const EXAMPLE_QUERIES = [
  { icon: Search, text: "Find tools for web scraping" },
  { icon: Code, text: "How do I publish a new tool?" },
  { icon: Wrench, text: "What MCP tools are available?" },
  { icon: Zap, text: "Show me the most popular tools" },
  { icon: BookOpen, text: "Explain how the registry works" },
  { icon: Sparkles, text: "Suggest tools for data analysis" },
]

// ── Trace types — must match the server-side route.ts shape ────────────────

type TraceEvent =
  | { kind: "plan"; nodes: { id: string; role: string; tools: string[] }[] }
  | { kind: "synthesis_wait"; tool_ids: string[] }
  | { kind: "tool_ready"; tool_id: string }
  | { kind: "node_start"; node_id: string; role?: string }
  | { kind: "tool_call"; tool: string; node_id?: string }
  | { kind: "tool_result"; node_id?: string }
  | { kind: "node_complete"; node_id: string }
  | { kind: "synthesis_timeout"; missing: string[] }

interface ParsedAssistantMessage {
  trace: TraceEvent[] | null
  body: string
  configRunId: string | null
  configMissingEnvs: Array<{ var_name: string; description: string; tool_id?: string }>
}

function parseAssistantMessage(text: string): ParsedAssistantMessage {
  // Inline API key config card
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
      // fall through to normal parsing
    }
  }

  // Trace prefix injected by the chat backend route
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

// ── Inline API key config card ─────────────────────────────────────────────

function ApiKeyConfigCard({
  missingEnvs,
  onSubmit,
  isSubmitting,
}: {
  missingEnvs: Array<{ var_name: string; description: string }>
  onSubmit: (envVars: Record<string, string>) => void
  isSubmitting: boolean
}) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [visibility, setVisibility] = useState<Record<string, boolean>>({})

  const allFilled = missingEnvs.every((env) => values[env.var_name]?.trim())

  return (
    <Card className="border-primary/20 bg-card/85 p-4">
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Key className="size-4 text-primary" />
          API keys required
        </div>
        <p className="text-xs text-muted-foreground">
          These keys will be saved to your account so you don&apos;t have to enter them again.
        </p>
        <div className="space-y-3">
          {missingEnvs.map((env) => (
            <div key={env.var_name} className="space-y-1.5">
              <label className="text-xs font-medium text-foreground/80">
                {env.var_name}
                {env.description && (
                  <span className="ml-1.5 font-normal text-muted-foreground">
                    — {env.description}
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
          {isSubmitting ? "Saving & continuing…" : "Save & continue"}
        </Button>
      </div>
    </Card>
  )
}

// ── Trace renderer (collapsible reasoning block) ───────────────────────────

function traceToMarkdown(trace: TraceEvent[]): string {
  const lines: string[] = []
  for (const ev of trace) {
    switch (ev.kind) {
      case "plan": {
        const roles = ev.nodes.map((n) => n.role).join(" → ")
        lines.push(`**Plan:** ${roles}`)
        for (const node of ev.nodes) {
          const tools = node.tools.length
            ? ` _(uses: ${node.tools.map((t) => `\`${t.split(".").pop()}\``).join(", ")})_`
            : ""
          lines.push(`- **${node.role}** — ${node.id}${tools}`)
        }
        lines.push("")
        break
      }
      case "synthesis_wait":
        lines.push(`⏳ Synthesizing missing tools: ${ev.tool_ids.join(", ")}`)
        break
      case "tool_ready":
        lines.push(`✓ Tool ready: \`${ev.tool_id}\``)
        break
      case "node_start":
        lines.push(`▸ \`${ev.node_id}\` started`)
        break
      case "tool_call":
        lines.push(`  → Calling \`${ev.tool}\``)
        break
      case "tool_result":
        lines.push(`  ← Result received`)
        break
      case "node_complete":
        lines.push(`✓ \`${ev.node_id}\` complete`)
        break
      case "synthesis_timeout":
        lines.push(`⚠ Synthesis timed out: ${ev.missing.join(", ")}`)
        break
    }
  }
  return lines.join("\n")
}

// ── Page ────────────────────────────────────────────────────────────────────

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

  // ── Persisted conversation history ────────────────────────────────────────
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

  // Auto-create the first conversation once hydration is done.
  useEffect(() => {
    if (!hydrated) return
    if (activeId === null && conversations.length === 0) {
      createConversation()
    } else if (activeId === null && conversations.length > 0) {
      setActiveConversation(conversations[0].id)
    }
  }, [hydrated, activeId, conversations, createConversation, setActiveConversation])

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        headers: async (): Promise<Record<string, string>> => {
          const token = await getToken()
          const headers: Record<string, string> = {}
          if (token) headers.Authorization = `Bearer ${token}`
          return headers
        },
      }),
    [getToken],
  )
  const { messages, sendMessage, status, setMessages } = useChat({
    transport,
    // Seed initial messages from the active conversation when it changes.
    id: activeId ?? undefined,
  })
  const isLoading = status === "streaming" || status === "submitted"

  // ── Sync messages ↔ store ────────────────────────────────────────────────
  // When the active conversation changes, replace useChat messages with the
  // persisted ones for that conversation. Tracked with a ref so we don't
  // overwrite live in-flight messages.
  const lastLoadedIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (!activeConversation) return
    if (lastLoadedIdRef.current === activeConversation.id) return
    lastLoadedIdRef.current = activeConversation.id
    setMessages(activeConversation.messages)
  }, [activeConversation, setMessages])

  // After useChat updates, persist the new messages back into the store.
  // Skipped while no conversation is active or while we're hydrating to
  // avoid clobbering localStorage with an empty array.
  useEffect(() => {
    if (!hydrated || !activeId) return
    if (lastLoadedIdRef.current !== activeId) return
    persistMessages(activeId, messages)
  }, [messages, activeId, hydrated, persistMessages])

  const handleNewChat = useCallback(() => {
    setMessages([])
    createConversation()
  }, [createConversation, setMessages])

  const handleSelectChat = useCallback(
    (id: string) => {
      setActiveConversation(id)
    },
    [setActiveConversation],
  )

  // Pending API key config card state
  const [configPrompt, setConfigPrompt] = useState<{
    runId: string
    missingEnvs: Array<{ var_name: string; description: string }>
    originalQuery: string
  } | null>(null)
  const [isSubmittingConfig, setIsSubmittingConfig] = useState(false)

  // Detect needs_config card in latest assistant message
  useEffect(() => {
    if (messages.length < 2) return
    const last = messages[messages.length - 1]
    if (last.role !== "assistant") return
    const text = last.parts
      .map((p) => (p.type === "text" ? p.text : ""))
      .join("")
    if (!text.startsWith(CONFIG_PREFIX)) return
    try {
      const payload = JSON.parse(text.slice(CONFIG_PREFIX.length))
      const lastUser = [...messages].reverse().find((m) => m.role === "user")
      const originalQuery =
        lastUser?.parts
          .map((p) => (p.type === "text" ? p.text : ""))
          .join("") || ""
      setConfigPrompt({
        runId: payload.run_id,
        missingEnvs: payload.missing_envs,
        originalQuery,
      })
    } catch {
      // ignore malformed payload
    }
  }, [messages])

  const handleConfigSubmit = useCallback(
    async (envVars: Record<string, string>) => {
      if (!configPrompt) return
      setIsSubmittingConfig(true)
      try {
        const token = await getToken()
        await fetch(`${REGISTRY_URL}/auth/tool-env-vars`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ env_vars: envVars }),
        })
        const query = configPrompt.originalQuery
        setConfigPrompt(null)
        sendMessage({ text: query })
      } catch (err) {
        console.error("Failed to save env vars:", err)
      } finally {
        setIsSubmittingConfig(false)
      }
    },
    [configPrompt, getToken, sendMessage],
  )

  const handlePromptSubmit = (msg: PromptInputMessage) => {
    if (!msg.text || isLoading) return
    sendMessage({ text: msg.text })
  }

  const handleExampleClick = (text: string) => {
    sendMessage({ text })
  }

  const hasMessages = messages.length > 0

  const showAssistantThinking =
    isLoading &&
    messages.length > 0 &&
    messages[messages.length - 1].role === "user"

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
              {messages.map((message) => {
                const text = message.parts
                  .map((p) => (p.type === "text" ? p.text : ""))
                  .join("")

                if (message.role === "user") {
                  return (
                    <Message key={message.id} from="user">
                      <MessageContent>{text}</MessageContent>
                    </Message>
                  )
                }

                const parsed = parseAssistantMessage(text)

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
                            API keys saved. Retrying…
                          </p>
                        )}
                      </div>
                    </Message>
                  )
                }

                return (
                  <Message key={message.id} from="assistant">
                    <div className="flex w-full max-w-[85%] flex-col gap-2">
                      {parsed.trace && parsed.trace.length > 0 && (
                        <Reasoning isStreaming={false}>
                          <ReasoningTrigger>
                            <Brain className="size-3.5" />
                            View execution trace ({parsed.trace.length} steps)
                          </ReasoningTrigger>
                          <ReasoningContent>
                            {traceToMarkdown(parsed.trace)}
                          </ReasoningContent>
                        </Reasoning>
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

              {showAssistantThinking && (
                <Message from="assistant">
                  <MessageContent>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader />
                      <span>Thinking…</span>
                    </div>
                  </MessageContent>
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
                placeholder="Ask Kiln something…"
                disabled={isLoading}
              />
            </PromptInputBody>
            <PromptInputFooter>
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/60">
                <Flame className="size-3 text-primary/70" />
                Powered by Kiln
              </div>
              <PromptInputSubmit disabled={isLoading}>
                <Send className="size-3.5" />
              </PromptInputSubmit>
            </PromptInputFooter>
          </PromptInput>
        </div>
      </div>
      </div>
    </div>
  )
}
