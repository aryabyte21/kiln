/**
 * /api/chat — Bridge between AI SDK useChat and Kiln's chat backend.
 *
 * AI SDK v6 useChat + DefaultChatTransport sends: { messages: [...] }
 * We extract the last user message, call /kiln/start, connect to the SSE
 * stream, and convert Kiln events to AI SDK's UIMessageStream format.
 */

const CHAT_BACKEND = process.env.CHAT_BACKEND_INTERNAL || process.env.NEXT_PUBLIC_CHAT_BACKEND || "http://localhost:8765"

export async function POST(req: Request) {
  const body = await req.json()

  // AI SDK v6 sends messages array
  const messages = body.messages || []
  const lastUser = [...messages].reverse().find((m: { role: string }) => m.role === "user")

  // Extract text from content (could be string or parts array)
  let query = ""
  if (typeof lastUser?.content === "string") {
    query = lastUser.content
  } else if (Array.isArray(lastUser?.content)) {
    query = lastUser.content.find((p: { type: string; text?: string }) => p.type === "text")?.text || ""
  }

  if (!query.trim()) {
    return uiStream("Please provide a query.")
  }

  // Forward auth header to chat backend
  const authHeader = req.headers.get("authorization")
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (authHeader) headers["Authorization"] = authHeader

  try {
    const res = await fetch(`${CHAT_BACKEND}/kiln/start`, {
      method: "POST",
      headers,
      body: JSON.stringify({ request: query }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: `Error ${res.status}` }))
      const msg = typeof err.detail === "string" ? err.detail : JSON.stringify(err.detail)
      return uiStream(`Error: ${msg}`)
    }

    const data = await res.json()

    if (data.status === "needs_config") {
      // Auto-execute with empty env vars — let tools handle missing keys
      const execRes = await fetch(`${CHAT_BACKEND}/kiln/execute/${data.run_id}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ env_vars: {} }),
      })
      if (!execRes.ok) {
        const missing = data.missing_envs?.map((e: { var_name: string }) => e.var_name).join(", ")
        return uiStream(`Missing API keys: ${missing}\n\nPlease configure them in the server environment.`)
      }
    }

    // Stream execution events as AI SDK UIMessageStream
    return streamKilnAsUIMessage(data.run_id)
  } catch (err) {
    return uiStream(`Error connecting to Kiln backend: ${err}`)
  }
}

/**
 * Send a single text response as AI SDK UIMessageStream format.
 *
 * UIMessageStream protocol:
 *   2:<json>\n  → text part append
 *   d:<json>\n  → finish message
 */
function uiStream(text: string): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      // Text part
      controller.enqueue(encoder.encode(`2:${JSON.stringify(text)}\n`))
      // Finish
      controller.enqueue(encoder.encode(`d:${JSON.stringify({ finishReason: "stop", usage: { promptTokens: 0, completionTokens: 0 } })}\n`))
      controller.close()
    },
  })
  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Vercel-AI-Data-Stream": "v1",
    },
  })
}

/**
 * Connect to Kiln's SSE stream and convert to AI SDK UIMessageStream.
 *
 * Kiln events → human-readable text streamed via UIMessageStream protocol.
 */
function streamKilnAsUIMessage(runId: string): Response {
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false

      function sendText(text: string) {
        if (closed) return
        controller.enqueue(encoder.encode(`2:${JSON.stringify(text)}\n`))
      }

      function finish() {
        if (closed) return
        closed = true
        controller.enqueue(encoder.encode(`d:${JSON.stringify({ finishReason: "stop", usage: { promptTokens: 0, completionTokens: 0 } })}\n`))
        controller.close()
      }

      try {
        const sseRes = await fetch(`${CHAT_BACKEND}/kiln/stream/${runId}`)
        if (!sseRes.ok || !sseRes.body) {
          sendText("Error: Could not connect to execution stream")
          finish()
          return
        }

        const reader = sseRes.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ""

        sendText("Planning and executing...\n\n")

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
                  sendText(`**Plan:** ${nodes}\n\n`)
                  break
                }
                case "synthesis_wait":
                  sendText(`Synthesizing missing tools...\n`)
                  break
                case "tool_ready":
                  sendText(`Tool ready: ${ev.tool_id}\n`)
                  break
                case "node_start":
                  sendText(`**${ev.node_id}** starting...\n`)
                  break
                case "tool_call":
                  sendText(`  → Calling \`${ev.tool}\`\n`)
                  break
                case "tool_result":
                  sendText(`  ← Result received\n`)
                  break
                case "node_complete":
                  sendText(`**${ev.node_id}** done\n\n`)
                  break
                case "flow_complete":
                  sendText(`\n---\n\n${ev.final_answer}`)
                  finish()
                  return
                case "error":
                  sendText(`\nError: ${ev.message}`)
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
        sendText(`\nStream error: ${err}`)
        finish()
      }
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Vercel-AI-Data-Stream": "v1",
    },
  })
}
