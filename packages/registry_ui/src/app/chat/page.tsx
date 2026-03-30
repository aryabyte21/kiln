"use client"

import { useCallback, useRef, useState } from "react"
import { useAuth } from "@clerk/nextjs"
import { Show } from "@clerk/nextjs"
import { Send, Loader2, Bot, User, Flame, AlertCircle } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

const CHAT_BACKEND = process.env.NEXT_PUBLIC_CHAT_BACKEND || "http://localhost:8765"

const EXAMPLES = [
  "What is the current gold price and predict if it will rise tomorrow?",
  "Find the latest papers on transformer attention and summarize the top 3.",
  "Get Bitcoin historical data for last 30 days and analyze the trend.",
  "Convert 5000 SGD to USD and show the current exchange rate.",
  "What are the top geopolitical events this week?",
  "Analyze the market impact of recent Fed policy changes on tech stocks.",
]

interface ChatMessage {
  id: string
  role: "user" | "assistant" | "error"
  content: string
  events?: NodeEvent[]
}

interface NodeEvent {
  type: string
  node_id?: string
  tool?: string
  args?: Record<string, unknown>
  final_answer?: string
  message?: string
}

export default function ChatPage() {
  const { getToken } = useAuth()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [isStreaming, setIsStreaming] = useState(false)
  const [liveEvents, setLiveEvents] = useState<NodeEvent[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }), 50)
  }

  const submit = useCallback(async (query?: string) => {
    const q = (query || input).trim()
    if (!q || isStreaming) return

    setInput("")
    setMessages(prev => [...prev, { id: `u-${Date.now()}`, role: "user", content: q }])
    setLiveEvents([])
    setIsStreaming(true)
    scrollToBottom()

    try {
      const token = await getToken()
      const headers: Record<string, string> = { "Content-Type": "application/json" }
      if (token) headers["Authorization"] = `Bearer ${token}`

      const res = await fetch(`${CHAT_BACKEND}/kiln/start`, {
        method: "POST",
        headers,
        body: JSON.stringify({ request: q }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: `Server error ${res.status}` }))
        const errorMsg = typeof err.detail === "string" ? err.detail : JSON.stringify(err.detail)
        setMessages(prev => [...prev, { id: `e-${Date.now()}`, role: "error", content: errorMsg }])
        setIsStreaming(false)
        scrollToBottom()
        return
      }

      const data = await res.json()

      if (data.status === "needs_config") {
        const missing = data.missing_envs?.map((e: { var_name: string }) => e.var_name).join(", ")
        setMessages(prev => [...prev, { id: `e-${Date.now()}`, role: "error", content: `Missing API keys: ${missing}` }])
        setIsStreaming(false)
        return
      }

      const allEvents: NodeEvent[] = []
      const src = new EventSource(`${CHAT_BACKEND}/kiln/stream/${data.run_id}`)

      src.onmessage = (e) => {
        try {
          const ev: NodeEvent = JSON.parse(e.data)
          allEvents.push(ev)
          setLiveEvents([...allEvents])
          scrollToBottom()

          if (ev.type === "flow_complete") {
            setMessages(prev => [...prev, {
              id: `a-${Date.now()}`,
              role: "assistant",
              content: ev.final_answer || "Done.",
              events: [...allEvents],
            }])
            setLiveEvents([])
            setIsStreaming(false)
            src.close()
            scrollToBottom()
          } else if (ev.type === "error") {
            setMessages(prev => [...prev, { id: `e-${Date.now()}`, role: "error", content: ev.message || "Error" }])
            setLiveEvents([])
            setIsStreaming(false)
            src.close()
          }
        } catch { /* skip malformed */ }
      }

      src.onerror = () => {
        setMessages(prev => [...prev, { id: `e-${Date.now()}`, role: "error", content: "Connection lost" }])
        setLiveEvents([])
        setIsStreaming(false)
        src.close()
      }
    } catch (err) {
      setMessages(prev => [...prev, { id: `e-${Date.now()}`, role: "error", content: String(err) }])
      setIsStreaming(false)
    }
  }, [input, isStreaming, getToken])

  return (
    <div className="flex flex-col h-[calc(100vh-7.5rem)]">
      <div className="flex-1 overflow-y-auto" ref={scrollRef}>
        <div className="max-w-3xl mx-auto space-y-6 py-6 px-4">
          {messages.length === 0 && !isStreaming && (
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-8">
              <div className="text-center space-y-3">
                <div className="flex items-center justify-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-500/10 ring-1 ring-orange-500/20">
                    <Flame className="h-6 w-6 text-orange-500" />
                  </div>
                </div>
                <h2 className="text-2xl font-bold tracking-tight">Ask Kiln anything</h2>
                <p className="text-muted-foreground max-w-md mx-auto">
                  Kiln plans, fetches, synthesizes, and answers — building new tools on the fly when needed.
                </p>
              </div>
              <div className="grid sm:grid-cols-2 gap-2 max-w-2xl w-full">
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex}
                    onClick={() => submit(ex)}
                    className="group text-left rounded-xl border border-border/60 bg-card/50 px-4 py-3 text-sm text-muted-foreground transition-all hover:bg-accent hover:text-accent-foreground hover:border-border hover:shadow-sm"
                  >
                    <span className="line-clamp-2">{ex}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <div key={msg.id} className={`flex gap-3 ${msg.role === "user" ? "justify-end" : ""}`}>
              {msg.role !== "user" && (
                <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                  msg.role === "error" ? "bg-destructive/10 ring-1 ring-destructive/20" : "bg-primary/10 ring-1 ring-primary/20"
                }`}>
                  {msg.role === "assistant" ? <Bot className="h-4 w-4 text-primary" /> : <AlertCircle className="h-4 w-4 text-destructive" />}
                </div>
              )}
              <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                msg.role === "user" ? "bg-primary text-primary-foreground"
                : msg.role === "error" ? "bg-destructive/5 text-destructive border border-destructive/15"
                : "bg-card border border-border/60 shadow-sm"
              }`}>
                <p className="whitespace-pre-wrap">{msg.content}</p>
                {msg.events && msg.events.length > 0 && (
                  <details className="mt-3 pt-3 border-t border-border/30">
                    <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                      Execution trace ({msg.events.length} events)
                    </summary>
                    <div className="mt-2 space-y-0.5 font-mono text-[11px] text-muted-foreground">
                      {msg.events.filter(e => ["node_start","tool_call","node_complete","plan_ready"].includes(e.type)).map((ev, i) => (
                        <div key={i}>
                          {ev.type === "plan_ready" && <span className="text-purple-400">Plan ready</span>}
                          {ev.type === "node_start" && <span className="text-blue-400">▸ {ev.node_id}</span>}
                          {ev.type === "tool_call" && <span className="text-amber-400">  → {ev.tool}</span>}
                          {ev.type === "node_complete" && <span className="text-green-400">  ✓ {ev.node_id}</span>}
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
              {msg.role === "user" && (
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary ring-1 ring-primary/50">
                  <User className="h-4 w-4 text-primary-foreground" />
                </div>
              )}
            </div>
          ))}

          {isStreaming && (
            <div className="flex gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-500/10 ring-1 ring-blue-500/20">
                <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
              </div>
              <Card className="max-w-[85%] border-blue-500/20 bg-blue-500/5 shadow-sm">
                <CardContent className="pt-3 pb-3 space-y-1.5">
                  <Badge variant="outline" className="text-[10px] border-blue-500/30 text-blue-500">Executing</Badge>
                  {liveEvents.slice(-6).map((ev, i) => (
                    <div key={i} className="text-xs font-mono text-muted-foreground">
                      {ev.type === "plan_ready" && <span className="text-purple-400">Plan ready</span>}
                      {ev.type === "node_start" && <span className="text-blue-400">▸ {ev.node_id}</span>}
                      {ev.type === "tool_call" && <span className="text-amber-400">→ {ev.tool}</span>}
                      {ev.type === "tool_result" && <span className="text-green-400">← done</span>}
                      {ev.type === "node_complete" && <span className="text-green-400">✓ {ev.node_id}</span>}
                    </div>
                  ))}
                  {liveEvents.length === 0 && <span className="text-xs text-muted-foreground">Planning...</span>}
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-border bg-background/80 backdrop-blur-sm">
        <div className="max-w-3xl mx-auto px-4 py-3">
          <Show when="signed-out">
            <div className="text-center py-2">
              <Badge variant="secondary">Sign in to use the chat</Badge>
            </div>
          </Show>
          <Show when="signed-in">
            <form onSubmit={(e) => { e.preventDefault(); submit() }} className="flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask Kiln anything..."
                disabled={isStreaming}
                className="flex-1 rounded-xl border border-border bg-card px-4 py-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/50 disabled:opacity-50"
              />
              <Button type="submit" disabled={isStreaming || !input.trim()} size="icon" className="h-[46px] w-[46px] rounded-xl">
                {isStreaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </form>
          </Show>
        </div>
      </div>
    </div>
  )
}
