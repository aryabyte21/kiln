import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useAuth } from "@clerk/clerk-react"

async function fetchApiKey(token: string): Promise<{ api_key: string }> {
  const res = await fetch("/auth/api-key", {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (res.status === 404) return { api_key: "" }
  if (!res.ok) throw new Error("Failed to fetch API key")
  return res.json()
}

async function createApiKey(token: string): Promise<{ api_key: string; message: string }> {
  const res = await fetch("/auth/api-key", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error("Failed to create API key")
  return res.json()
}

async function regenerateApiKey(token: string): Promise<{ api_key: string; message: string }> {
  const res = await fetch("/auth/api-key/regenerate", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error("Failed to regenerate API key")
  return res.json()
}

export function useApiKey() {
  const { getToken } = useAuth()

  const query = useQuery({
    queryKey: ["api-key"],
    queryFn: async () => {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      return fetchApiKey(token)
    },
  })

  const queryClient = useQueryClient()

  const create = useMutation({
    mutationFn: async () => {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      return createApiKey(token)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["api-key"] }),
  })

  const regenerate = useMutation({
    mutationFn: async () => {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      return regenerateApiKey(token)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["api-key"] }),
  })

  return { query, create, regenerate }
}
