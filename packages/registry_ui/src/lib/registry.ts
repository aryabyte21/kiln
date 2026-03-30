/**
 * Server-side helper to call the Python Registry API.
 * Used in API routes and Server Components.
 */

const REGISTRY_URL = process.env.NEXT_PUBLIC_REGISTRY_URL || "http://localhost:8766"

export interface ToolParam {
  name: string
  type: string
  description: string
  required: boolean
  default?: unknown
  enum?: string[]
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
}

export interface ToolStats {
  total: number
  categories: Record<string, number>
  tags: Record<string, number>
  unique_authors: number
}

export async function fetchTools(): Promise<Tool[]> {
  const res = await fetch(`${REGISTRY_URL}/tools`, { next: { revalidate: 30 } })
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
  const res = await fetch(`${REGISTRY_URL}/tools/versions/${toolId}`, { next: { revalidate: 30 } })
  if (!res.ok) throw new Error("Failed to fetch versions")
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
