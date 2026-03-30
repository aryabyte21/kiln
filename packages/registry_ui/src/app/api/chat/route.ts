/**
 * /api/chat — Bridge between OpenUI's chat format and Kiln's backend.
 *
 * OpenUI sends: { messages: [...] }
 * We extract the last user message, call /kiln/start, connect to the SSE stream,
 * and convert Kiln events to OpenAI-compatible SSE format that OpenUI can render.
 */

const CHAT_BACKEND = process.env.CHAT_BACKEND_INTERNAL || process.env.NEXT_PUBLIC_CHAT_BACKEND || "http://localhost:8765"

export async function POST(req: Request) {
  const { messages } = await req.json()

  // Extract last user message
  const lastUser = [...messages].reverse().find((m: { role: string }) => m.role === "user")
  const query = typeof lastUser?.content === "string"
    ? lastUser.content
    : Array.isArray(lastUser?.content)
      ? lastUser.content.find((p: { type: string; text?: string }) => p.type === "text")?.text || ""
      : ""

  if (!query.trim()) {
    return streamText("Please provide a query.")
  }

  // Forward auth header
  const authHeader = req.headers.get("authorization")
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (authHeader) headers["Authorization"] = authHeader

  try {
    // Call Kiln backend
    const res = await fetch(`${CHAT_BACKEND}/kiln/start`, {
      method: "POST",
      headers,
      body: JSON.stringify({ request: query }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: `Error ${res.status}` }))
      const msg = typeof err.detail === "string" ? err.detail : JSON.stringify(err.detail)
      return streamText(`Error: ${msg}`)
    }

    const data = await res.json()

    if (data.status === "needs_config") {
      const missing = data.missing_envs?.map((e: { var_name: string }) => e.var_name).join(", ")
      return streamText(`⚠️ Missing API keys: ${missing}\n\nPlease configure them in the server environment.`)
    }

    // Stream execution events in OpenAI SSE format
    return streamKilnExecution(data.run_id)
  } catch (err) {
    return streamText(`Error: ${err}`)
  }
}

/** Stream a simple text response in OpenAI SSE format */
function streamText(text: string): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      const chunk = {
        id: `chatcmpl-${Date.now()}`,
        object: "chat.completion.chunk",
        choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: "stop" }],
      }
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`))
      controller.enqueue(encoder.encode("data: [DONE]\n\n"))
      controller.close()
    },
  })
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
  })
}

/** Connect to Kiln's SSE stream and convert to OpenAI format */
function streamKilnExecution(runId: string): Response {
  const encoder = new TextEncoder()
  const id = `chatcmpl-${runId}`

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false

      function sendDelta(content: string) {
        if (closed) return
        const chunk = {
          id,
          object: "chat.completion.chunk",
          choices: [{ index: 0, delta: { content }, finish_reason: null }],
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`))
      }

      function finish() {
        if (closed) return
        closed = true
        const chunk = {
          id,
          object: "chat.completion.chunk",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`))
        controller.enqueue(encoder.encode("data: [DONE]\n\n"))
        controller.close()
      }

      // Connect to Kiln SSE
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

        sendDelta("🔄 Planning and executing...\n\n")

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split("\n")
          buffer = lines.pop() || ""

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue
            const data = line.slice(6).trim()
            if (!data || data === "[DONE]") continue

            try {
              const ev = JSON.parse(data)

              if (ev.type === "plan_ready" || ev.type === "plan_updated") {
                const nodes = ev.nodes?.map((n: { role: string }) => n.role).join(" → ") || ""
                sendDelta(`📋 **Plan:** ${nodes}\n\n`)
              } else if (ev.type === "node_start") {
                sendDelta(`▸ Starting **${ev.node_id}**...\n`)
              } else if (ev.type === "tool_call") {
                sendDelta(`  → Calling \`${ev.tool}\`\n`)
              } else if (ev.type === "node_complete") {
                sendDelta(`  ✓ **${ev.node_id}** done\n\n`)
              } else if (ev.type === "flow_complete") {
                sendDelta(`\n---\n\n${ev.final_answer}`)
                finish()
                return
              } else if (ev.type === "error") {
                sendDelta(`\n❌ ${ev.message}`)
                finish()
                return
              }
            } catch {
              // skip malformed events
            }
          }
        }

        // Stream ended without flow_complete
        if (!closed) finish()
      } catch (err) {
        sendDelta(`\n❌ Stream error: ${err}`)
        finish()
      }
    },
  })

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
  })
}
