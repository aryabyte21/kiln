"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { useAuth, Show, SignInButton } from "@clerk/nextjs"
import {
  Send,
  Loader2,
  Bot,
  User,
  Flame,
  AlertCircle,
  ChevronDown,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

// ── Types ──────────────────────────────────────────────────────────────
interface ChatMessage {
  id: string
  role: "user" | "assistant" | "error"
  content: string
  trace?: StreamEvent[]
}

interface StreamEvent {
  type: string
  name?: string
  timestamp: number
}

const CHAT_BACKEND =
  process.env.NEXT_PUBLIC_CHAT_BACKEND || "http://localhost:8765"

const EXAMPLE_QUERIES = [
  {
    title: "List all tools",
    description: "Show me every tool in the registry",
  },
  {
    title: "Search tools",
    description: "Find tools related to web scraping",
  },
  {
    title: "Publish a tool",
    description: "How do I publish a new tool to Kiln?",
  },
  {
    title: "Tool details",
    description: "Tell me about the latest version of a tool",
  },
]

// ── Helpers ────────────────────────────────────────────────────────────
function generateId() {
  return Math.random().toString(36).slice(2, 11)
}

function formatEventType(type: string) {
  const map: Record<string, string> = {
    node_start: "Starting",
    tool_call: "Tool call",
    node_complete: "Complete",
    error: "Error",
  }
  return map[type] || type
}

// ── Welcome State ──────────────────────────────────────────────────────
function WelcomeState({ onSelect }: { onSelect: (q: string) => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4">
      <div className="relative mb-6">
        <span className="absolute inset-0 h-16 w-16 rounded-2xl bg-gradient-to-br from-orange-500/20 to-amber-500/10 blur-xl" />
        <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl border border-white/[0.06] bg-white/[0.03]">
          <Flame className="h-8 w-8 text-orange-400" />
        </div>
      </div>

      <h1 className="mb-2 text-2xl font-semibold tracking-tight text-foreground">
        Ask Kiln anything
      </h1>
      <p className="mb-10 max-w-md text-center text-sm text-muted-foreground">
        Query the tool registry, search for tools, or get help with publishing.
      </p>

      <div className="grid w-full max-w-lg grid-cols-2 gap-3">
        {EXAMPLE_QUERIES.map((q) => (
          <button
            key={q.title}
            type="button"
            onClick={() => onSelect(q.description)}
            className="group rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 text-left transition-all hover:border-white/[0.12] hover:bg-white/[0.04]"
          >
            <p className="mb-1 text-[13px] font-medium text-foreground/90 transition-colors group-hover:text-foreground">
              {q.title}
            </p>
            <p className="text-xs text-muted-foreground/70 leading-relaxed">
              {q.description}
            </p>
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Message Bubble ─────────────────────────────────────────────────────
function MessageBubble({ message }: { message: ChatMessage }) {
  const [traceOpen, setTraceOpen] = useState(false)

  if (message.role === "error") {
    return (
      <div className="flex justify-start">
        <Card className="max-w-[85%] border-destructive/30 bg-destructive/[0.06]">
          <CardContent className="flex items-start gap-3 pt-0">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <p className="text-sm text-destructive/90">{message.content}</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="flex items-end gap-2.5">
          <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm text-primary-foreground shadow-sm">
            {message.content}
          </div>
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/[0.08] ring-1 ring-white/[0.06]">
            <User className="h-3.5 w-3.5 text-foreground/60" />
          </div>
        </div>
      </div>
    )
  }

  // Assistant
  return (
    <div className="flex justify-start">
      <div className="flex items-end gap-2.5">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-orange-500/20 to-amber-500/10 ring-1 ring-white/[0.06]">
          <Bot className="h-3.5 w-3.5 text-orange-400" />
        </div>
        <div className="max-w-[85%]">
          <Card className="border-white/[0.06] bg-white/[0.02] shadow-none">
            <CardContent className="pt-0">
              <p className="text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap">
                {message.content}
              </p>
            </CardContent>
          </Card>

          {/* Collapsible execution trace */}
          {message.trace && message.trace.length > 0 && (
            <button
              type="button"
              onClick={() => setTraceOpen(!traceOpen)}
              className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground/60 transition-colors hover:text-muted-foreground"
            >
              <ChevronDown
                className={`h-3 w-3 transition-transform ${traceOpen ? "rotate-180" : ""}`}
              />
              {message.trace.length} execution steps
            </button>
          )}
          {traceOpen && message.trace && (
            <div className="mt-2 space-y-1 rounded-lg border border-white/[0.04] bg-white/[0.01] p-3">
              {message.trace.map((evt, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <Badge variant="secondary" className="text-[10px] font-mono">
                    {formatEventType(evt.type)}
                  </Badge>
                  {evt.name && (
                    <span className="text-muted-foreground/70">{evt.name}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Streaming Indicator ────────────────────────────────────────────────
function StreamingIndicator({ events }: { events: StreamEvent[] }) {
  return (
    <div className="flex justify-start">
      <div className="flex items-end gap-2.5">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-orange-500/20 to-amber-500/10 ring-1 ring-white/[0.06]">
          <Bot className="h-3.5 w-3.5 text-orange-400" />
        </div>
        <Card className="min-w-[200px] border-white/[0.06] bg-white/[0.02] shadow-none">
          <CardContent className="pt-0">
            <div className="flex items-center gap-2 mb-3">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-orange-400" />
              <Badge variant="outline" className="text-[10px] border-orange-500/20 text-orange-400/80">
                Executing
              </Badge>
            </div>
            {events.length > 0 && (
              <div className="space-y-1.5">
                {events.slice(-5).map((evt, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 text-xs text-muted-foreground/60"
                  >
                    <span className="h-1 w-1 rounded-full bg-orange-400/40" />
                    <span className="font-mono">{formatEventType(evt.type)}</span>
                    {evt.name && (
                      <span className="truncate text-muted-foreground/40">
                        {evt.name}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

// ── Auth Gate ──────────────────────────────────────────────────────────
function AuthGate() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-20">
      <div className="relative mb-2">
        <span className="absolute inset-0 h-14 w-14 rounded-2xl bg-gradient-to-br from-orange-500/15 to-amber-500/5 blur-lg" />
        <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl border border-white/[0.06] bg-white/[0.03]">
          <Flame className="h-7 w-7 text-orange-400/60" />
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        Sign in to start chatting
      </p>
      <SignInButton>
        <Button className="bg-white/[0.08] text-foreground/80 hover:bg-white/[0.14] hover:text-foreground border-white/[0.06]">
          Sign in
        </Button>
      </SignInButton>
    </div>
  )
}

// ── Main Chat Component ────────────────────────────────────────────────
function KilnChat() {
  const { getToken } = useAuth()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamEvents, setStreamEvents] = useState<StreamEvent[]>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, streamEvents])

  // Auto-resize textarea
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setInput(e.target.value)
      const el = e.target
      el.style.height = "auto"
      el.style.height = Math.min(el.scrollHeight, 160) + "px"
    },
    []
  )

  const sendMessage = useCallback(
    async (text?: string) => {
      const content = (text || input).trim()
      if (!content || isStreaming) return

      setInput("")
      if (inputRef.current) {
        inputRef.current.style.height = "auto"
      }

      const userMsg: ChatMessage = {
        id: generateId(),
        role: "user",
        content,
      }
      setMessages((prev) => [...prev, userMsg])
      setIsStreaming(true)
      setStreamEvents([])

      try {
        const token = await getToken()
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        }
        if (token) headers["Authorization"] = `Bearer ${token}`

        // Start chat — get a run ID
        const res = await fetch(`${CHAT_BACKEND}/kiln/chat`, {
          method: "POST",
          headers,
          body: JSON.stringify({ message: content }),
        })

        if (!res.ok) {
          throw new Error(`Chat request failed: ${res.status} ${res.statusText}`)
        }

        const data = await res.json()
        const runId = data.run_id

        if (!runId) {
          // If no run_id, treat entire response as the answer
          setMessages((prev) => [
            ...prev,
            {
              id: generateId(),
              role: "assistant",
              content: data.response || data.message || JSON.stringify(data),
            },
          ])
          setIsStreaming(false)
          return
        }

        // Stream events via SSE
        const events: StreamEvent[] = []
        let assistantContent = ""

        const eventSource = new EventSource(
          `${CHAT_BACKEND}/kiln/stream/${runId}`
        )

        eventSource.onmessage = (event) => {
          try {
            const parsed = JSON.parse(event.data)

            if (parsed.type === "done" || parsed.type === "complete") {
              assistantContent = parsed.content || parsed.response || assistantContent
              eventSource.close()

              setMessages((prev) => [
                ...prev,
                {
                  id: generateId(),
                  role: "assistant",
                  content: assistantContent,
                  trace: [...events],
                },
              ])
              setIsStreaming(false)
              setStreamEvents([])
              return
            }

            if (parsed.type === "content" || parsed.type === "token") {
              assistantContent += parsed.content || parsed.token || ""
              return
            }

            // Track execution events
            const evt: StreamEvent = {
              type: parsed.type || "unknown",
              name: parsed.name || parsed.tool || undefined,
              timestamp: Date.now(),
            }
            events.push(evt)
            setStreamEvents([...events])
          } catch {
            // Non-JSON message — treat as content
            assistantContent += event.data
          }
        }

        eventSource.onerror = () => {
          eventSource.close()

          if (assistantContent) {
            setMessages((prev) => [
              ...prev,
              {
                id: generateId(),
                role: "assistant",
                content: assistantContent,
                trace: [...events],
              },
            ])
          } else {
            setMessages((prev) => [
              ...prev,
              {
                id: generateId(),
                role: "error",
                content: "Connection lost. Please try again.",
              },
            ])
          }
          setIsStreaming(false)
          setStreamEvents([])
        }
      } catch (err) {
        setMessages((prev) => [
          ...prev,
          {
            id: generateId(),
            role: "error",
            content:
              err instanceof Error ? err.message : "An unexpected error occurred.",
          },
        ])
        setIsStreaming(false)
        setStreamEvents([])
      }
    },
    [input, isStreaming, getToken]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault()
        sendMessage()
      }
    },
    [sendMessage]
  )

  const hasMessages = messages.length > 0

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto">
        {!hasMessages ? (
          <WelcomeState onSelect={(q) => sendMessage(q)} />
        ) : (
          <div className="mx-auto max-w-3xl space-y-6 px-4 pb-32 pt-4">
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
            {isStreaming && <StreamingIndicator events={streamEvents} />}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input bar */}
      <div className="shrink-0 border-t border-white/[0.04] bg-background/80 backdrop-blur-xl">
        <div className="mx-auto max-w-3xl px-4 py-4">
          <div className="flex items-end gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 transition-colors focus-within:border-white/[0.14] focus-within:bg-white/[0.04]">
            <textarea
              ref={inputRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="Ask Kiln anything..."
              rows={1}
              className="flex-1 resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
              disabled={isStreaming}
            />
            <Button
              size="icon-sm"
              disabled={!input.trim() || isStreaming}
              onClick={() => sendMessage()}
              className="shrink-0 bg-orange-500/90 text-white hover:bg-orange-500 disabled:bg-white/[0.04] disabled:text-muted-foreground/30 border-none"
            >
              {isStreaming ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
          <p className="mt-2 text-center text-[11px] text-muted-foreground/30">
            Kiln may produce inaccurate information. Verify important details.
          </p>
        </div>
      </div>
    </div>
  )
}

// ── Page ────────────────────────────────────────────────────────────────
export default function ChatPage() {
  return (
    <div className="-mx-6 -my-8">
      <Show when="signed-out">
        <AuthGate />
      </Show>
      <Show when="signed-in">
        <KilnChat />
      </Show>
    </div>
  )
}
