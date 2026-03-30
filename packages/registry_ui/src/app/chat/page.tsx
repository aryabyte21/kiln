"use client"

import { useCallback, useRef } from "react"
import { useAuth } from "@clerk/nextjs"
import { Show } from "@clerk/nextjs"
import { FullScreen } from "@openuidev/react-ui"
import "@openuidev/react-ui/defaults.css"
import "@openuidev/react-ui/components.css"

const CHAT_BACKEND = process.env.NEXT_PUBLIC_CHAT_BACKEND || "http://localhost:8765"

const EXAMPLES = [
  "What is the current gold price and predict if it will rise tomorrow?",
  "Find the latest papers on transformer attention and summarize the top 3.",
  "Get Bitcoin historical data for last 30 days and analyze the trend.",
  "Convert 5000 SGD to USD and show the current exchange rate.",
  "What are the top geopolitical events this week?",
  "Analyze the market impact of recent Fed policy changes on tech stocks.",
]

export default function ChatPage() {
  const { getToken } = useAuth()
  const tokenRef = useRef<string | null>(null)

  // Keep token fresh
  const refreshToken = useCallback(async () => {
    tokenRef.current = await getToken()
  }, [getToken])

  const processMessage = useCallback(async ({
    messages,
    abortController,
  }: {
    threadId: string
    messages: Array<{ role: string; content: string | Array<{ type: string; text?: string }> }>
    abortController: AbortController
  }): Promise<Response> => {
    await refreshToken()

    // Extract the last user message
    const lastUserMsg = [...messages].reverse().find(m => m.role === "user")
    const query = typeof lastUserMsg?.content === "string"
      ? lastUserMsg.content
      : Array.isArray(lastUserMsg?.content)
        ? lastUserMsg.content.find((p: { type: string; text?: string }) => p.type === "text")?.text || ""
        : ""

    if (!query.trim()) {
      return new Response("No query provided", { status: 400 })
    }

    const headers: Record<string, string> = { "Content-Type": "application/json" }
    if (tokenRef.current) headers["Authorization"] = `Bearer ${tokenRef.current}`

    try {
      const res = await fetch(`${CHAT_BACKEND}/kiln/start`, {
        method: "POST",
        headers,
        body: JSON.stringify({ request: query }),
        signal: abortController.signal,
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: `Error ${res.status}` }))
        const msg = typeof err.detail === "string" ? err.detail : JSON.stringify(err.detail)
        return textResponse(`Error: ${msg}`)
      }

      const data = await res.json()

      if (data.status === "needs_config") {
        const missing = data.missing_envs?.map((e: { var_name: string }) => e.var_name).join(", ")
        return textResponse(`⚠️ Missing API keys: ${missing}\n\nConfigure them in your environment and retry.`)
      }

      // Stream the execution
      return streamExecution(data.run_id, abortController.signal)
    } catch (err) {
      if (abortController.signal.aborted) {
        return textResponse("Request cancelled.")
      }
      return textResponse(`Error: ${err}`)
    }
  }, [refreshToken])

  return (
    <div className="h-[calc(100vh-8rem)]">
      <Show when="signed-out">
        <div className="flex items-center justify-center h-full">
          <p className="text-muted-foreground">Sign in to use the chat</p>
        </div>
      </Show>
      <Show when="signed-in">
        <FullScreen
          processMessage={processMessage}
          agentName="Kiln"
          conversationStarters={EXAMPLES.map(q => ({ prompt: q, displayText: q }))}
          disableThemeProvider
        />
      </Show>
    </div>
  )
}

/** Create a simple text response that OpenUI can render */
function textResponse(text: string): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      // OpenUI expects SSE format with data: prefix
      const lines = [
        `data: ${JSON.stringify({ type: "text_message_start", messageId: "m1", role: "assistant" })}`,
        `data: ${JSON.stringify({ type: "text_message_content", messageId: "m1", delta: text })}`,
        `data: ${JSON.stringify({ type: "text_message_end", messageId: "m1" })}`,
        `data: [DONE]`,
      ]
      controller.enqueue(encoder.encode(lines.join("\n\n") + "\n\n"))
      controller.close()
    }
  })
  return new Response(stream, { headers: { "Content-Type": "text/event-stream" } })
}

/** Connect to Kiln's SSE stream and convert events to OpenUI format */
function streamExecution(runId: string, signal: AbortSignal): Response {
  const encoder = new TextEncoder()
  const messageId = `kiln-${runId}`

  const stream = new ReadableStream({
    start(controller) {
      let closed = false

      function send(line: string) {
        if (closed) return
        controller.enqueue(encoder.encode(`data: ${line}\n\n`))
      }

      function close() {
        if (closed) return
        closed = true
        send(JSON.stringify({ type: "text_message_end", messageId }))
        send("[DONE]")
        controller.close()
      }

      // Start message
      send(JSON.stringify({ type: "text_message_start", messageId, role: "assistant" }))
      send(JSON.stringify({ type: "text_message_content", messageId, delta: "🔄 Planning and executing...\n\n" }))

      const src = new EventSource(`${CHAT_BACKEND}/kiln/stream/${runId}`)

      signal.addEventListener("abort", () => {
        src.close()
        close()
      })

      src.onmessage = (e) => {
        try {
          const ev = JSON.parse(e.data)

          if (ev.type === "plan_ready" || ev.type === "plan_updated") {
            const nodes = ev.nodes?.map((n: { role: string }) => n.role).join(" → ") || ""
            send(JSON.stringify({ type: "text_message_content", messageId, delta: `📋 **Plan:** ${nodes}\n\n` }))
          } else if (ev.type === "node_start") {
            send(JSON.stringify({ type: "text_message_content", messageId, delta: `▸ Starting **${ev.node_id}**...\n` }))
          } else if (ev.type === "tool_call") {
            send(JSON.stringify({ type: "text_message_content", messageId, delta: `  → Calling \`${ev.tool}\`\n` }))
          } else if (ev.type === "node_complete") {
            send(JSON.stringify({ type: "text_message_content", messageId, delta: `  ✓ **${ev.node_id}** done\n\n` }))
          } else if (ev.type === "flow_complete") {
            send(JSON.stringify({ type: "text_message_content", messageId, delta: `\n---\n\n${ev.final_answer}` }))
            src.close()
            close()
          } else if (ev.type === "error") {
            send(JSON.stringify({ type: "text_message_content", messageId, delta: `\n❌ Error: ${ev.message}` }))
            src.close()
            close()
          }
        } catch {
          // skip malformed events
        }
      }

      src.onerror = () => {
        send(JSON.stringify({ type: "text_message_content", messageId, delta: "\n❌ Connection lost" }))
        src.close()
        close()
      }
    }
  })

  return new Response(stream, { headers: { "Content-Type": "text/event-stream" } })
}
