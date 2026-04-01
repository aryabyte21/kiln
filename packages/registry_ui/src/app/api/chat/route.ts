/**
 * /api/chat — Bridge between AI SDK v6 useChat and Kiln's chat backend.
 *
 * AI SDK v6 useChat + DefaultChatTransport sends: { messages: [...] }
 * We extract the last user message, call /kiln/start, connect to the SSE
 * stream, and convert Kiln events to AI SDK UIMessageStream format.
 *
 * UIMessageStream protocol (SSE):
 *   data: {"type":"text-start","id":"<partId>"}\n\n
 *   data: {"type":"text-delta","id":"<partId>","delta":"text"}\n\n
 *   data: {"type":"text-end","id":"<partId>"}\n\n
 *   data: [DONE]\n\n
 *
 * Header: x-vercel-ai-ui-message-stream: v1
 */

const CHAT_BACKEND = process.env.CHAT_BACKEND_INTERNAL || process.env.NEXT_PUBLIC_CHAT_BACKEND || "http://localhost:8765"

const UI_STREAM_HEADERS = {
  "content-type": "text/event-stream",
  "cache-control": "no-cache",
  "connection": "keep-alive",
  "x-vercel-ai-ui-message-stream": "v1",
  "x-accel-buffering": "no",
}

export async function POST(req: Request) {
  const body = await req.json()
  const messages = body.messages || []
  const lastUser = [...messages].reverse().find((m: { role: string }) => m.role === "user")

  let query = ""
  if (typeof lastUser?.content === "string") {
    query = lastUser.content
  } else if (Array.isArray(lastUser?.content)) {
    query = lastUser.content.find((p: { type: string; text?: string }) => p.type === "text")?.text || ""
  }

  if (!query.trim()) {
    return uiTextResponse("Please provide a query.")
  }

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
      return uiTextResponse(`Error: ${msg}`)
    }

    const data = await res.json()

    if (data.status === "needs_config") {
      // Auto-execute with empty env vars
      const execRes = await fetch(`${CHAT_BACKEND}/kiln/execute/${data.run_id}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ env_vars: {} }),
      })
      if (!execRes.ok) {
        const missing = data.missing_envs?.map((e: { var_name: string }) => e.var_name).join(", ")
        return uiTextResponse(`Missing API keys: ${missing}\n\nPlease configure them in the server environment.`)
      }
    }

    return streamKilnAsUIMessage(data.run_id)
  } catch (err) {
    return uiTextResponse(`Error connecting to Kiln backend: ${err}`)
  }
}

/** Emit a complete text response using UIMessageStream SSE protocol */
function uiTextResponse(text: string): Response {
  const partId = `part-${Date.now()}`
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "text-start", id: partId })}\n\n`))
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "text-delta", id: partId, delta: text })}\n\n`))
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "text-end", id: partId })}\n\n`))
      controller.enqueue(encoder.encode("data: [DONE]\n\n"))
      controller.close()
    },
  })
  return new Response(stream, { headers: UI_STREAM_HEADERS })
}

/** Connect to Kiln's SSE stream and convert to UIMessageStream SSE protocol */
function streamKilnAsUIMessage(runId: string): Response {
  const partId = `part-${runId}`
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false
      let started = false

      function sendDelta(text: string) {
        if (closed) return
        if (!started) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "text-start", id: partId })}\n\n`))
          started = true
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "text-delta", id: partId, delta: text })}\n\n`))
      }

      function finish() {
        if (closed) return
        closed = true
        if (started) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "text-end", id: partId })}\n\n`))
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"))
        controller.close()
      }

      try {
        const sseRes = await fetch(`${CHAT_BACKEND}/kiln/stream/${runId}`)
        if (!sseRes.ok || !sseRes.body) {
          sendDelta("Error: Could not connect to execution stream")
          finish()
          return
        }

        const reader = sseRes.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ""

        sendDelta("Planning and executing...\n\n")

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
      }
    },
  })

  return new Response(stream, { headers: UI_STREAM_HEADERS })
}
