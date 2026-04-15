/**
 * Server-side helper to call the Python Registry API.
 * Used in API routes and Server Components.
 */

import { getRegistryUrl } from "@/lib/service-urls"

const REGISTRY_URL = getRegistryUrl()

export interface ToolParam {
  name: string
  type: string
  description: string
  required: boolean
  default?: unknown
  enum?: string[]
}

export interface ToolExecutionStats {
  execution_count: number
  success_count: number
  error_count: number
  /** null when execution_count == 0 */
  success_rate: number | null
  avg_duration_ms: number
  /** ISO timestamp, null if never run */
  last_executed_at: string | null
  last_status: "never" | "success" | "error"
  favorite_count: number
}

export interface Tool {
  id: string
  name: string
  version: string
  description: string
  author: string
  category: string
  tags: string[]
  params: ToolParam[]
  tool_def: Record<string, unknown>
  /** Per-tool execution stats added by registry_api iter 40. May be missing
   *  on older deploys; consumers should treat undefined as zero/never-run. */
  stats?: ToolExecutionStats
}

export interface ToolStats {
  total: number
  categories: Record<string, number>
  tags: Record<string, number>
  unique_authors: number
}

// Caching strategy: the catalog list (`fetchTools`) is the user's primary
// view of what's registered, and we want newly-published tools visible
// immediately, so it stays uncached. Per-tool detail and aggregate stats
// change rarely, so we revalidate them on a short window to cut latency
// and registry load without sacrificing correctness.

export async function fetchTools(): Promise<Tool[]> {
  const res = await fetch(`${REGISTRY_URL}/tools`, { cache: "no-store" })
  if (!res.ok) throw new Error("Failed to fetch tools")
  return res.json()
}

export async function fetchTool(toolId: string): Promise<Tool> {
  const res = await fetch(`${REGISTRY_URL}/tools/${toolId}`, { next: { revalidate: 30 } })
  if (!res.ok) throw new Error(`Tool ${toolId} not found`)
  return res.json()
}

export async function fetchToolStats(): Promise<ToolStats> {
  const res = await fetch(`${REGISTRY_URL}/tools/stats`, { next: { revalidate: 60 } })
  if (!res.ok) throw new Error("Failed to fetch stats")
  return res.json()
}

export async function searchTools(query: string): Promise<Tool[]> {
  const res = await fetch(`${REGISTRY_URL}/tools/search?q=${encodeURIComponent(query)}`)
  if (!res.ok) throw new Error("Search failed")
  return res.json()
}

export async function fetchToolVersions(toolId: string): Promise<{ tool_id: string; versions: Array<{ version: string; description: string; author: string }>; count: number }> {
  const res = await fetch(`${REGISTRY_URL}/tools/versions/${toolId}`, { next: { revalidate: 60 } })
  if (!res.ok) throw new Error("Failed to fetch versions")
  return res.json()
}

export interface IntegrationSnippet {
  target: string
  label: string
  language: string
  install: string | null
  snippet: string
  schema: Record<string, unknown>
}

export interface IntegrationsResponse {
  tool_id: string
  name: string
  registry_url: string
  integrations: IntegrationSnippet[]
}

export async function fetchToolIntegrations(toolId: string): Promise<IntegrationsResponse> {
  const res = await fetch(`${REGISTRY_URL}/tools/${toolId}/integrations`, { next: { revalidate: 120 } })
  if (!res.ok) throw new Error("Failed to fetch integrations")
  return res.json()
}

export interface ToolStatsResponse extends ToolExecutionStats {
  tool_id: string
}

export async function fetchToolExecutionStats(toolId: string): Promise<ToolStatsResponse> {
  const res = await fetch(`${REGISTRY_URL}/tools/${toolId}/stats`, { cache: "no-store" })
  if (!res.ok) throw new Error("Failed to fetch tool stats")
  return res.json()
}

export async function toggleToolFavorite(
  toolId: string,
  delta: 1 | -1,
  token?: string,
): Promise<{ tool_id: string; favorite_count: number }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (token) headers["Authorization"] = `Bearer ${token}`
  const res = await fetch(`${REGISTRY_URL}/tools/${toolId}/favorite`, {
    method: "POST",
    headers,
    body: JSON.stringify({ delta }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Favorite failed" }))
    throw new Error(err.detail || "Favorite failed")
  }
  return res.json()
}

export async function executeTool(toolId: string, args: Record<string, unknown>, token?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (token) headers["Authorization"] = `Bearer ${token}`

  const res = await fetch(`${REGISTRY_URL}/tools/${toolId}/execute`, {
    method: "POST",
    headers,
    body: JSON.stringify({ args }),
    cache: "no-store",
  })
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.detail || "Execution failed")
  }
  return res.json()
}
