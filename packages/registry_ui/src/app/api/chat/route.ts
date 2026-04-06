/**
 * /api/chat — Bridge between AI SDK v6 chat and Kiln's backend.
 *
 * AI SDK sends: { messages: [{ parts: [...], role: "user" }] }
 * We extract the last user message, call /kiln/start, connect to the SSE stream,
 * and convert Kiln events to AI SDK UI Message Stream Protocol (text-start/text-delta/text-end).
 */

const CHAT_BACKEND = process.env.CHAT_BACKEND_INTERNAL || process.env.NEXT_PUBLIC_CHAT_BACKEND || "http://localhost:8765"

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  "x-vercel-ai-ui-message-stream": "v1",
}

export async function POST(req: Request) {
  const { messages } = await req.json()

  // Extract last user message (handles both AI SDK v6 `parts` and legacy `content` format)
  const lastUser = [...messages].reverse().find((m: { role: string }) => m.role === "user")
  let query = ""
  if (typeof lastUser?.content === "string") {
    query = lastUser.content
  } else if (Array.isArray(lastUser?.content)) {
    query = lastUser.content.find((p: { type: string; text?: string }) => p.type === "text")?.text || ""
  } else if (Array.isArray(lastUser?.parts)) {
    query = lastUser.parts.find((p: { type: string; text?: string }) => p.type === "text")?.text || ""
  }

  if (!query.trim()) {
    return streamSimpleText("Please provide a query.")
  }

  // Build conversation history from last 10 messages for context
  const history = buildHistory(messages)

  // Forward auth header
  const authHeader = req.headers.get("authorization")
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (authHeader) headers["Authorization"] = authHeader

  try {
    // Call Kiln backend with current query + conversation history
    const res = await fetch(`${CHAT_BACKEND}/kiln/start`, {
      method: "POST",
      headers,
      body: JSON.stringify({ request: query, history }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: `Error ${res.status}` }))
      const msg = typeof err.detail === "string" ? err.detail : JSON.stringify(err.detail)
      return streamSimpleText(`Error: ${msg}`)
    }

    const data = await res.json()

    if (data.status === "needs_config") {
      const payload = JSON.stringify({
        type: "needs_config",
        run_id: data.run_id,
        missing_envs: data.missing_envs,
      })
      return streamSimpleText(`__KILN_CONFIG__${payload}`)
    }

    // Stream execution events
    return streamKilnExecution(data.run_id)
  } catch (err) {
    return streamSimpleText(`Error: ${err}`)
  }
}

/** Stream a simple text response using AI SDK UI Message Stream Protocol */
function streamSimpleText(text: string): Response {
  const encoder = new TextEncoder()
  const msgId = `msg_${Date.now()}`
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "text-start", id: msgId })}\n\n`))
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "text-delta", id: msgId, delta: text })}\n\n`))
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "text-end", id: msgId })}\n\n`))
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "finish" })}\n\n`))
      controller.enqueue(encoder.encode("data: [DONE]\n\n"))
      controller.close()
    },
  })
  return new Response(stream, { headers: SSE_HEADERS })
}

/** Connect to Kiln's SSE stream and convert to AI SDK UI Message Stream Protocol */
function streamKilnExecution(runId: string): Response {
  const encoder = new TextEncoder()
  const msgId = `msg_${runId}`

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false
      let started = false

      function ensureStarted() {
        if (!started) {
          started = true
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "text-start", id: msgId })}\n\n`))
        }
      }

      function sendDelta(content: string) {
        if (closed) return
        ensureStarted()
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "text-delta", id: msgId, delta: content })}\n\n`))
      }

      function finish() {
        if (closed) return
        closed = true
        ensureStarted()
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "text-end", id: msgId })}\n\n`))
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "finish" })}\n\n`))
        controller.enqueue(encoder.encode("data: [DONE]\n\n"))
        controller.close()
      }

      // Connect to Kiln SSE
      const sseRes = await fetch(`${CHAT_BACKEND}/kiln/stream/${runId}`)
      if (!sseRes.ok || !sseRes.body) {
        sendDelta("Error: Could not connect to execution stream")
        finish()
        return
      }

      const reader = sseRes.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""

      sendDelta("🔄 Planning and executing...\n\n")

      // Keep-alive: send SSE comment every 30s to prevent proxy/connection timeout
      const keepAlive = setInterval(() => {
        if (!closed) {
          controller.enqueue(encoder.encode(": keepalive\n\n"))
        }
      }, 30_000)

      try {
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

            try {
              const ev = JSON.parse(raw)

              switch (ev.type) {
                case "plan_ready":
                case "plan_updated": {
                  const nodes = ev.nodes?.map((n: { role: string }) => n.role).join(" → ") || ""
                  sendDelta(`**Plan:** ${nodes}\n\n`)
                  break
                }
                case "synthesis_wait":
                  sendDelta("Synthesizing missing tools...\n")
                  break
                case "tool_ready":
                  sendDelta(`Tool ready: ${ev.tool_id}\n`)
                  break
                case "node_start":
                  sendDelta(`**${ev.node_id}** starting...\n`)
                  break
                case "tool_call":
                  sendDelta(`  → Calling \`${ev.tool}\`\n`)
                  break
                case "tool_result":
                  sendDelta("  ← Result received\n")
                  break
                case "node_complete":
                  sendDelta(`**${ev.node_id}** done\n\n`)
                  break
                case "flow_complete":
                  sendDelta(`\n---\n\n${ev.final_answer}`)
                  finish()
                  return
                case "error":
                  sendDelta(`\nError: ${ev.message}`)
                  finish()
                  return
              }
            } catch {
              // skip malformed events
            }
          }
        }

        if (!closed) finish()
      } catch (err) {
        sendDelta(`\nStream error: ${err}`)
        finish()
      } finally {
        clearInterval(keepAlive)
      }
    },
  })

  return new Response(stream, { headers: SSE_HEADERS })
}

/** Extract text from last 10 messages as conversation history */
function buildHistory(messages: Array<{ role: string; content?: string | Array<{ type: string; text?: string }>; parts?: Array<{ type: string; text?: string }> }>): string[] {
  // Take last 10 messages (excluding the very last user message which is the current query)
  const recent = messages.slice(-11, -1)
  return recent
    .map((m) => {
      let text = ""
      if (typeof m.content === "string") {
        text = m.content
      } else if (Array.isArray(m.content)) {
        text = m.content.find((p) => p.type === "text")?.text || ""
      } else if (Array.isArray(m.parts)) {
        text = m.parts.find((p) => p.type === "text")?.text || ""
      }
      // Skip config messages
      if (text.startsWith("__KILN_CONFIG__")) return null
      // Truncate long messages
      if (text.length > 500) text = text.slice(0, 500) + "..."
      return text ? `${m.role}: ${text}` : null
    })
    .filter((line): line is string => line !== null)
}
