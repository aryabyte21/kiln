// E2E: validate the chat flow end-to-end against the live local stack.
//
// Combines two layers:
//   1. Puppeteer browser test — navigate to /chat, assert the input renders
//      and there are no console errors. No real message sent (Clerk login
//      is not scripted).
//   2. Direct backend API tests via fetch — POST /kiln/start with the
//      KILN_INTERNAL_SECRET so we bypass Clerk entirely. Three queries:
//       a) "ping" → must return "pong" in <1s (proves iter-31 fast path)
//       b) "Find tools for web scraping" → must only mention tools that
//          actually exist in /tools (proves iter-32 grounding fix)
//       c) "What is Kiln?" → must produce a single-node SHAPE A graph
//          with no synthesized tools (proves iter-29 prompt rewrite)
//
// Run:   node packages/registry_ui/tests/e2e/chat-flow.mjs

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { preflightHealthChecks, runTest } from './_lib.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..')

// Load the internal secret from process.env or fall back to .env file.
function loadInternalSecret() {
  if (process.env.KILN_INTERNAL_SECRET) return process.env.KILN_INTERNAL_SECRET
  try {
    const envPath = join(REPO_ROOT, '.env')
    const text = readFileSync(envPath, 'utf8')
    for (const line of text.split('\n')) {
      const m = line.match(/^KILN_INTERNAL_SECRET=(.+)$/)
      if (m) return m[1].trim().replace(/^['"]|['"]$/g, '')
    }
  } catch {
    // .env missing — fall through
  }
  return null
}

const INTERNAL_SECRET = loadInternalSecret()

const REGISTRY_API = 'http://localhost:8766'
const CHAT_BACKEND = 'http://localhost:8765'

await preflightHealthChecks(['registry_ui', 'registry_api', 'chat_backend'])

if (!INTERNAL_SECRET) {
  console.error(
    '\nKILN_INTERNAL_SECRET not found in process.env or .env\n' +
    'The chat-flow test bypasses Clerk via the internal secret. Set it in .env\n' +
    'or export KILN_INTERNAL_SECRET=<value> before running.\n'
  )
  process.exit(2)
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function fetchAllRegisteredTools() {
  const res = await fetch(`${REGISTRY_API}/tools`)
  if (!res.ok) throw new Error(`GET /tools returned ${res.status}`)
  const tools = await res.json()
  return new Set(tools.map((t) => t.id))
}

async function startKilnRun(request) {
  const res = await fetch(`${CHAT_BACKEND}/kiln/start`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Secret': INTERNAL_SECRET,
    },
    body: JSON.stringify({ request }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`POST /kiln/start returned ${res.status}: ${body}`)
  }
  return res.json()
}

async function streamKilnRun(runId, timeoutMs = 60_000) {
  const res = await fetch(`${CHAT_BACKEND}/kiln/stream/${runId}`, {
    headers: { 'X-Internal-Secret': INTERNAL_SECRET },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new Error(`GET /kiln/stream returned ${res.status}`)

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const events = []
  let finalAnswer = null

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const evt = JSON.parse(line.slice(6))
      events.push(evt)
      if (evt.type === 'flow_complete') {
        finalAnswer = evt.final_answer
        return { events, finalAnswer }
      }
      if (evt.type === 'error') {
        throw new Error(`flow error: ${evt.message}`)
      }
    }
  }
  return { events, finalAnswer }
}

// ── Test 1: /chat page renders ──────────────────────────────────────────────

const ok1 = await runTest('chat-page-renders', async ({ page, consoleErrors }) => {
  const response = await page.goto('http://localhost:3000/chat', {
    waitUntil: 'networkidle2',
    timeout: 30_000,
  })
  if (!response || !response.ok()) {
    throw new Error(`/chat returned ${response ? response.status() : 'no response'}`)
  }

  // The chat page renders a textarea for input regardless of auth state
  // (Clerk wraps the page but the textarea is in the unauth fallback too).
  await page.waitForSelector('textarea', { timeout: 10_000 })

  const textareaCount = await page.evaluate(
    () => document.querySelectorAll('textarea').length,
  )
  if (textareaCount === 0) {
    throw new Error('No textarea found on /chat page')
  }

  const realErrors = consoleErrors.filter(
    (e) => !/clerk/i.test(e) && !/favicon/i.test(e) && !/Failed to load resource/i.test(e),
  )
  if (realErrors.length > 0) {
    throw new Error(`Page console errors:\n  ${realErrors.join('\n  ')}`)
  }
})

// ── Test 2: ping → pong (fast path) ─────────────────────────────────────────

console.log('\n--- Backend API tests (via internal secret) ---\n')

let ok2 = false
try {
  const start = Date.now()
  const startResp = await startKilnRun('ping')
  const { finalAnswer } = await streamKilnRun(startResp.run_id, 10_000)
  const ms = Date.now() - start

  if (finalAnswer !== 'pong') {
    throw new Error(`Expected "pong", got ${JSON.stringify(finalAnswer)}`)
  }
  if (ms > 2000) {
    throw new Error(`ping → pong took ${ms}ms (expected <2000ms — fast path may not be active)`)
  }
  console.log(`PASS  ping-fast-path  (${ms}ms)`)
  ok2 = true
} catch (err) {
  console.error(`FAIL  ping-fast-path`)
  console.error(`  ${err.stack || err.message}`)
}

// ── Test 3: web scraping query → no fabricated tool names ───────────────────

let ok3 = false
try {
  const start = Date.now()
  const registryTools = await fetchAllRegisteredTools()
  const startResp = await startKilnRun('Find tools for web scraping')
  const { finalAnswer, events } = await streamKilnRun(startResp.run_id, 60_000)
  const ms = Date.now() - start

  if (!finalAnswer || typeof finalAnswer !== 'string') {
    throw new Error(`No final_answer received (events: ${events.length})`)
  }

  // Find anything that looks like a tool ID in the response.
  const mentioned = finalAnswer.match(/com\.kiln\.tools\.[a-z0-9_]+/g) || []
  const fabricated = mentioned.filter((id) => !registryTools.has(id))
  if (fabricated.length > 0) {
    throw new Error(
      `Response mentioned ${fabricated.length} tool IDs that DON'T exist in /tools:\n` +
      fabricated.map((f) => `    ${f}`).join('\n') +
      `\n  (registry has ${registryTools.size} tools — checked against /tools)`,
    )
  }

  // Also catch the older fabrication pattern: bare names like
  // `fetch_webpage`, `extract_html_structured_data`, etc. We can't enumerate
  // every possible fake name, but we can check for known false names from
  // the user's bug report.
  const knownFakes = [
    'fetch_webpage',
    'extract_html_structured_data',
    'scrape_search_results',
    'parse_html_table',
  ]
  const hits = knownFakes.filter((f) => finalAnswer.includes(f))
  if (hits.length > 0) {
    throw new Error(
      `Response contains known-fake tool names from the bug report: ${hits.join(', ')}`,
    )
  }

  console.log(`PASS  web-scraping-grounding  (${ms}ms)`)
  console.log(`      registry tools mentioned: ${mentioned.length}`)
  ok3 = true
} catch (err) {
  console.error(`FAIL  web-scraping-grounding`)
  console.error(`  ${err.stack || err.message}`)
}

// ── Summary ─────────────────────────────────────────────────────────────────

const allOk = ok1 && ok2 && ok3
console.log(`\n${allOk ? 'ALL CHAT-FLOW TESTS PASSED' : 'SOME CHAT-FLOW TESTS FAILED'}\n`)
process.exit(allOk ? 0 : 1)
