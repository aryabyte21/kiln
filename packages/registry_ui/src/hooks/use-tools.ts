import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"

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
  tool_def: {
    type: string
    function: {
      name: string
      description: string
      parameters: Record<string, unknown>
    }
  }
}

export interface ExecuteResult {
  success: boolean
  tool_id: string
  result: Record<string, unknown>
}

async function fetchTools(): Promise<Tool[]> {
  const res = await fetch("/tools")
  if (!res.ok) throw new Error("Failed to fetch tools")
  return res.json()
}

async function fetchTool(toolId: string): Promise<Tool> {
  const res = await fetch(`/tools/${toolId}`)
  if (!res.ok) throw new Error(`Tool ${toolId} not found`)
  return res.json()
}

async function executeTool(
  toolId: string,
  args: Record<string, unknown>,
  token?: string,
): Promise<ExecuteResult> {
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (token) headers["Authorization"] = `Bearer ${token}`

  const res = await fetch(`/tools/${toolId}/execute`, {
    method: "POST",
    headers,
    body: JSON.stringify({ args }),
  })
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.detail || "Execution failed")
  }
  return res.json()
}

export function useTools() {
  return useQuery({
    queryKey: ["tools"],
    queryFn: fetchTools,
    staleTime: 30_000,
  })
}

export function useSearchTools(query: string) {
  return useQuery({
    queryKey: ["tools", "search", query],
    queryFn: async () => {
      if (!query.trim()) return []
      const res = await fetch(`/tools/search?q=${encodeURIComponent(query)}`)
      if (!res.ok) throw new Error("Search failed")
      return res.json() as Promise<Tool[]>
    },
    enabled: query.trim().length > 0,
    staleTime: 10_000,
  })
}

export function useTool(toolId: string) {
  return useQuery({
    queryKey: ["tool", toolId],
    queryFn: () => fetchTool(toolId),
    enabled: !!toolId,
  })
}

export interface ToolStats {
  total: number
  categories: Record<string, number>
  tags: Record<string, number>
  unique_authors: number
}

export function useToolStats() {
  return useQuery({
    queryKey: ["tools", "stats"],
    queryFn: async (): Promise<ToolStats> => {
      const res = await fetch("/tools/stats")
      if (!res.ok) throw new Error("Failed to fetch stats")
      return res.json()
    },
    staleTime: 60_000,
  })
}

export function useExecuteTool() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ toolId, args, token }: { toolId: string; args: Record<string, unknown>; token?: string }) =>
      executeTool(toolId, args, token),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tools"] })
    },
  })
}
