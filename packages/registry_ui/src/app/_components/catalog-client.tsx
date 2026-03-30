"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import {
  Search,
  Package,
  Tag,
  User,
  Layers,
  X,
  Users,
  FolderOpen,
  BoxesIcon,
  PackageSearch,
  Sparkles,
  ArrowRight,
} from "lucide-react"
import type { Tool, ToolStats } from "@/lib/registry"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string | number
  color: string
}) {
  return (
    <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-card to-card shadow-sm ring-1 ring-foreground/[0.06] transition-all duration-300 hover:shadow-md hover:ring-foreground/[0.1]">
      <CardContent className="flex items-center gap-3 py-4">
        <div
          className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${color}`}
        >
          <Icon className="size-5" />
        </div>
        <div className="min-w-0">
          <p className="text-2xl font-bold tracking-tight">{value}</p>
          <p className="truncate text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  )
}

function StatsRow({ stats }: { stats: ToolStats }) {
  const categoryCount = Object.keys(stats.categories).length
  const tagCount = Object.keys(stats.tags).length

  const items = [
    {
      icon: BoxesIcon,
      label: "Total Tools",
      value: stats.total,
      color:
        "bg-blue-500/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400",
    },
    {
      icon: FolderOpen,
      label: "Categories",
      value: categoryCount,
      color:
        "bg-violet-500/10 text-violet-600 dark:bg-violet-500/20 dark:text-violet-400",
    },
    {
      icon: Users,
      label: "Authors",
      value: stats.unique_authors,
      color:
        "bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400",
    },
    {
      icon: Tag,
      label: "Unique Tags",
      value: tagCount,
      color:
        "bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400",
    },
  ]

  return (
    <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map((item) => (
        <StatCard key={item.label} {...item} />
      ))}
    </div>
  )
}

function ToolCard({ tool }: { tool: Tool }) {
  const truncatedDescription =
    tool.description.length > 120
      ? tool.description.slice(0, 120).trimEnd() + "..."
      : tool.description

  return (
    <Link href={`/tools/${tool.id}`} className="block">
      <Card className="group/tool h-full cursor-pointer border-0 shadow-sm ring-1 ring-foreground/[0.06] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg hover:ring-foreground/[0.12] hover:shadow-primary/5 dark:hover:shadow-primary/10">
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="flex items-center gap-2.5">
              <div className="flex size-8 items-center justify-center rounded-lg bg-primary/5 ring-1 ring-primary/10 transition-colors group-hover/tool:bg-primary/10 dark:bg-primary/10 dark:ring-primary/20">
                <Package className="size-4 text-primary/70" />
              </div>
              <span className="transition-colors group-hover/tool:text-primary/90">
                {tool.name}
              </span>
            </CardTitle>
            <Badge variant="secondary" className="shrink-0 font-mono text-[10px]">
              v{tool.version}
            </Badge>
          </div>
          <CardDescription className="line-clamp-2 leading-relaxed">
            {truncatedDescription}
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-3">
          {/* Category */}
          <div className="flex items-center gap-2">
            <Layers className="size-3.5 text-muted-foreground/70" />
            <Badge variant="outline" className="font-normal">
              {tool.category}
            </Badge>
          </div>

          {/* Tags */}
          {tool.tags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <Tag className="size-3.5 shrink-0 text-muted-foreground/70" />
              {tool.tags.slice(0, 4).map((tag) => (
                <Badge
                  key={tag}
                  variant="secondary"
                  className="text-[10px] font-normal"
                >
                  {tag}
                </Badge>
              ))}
              {tool.tags.length > 4 && (
                <span className="text-[10px] text-muted-foreground">
                  +{tool.tags.length - 4}
                </span>
              )}
            </div>
          )}
        </CardContent>

        <CardFooter className="mt-auto">
          <div className="flex w-full items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <User className="size-3.5" />
              <span>{tool.author}</span>
            </div>
            <ArrowRight className="size-3.5 text-muted-foreground/0 transition-all duration-300 group-hover/tool:translate-x-0.5 group-hover/tool:text-muted-foreground/70" />
          </div>
        </CardFooter>
      </Card>
    </Link>
  )
}

function EmptyState({ query }: { query: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-6 py-24 text-center">
      <div className="relative">
        <div className="absolute -inset-4 animate-pulse rounded-full bg-primary/5 dark:bg-primary/10" />
        <div className="relative flex size-16 items-center justify-center rounded-2xl bg-muted ring-1 ring-foreground/[0.06]">
          <PackageSearch className="size-8 text-muted-foreground/60" />
        </div>
      </div>
      <div className="max-w-sm space-y-2">
        <h3 className="text-lg font-semibold">No tools found</h3>
        <p className="text-sm leading-relaxed text-muted-foreground">
          No results match{" "}
          <span className="rounded-md bg-muted px-1.5 py-0.5 font-medium text-foreground">
            {query}
          </span>
          . Try a different search term or clear the filters.
        </p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main client component
// ---------------------------------------------------------------------------

export function CatalogClient({
  tools,
  stats,
  error,
}: {
  tools: Tool[]
  stats: ToolStats | null
  error: string | null
}) {
  const [search, setSearch] = useState("")
  const [activeCategory, setActiveCategory] = useState<string | null>(null)

  // Derive unique categories
  const categories = useMemo(() => {
    const set = new Set(tools.map((t) => t.category))
    return Array.from(set).sort()
  }, [tools])

  // Filter logic
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()

    return tools.filter((tool) => {
      // Category filter
      if (activeCategory && tool.category !== activeCategory) return false

      // Text search
      if (!q) return true
      return (
        tool.name.toLowerCase().includes(q) ||
        tool.description.toLowerCase().includes(q) ||
        tool.id.toLowerCase().includes(q) ||
        tool.tags.some((tag) => tag.toLowerCase().includes(q))
      )
    })
  }, [tools, search, activeCategory])

  return (
    <div className="w-full py-4">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 dark:bg-primary/15">
            <Sparkles className="size-5 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Tool Catalog</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Browse and discover tools in the Kiln registry
              {tools.length > 0 && (
                <span className="ml-1.5 inline-flex items-center gap-1 font-medium text-foreground">
                  <span className="inline-block size-1 rounded-full bg-emerald-500" />
                  {filtered.length}
                  {filtered.length !== tools.length &&
                    ` of ${tools.length}`}{" "}
                  available
                </span>
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Stats row */}
      {stats && <StatsRow stats={stats} />}

      {/* Search */}
      <div className="relative mb-6">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/60" />
        <Input
          placeholder="Search by name, description, id, or tag..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-11 rounded-xl bg-muted/30 pl-10 pr-10 text-sm shadow-sm ring-1 ring-foreground/[0.06] transition-all duration-200 placeholder:text-muted-foreground/50 focus-visible:bg-background focus-visible:shadow-md focus-visible:ring-primary/30 dark:bg-muted/20"
        />
        {search && (
          <div className="absolute right-2 top-1/2 -translate-y-1/2">
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setSearch("")}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </Button>
          </div>
        )}
      </div>

      {/* Category pills */}
      {categories.length > 0 && (
        <div className="mb-8 flex flex-wrap gap-2">
          <button
            onClick={() => setActiveCategory(null)}
            className={`inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-all duration-200 ${
              activeCategory === null
                ? "bg-primary text-primary-foreground shadow-sm shadow-primary/20"
                : "bg-muted/60 text-muted-foreground ring-1 ring-foreground/[0.06] hover:bg-muted hover:text-foreground dark:bg-muted/30"
            }`}
          >
            <Layers className="size-3" />
            All
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() =>
                setActiveCategory((prev) => (prev === cat ? null : cat))
              }
              className={`inline-flex h-7 items-center rounded-full px-3 text-xs font-medium transition-all duration-200 ${
                activeCategory === cat
                  ? "bg-primary text-primary-foreground shadow-sm shadow-primary/20"
                  : "bg-muted/60 text-muted-foreground ring-1 ring-foreground/[0.06] hover:bg-muted hover:text-foreground dark:bg-muted/30"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive dark:border-destructive/20 dark:bg-destructive/10">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-destructive/10">
            <X className="size-4" />
          </div>
          <p>Failed to load tools: {error}</p>
        </div>
      )}

      {/* Empty state */}
      {!error && filtered.length === 0 && (search || activeCategory) && (
        <EmptyState query={search || activeCategory || ""} />
      )}

      {/* No tools at all */}
      {!error && tools.length === 0 && !search && !activeCategory && (
        <div className="flex flex-col items-center justify-center gap-6 py-24 text-center">
          <div className="flex size-16 items-center justify-center rounded-2xl bg-muted ring-1 ring-foreground/[0.06]">
            <Package className="size-8 text-muted-foreground/60" />
          </div>
          <div className="max-w-sm space-y-2">
            <h3 className="text-lg font-semibold">No tools registered yet</h3>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Be the first to publish a tool to the Kiln registry.
            </p>
          </div>
        </div>
      )}

      {/* Tool grid */}
      {filtered.length > 0 && (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((tool) => (
            <ToolCard key={tool.id} tool={tool} />
          ))}
        </div>
      )}
    </div>
  )
}
