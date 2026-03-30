"use client"

import { useState } from "react"
import { useAuth } from "@clerk/nextjs"
import { Show } from "@clerk/nextjs"
import { Send, Loader2, AlertCircle, Bot, User, Flame } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

const CHAT_BACKEND = process.env.NEXT_PUBLIC_CHAT_BACKEND || "http://localhost:8765"
const EXAMPLES = [
  "What is the current gold price and predict if it will rise tomorrow?",
  "Find the latest papers on transformer attention and summarize the top 3.",
  "Get Bitcoin historical data for last 30 days and analyze the trend.",
  "Convert 5000 SGD to USD and show the current exchange rate.",
]

interface Message {
  role: "user" | "assistant" | "system"
  content: string
}

interface NodeEvent {
  type: string
  node_id?: string
  role?: string
  tool?: string
  args?: Record<string, unknown>
  result?: unknown
  final_answer?: string
  message?: string
}

export default function ChatPage() {
  const { getToken } = useAuth()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [events, setEvents] = useState<NodeEvent[]>([])

  const submit = async (query?: string) => {
    const q = query || input.trim()
    if (!q || isLoading) return

    setInput("")
    setMessages(prev => [...prev, { role: "user", content: q }])
    setEvents([])
    setIsLoading(true)

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
        setMessages(prev => [...prev, { role: "system", content: errorMsg }])
        setIsLoading(false)
        return
      }

      const data = await res.json()
      const runId = data.run_id

      if (data.status === "needs_config") {
        setMessages(prev => [...prev, {
          role: "system",
          content: `Missing API keys: ${data.missing_envs?.map((e: { var_name: string }) => e.var_name).join(", ")}. Configure them in your environment and retry.`
        }])
        setIsLoading(false)
        return
      }

      // Connect to SSE stream
      const src = new EventSource(`${CHAT_BACKEND}/kiln/stream/${runId}`)

      src.onmessage = (e) => {
        const ev: NodeEvent = JSON.parse(e.data)
        setEvents(prev => [...prev, ev])

        if (ev.type === "flow_complete") {
          setMessages(prev => [...prev, { role: "assistant", content: ev.final_answer || "Done." }])
          setIsLoading(false)
          src.close()
        } else if (ev.type === "error") {
          setMessages(prev => [...prev, { role: "system", content: ev.message || "Unknown error" }])
          setIsLoading(false)
          src.close()
        }
      }

      src.onerror = () => {
        setMessages(prev => [...prev, { role: "system", content: "Connection lost" }])
        setIsLoading(false)
        src.close()
      }
    } catch (err) {
      setMessages(prev => [...prev, { role: "system", content: String(err) }])
      setIsLoading(false)
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-4 pb-4">
        {messages.length === 0 && !isLoading && (
          <div className="flex flex-col items-center justify-center h-full gap-6">
            <div className="flex items-center gap-2">
              <Flame className="h-8 w-8 text-orange-500" />
              <h2 className="text-2xl font-bold">Ask Kiln anything</h2>
            </div>
            <p className="text-muted-foreground text-center max-w-md">
              Kiln plans, fetches, synthesizes, and answers — building new tools on the fly when needed.
            </p>
            <div className="grid gap-2 max-w-lg w-full">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  onClick={() => submit(ex)}
                  className="text-left rounded-lg border border-border/50 px-4 py-3 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-3 ${msg.role === "user" ? "justify-end" : ""}`}>
            {msg.role !== "user" && (
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
                {msg.role === "assistant" ? <Bot className="h-4 w-4" /> : <AlertCircle className="h-4 w-4 text-destructive" />}
              </div>
            )}
            <div className={`max-w-[80%] rounded-xl px-4 py-3 text-sm ${
              msg.role === "user"
                ? "bg-primary text-primary-foreground"
                : msg.role === "system"
                ? "bg-destructive/10 text-destructive border border-destructive/20"
                : "bg-card border border-border"
            }`}>
              <p className="whitespace-pre-wrap">{msg.content}</p>
            </div>
            {msg.role === "user" && (
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary">
                <User className="h-4 w-4 text-primary-foreground" />
              </div>
            )}
          </div>
        ))}

        {/* Live events during execution */}
        {isLoading && events.length > 0 && (
          <Card className="border-blue-500/20 bg-blue-500/5">
            <CardContent className="pt-4 space-y-1">
              <div className="flex items-center gap-2 mb-2">
                <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                <span className="text-sm font-medium text-blue-500">Executing...</span>
              </div>
              {events.slice(-8).map((ev, i) => (
                <div key={i} className="text-xs text-muted-foreground font-mono">
                  {ev.type === "node_start" && <span className="text-blue-400">▸ Starting {ev.node_id}</span>}
                  {ev.type === "tool_call" && <span className="text-amber-400">→ {ev.tool}({JSON.stringify(ev.args).slice(0, 60)})</span>}
                  {ev.type === "tool_result" && <span className="text-green-400">← {ev.tool}: done</span>}
                  {ev.type === "node_complete" && <span className="text-green-400">✓ {ev.node_id} complete</span>}
                  {ev.type === "plan_ready" && <span className="text-purple-400">📋 Plan ready</span>}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {isLoading && events.length === 0 && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Planning...</span>
          </div>
        )}
      </div>

      {/* Input */}
      <Show when="signed-out">
        <div className="text-center py-4">
          <Badge variant="outline" className="text-muted-foreground">Sign in to use the chat</Badge>
        </div>
      </Show>
      <Show when="signed-in">
        <form
          onSubmit={(e) => { e.preventDefault(); submit() }}
          className="flex gap-2 border-t border-border pt-4"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask Kiln anything..."
            disabled={isLoading}
            className="flex-1 rounded-lg border border-border bg-background px-4 py-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <Button type="submit" disabled={isLoading || !input.trim()} size="icon" className="h-12 w-12">
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </form>
      </Show>
    </div>
  )
}
