import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, User } from "lucide-react"

import { fetchTool, fetchToolVersions } from "@/lib/registry"
import type { Tool } from "@/lib/registry"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { ToolDetailTabs } from "@/app/_components/tool-detail-tabs"

export default async function ToolDetailPage({
  params,
}: {
  params: Promise<{ toolId: string }>
}) {
  const { toolId } = await params

  let tool: Tool
  let versions: { version: string; description: string; author: string }[] = []

  try {
    const [toolData, versionsData] = await Promise.all([
      fetchTool(toolId),
      fetchToolVersions(toolId).catch(() => ({ versions: [], count: 0, tool_id: toolId })),
    ])
    tool = toolData
    versions = versionsData.versions
  } catch {
    notFound()
  }

  return (
    <div className="mx-auto w-full max-w-4xl py-4">
      {/* Back button */}
      <Link href="/">
        <Button variant="ghost" size="sm" className="mb-6 -ml-2 gap-1.5">
          <ArrowLeft className="size-4" />
          Back to Registry
        </Button>
      </Link>

      {/* Header */}
      <header className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            {tool.name}
          </h1>
          <Badge variant="outline" className="font-mono">
            v{tool.version}
          </Badge>
          <Badge variant="secondary">{tool.category}</Badge>
        </div>

        <p className="max-w-2xl text-base leading-relaxed text-muted-foreground">
          {tool.description}
        </p>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <User className="size-3.5" />
            By{" "}
            <span className="font-medium text-foreground">{tool.author}</span>
          </span>
          {tool.tags.length > 0 && (
            <>
              <Separator orientation="vertical" className="h-4" />
              <div className="flex flex-wrap gap-1.5">
                {tool.tags.map((tag) => (
                  <Badge key={tag} variant="outline" className="text-xs">
                    {tag}
                  </Badge>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Versions */}
        {versions.length > 1 && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>
              {versions.length} version{versions.length !== 1 && "s"} available
            </span>
            <Separator orientation="vertical" className="h-3" />
            <span>
              Latest: <span className="font-mono font-medium text-foreground">v{versions[0]?.version}</span>
            </span>
          </div>
        )}
      </header>

      <Separator className="my-6" />

      {/* Tabs (client component for interactivity) */}
      <ToolDetailTabs
        toolId={tool.id}
        params={tool.params}
        toolDef={tool.tool_def}
      />
    </div>
  )
}
