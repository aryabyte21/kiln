import { fetchTools, fetchToolStats } from "@/lib/registry"
import type { Tool, ToolStats } from "@/lib/registry"
import { getSystemStatus } from "@/lib/system-status"
import type { SystemStatus } from "@/lib/system-status"
import { CatalogClient } from "@/app/_components/catalog-client"

export default async function CatalogPage() {
  let tools: Tool[] = []
  let stats: ToolStats | null = null
  let systemStatus: SystemStatus | null = null
  let error: string | null = null

  try {
    ;[tools, stats] = await Promise.all([fetchTools(), fetchToolStats()])
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load tools"
  }

  systemStatus = await getSystemStatus({
    next: { revalidate: 15 },
  }).catch(() => null)

  return (
    <CatalogClient
      tools={tools}
      stats={stats}
      systemStatus={systemStatus}
      error={error}
    />
  )
}
