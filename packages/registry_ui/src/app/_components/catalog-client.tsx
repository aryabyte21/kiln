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
  Flame,
  PlayCircle,
  CheckCircle2,
  Star,
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
  gradient,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string | number
  color: string
  gradient: string
}) {
  return (
    <Card className="section-surface relative overflow-hidden py-0 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_22px_56px_hsl(223_80%_4%_/_0.48)]">
      {/* Subtle gradient background */}
      <div className={`pointer-events-none absolute inset-0 ${gradient}`} />
      <CardContent className="relative flex items-center gap-3 py-4">
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
      gradient:
        "bg-gradient-to-br from-blue-500/[0.07] via-blue-400/[0.03] to-transparent",
    },
    {
      icon: FolderOpen,
      label: "Categories",
      value: categoryCount,
      color:
        "bg-violet-500/10 text-violet-600 dark:bg-violet-500/20 dark:text-violet-400",
      gradient:
        "bg-gradient-to-br from-violet-500/[0.07] via-purple-400/[0.03] to-transparent",
    },
    {
      icon: Users,
      label: "Authors",
      value: stats.unique_authors,
      color:
        "bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400",
      gradient:
        "bg-gradient-to-br from-emerald-500/[0.07] via-green-400/[0.03] to-transparent",
    },
    {
      icon: Tag,
      label: "Unique Tags",
      value: tagCount,
      color:
        "bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400",
      gradient:
        "bg-gradient-to-br from-amber-500/[0.07] via-yellow-400/[0.03] to-transparent",
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

function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`
  return String(n)
}

function relativeTime(iso: string | null): string | null {
  if (!iso) return null
  const ts = new Date(iso).getTime()
  if (Number.isNaN(ts)) return null
  const diff = Date.now() - ts
  const m = Math.floor(diff / 60_000)
  if (m < 1) return "just now"
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(ts).toLocaleDateString()
}

function ToolCard({ tool }: { tool: Tool }) {
  const truncatedDescription =
    tool.description.length > 120
      ? tool.description.slice(0, 120).trimEnd() + "..."
      : tool.description

  // Stats default to zero/never when the registry doesn't yet supply them
  // (older deploys, fresh DB, etc). The UI should never break on missing data.
  const stats = tool.stats
  const executionCount = stats?.execution_count ?? 0
  const successRate = stats?.success_rate ?? null
  const lastStatus = stats?.last_status ?? "never"
  const favoriteCount = stats?.favorite_count ?? 0
  const lastExecuted = relativeTime(stats?.last_executed_at ?? null)

  // Color the success-rate badge so the eye can scan a long catalog quickly.
  let successBadgeClass = "bg-muted/50 text-muted-foreground"
  let successLabel = "—"
  if (successRate !== null) {
    const pct = Math.round(successRate * 100)
    successLabel = `${pct}%`
    if (pct >= 90) successBadgeClass = "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30"
    else if (pct >= 70) successBadgeClass = "bg-amber-500/15 text-amber-300 ring-amber-500/30"
    else successBadgeClass = "bg-red-500/15 text-red-300 ring-red-500/30"
  }

  // Last-status dot mirrors GitHub Actions / CI pill style.
  const statusDotClass =
    lastStatus === "success"
      ? "bg-emerald-400 shadow-emerald-500/40"
      : lastStatus === "error"
        ? "bg-red-400 shadow-red-500/40"
        : "bg-muted-foreground/30"

  return (
    <Link href={`/tools/${tool.id}`} className="block">
      <Card className="section-surface group/tool relative h-full cursor-pointer overflow-hidden border-border/70 bg-card/75 py-0 transition-all duration-300 hover:-translate-y-1 hover:border-primary/25 hover:shadow-[0_28px_72px_hsl(223_80%_4%_/_0.55)]">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent opacity-70" />

        <CardHeader className="px-5 pb-3 pt-5">
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="flex min-w-0 items-center gap-2.5">
              <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/20 transition-all duration-300 group-hover/tool:bg-primary/15 group-hover/tool:ring-primary/40">
                <Package className="size-4 text-primary/70 transition-colors duration-300 group-hover/tool:text-primary" />
              </div>
              <span className="truncate transition-colors duration-300 group-hover/tool:text-primary/90">
                {tool.name}
              </span>
            </CardTitle>
            <Badge
              variant="secondary"
              className="shrink-0 rounded-full border border-border/80 bg-background/60 px-2.5 py-0.5 font-mono text-[10px] text-muted-foreground"
            >
              v{tool.version}
            </Badge>
          </div>
          <CardDescription className="line-clamp-2 pt-0.5 text-sm leading-6 text-muted-foreground/95">
            {truncatedDescription}
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-3 px-5 pb-4 pt-0">
          {/* Category */}
          <div className="flex items-center gap-2">
            <Layers className="size-3.5 text-muted-foreground/70" />
            <Badge
              variant="outline"
              className="rounded-full border-border/70 bg-background/45 font-normal"
            >
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
                  className="rounded-full bg-muted/65 text-[10px] font-normal"
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

          {/* Stats row — execution count, success rate, favorites, last status */}
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <span
              title={`${executionCount} total runs`}
              className="inline-flex items-center gap-1 rounded-full bg-muted/50 px-2 py-0.5 text-[10px] text-muted-foreground"
            >
              <PlayCircle className="size-3 text-muted-foreground/70" />
              {formatCount(executionCount)}
            </span>
            <span
              title={
                successRate === null
                  ? "Never executed"
                  : `${stats?.success_count ?? 0} of ${executionCount} runs succeeded`
              }
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] ring-1 ${successBadgeClass}`}
            >
              <CheckCircle2 className="size-3" />
              {successLabel}
            </span>
            {favoriteCount > 0 && (
              <span
                title={`${favoriteCount} favorites`}
                className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-300 ring-1 ring-amber-500/25"
              >
                <Star className="size-3" />
                {formatCount(favoriteCount)}
              </span>
            )}
            <span
              title={
                lastStatus === "never"
                  ? "Never executed"
                  : `Last run: ${lastStatus}${lastExecuted ? ` (${lastExecuted})` : ""}`
              }
              className="inline-flex items-center gap-1 rounded-full bg-background/60 px-2 py-0.5 text-[10px] text-muted-foreground ring-1 ring-border/60"
            >
              <span
                className={`size-1.5 rounded-full shadow-sm ${statusDotClass}`}
              />
              {lastExecuted ?? "never"}
            </span>
          </div>
        </CardContent>

        <CardFooter className="mt-auto border-t border-border/60 bg-background/35 px-5 py-3">
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
    <div className="section-surface flex flex-col items-center justify-center gap-6 px-4 py-24 text-center">
      <div className="relative">
        <span className="absolute -inset-6 rounded-full bg-gradient-to-br from-primary/10 to-primary/5 blur-2xl" />
        <div className="relative flex size-20 items-center justify-center rounded-2xl bg-muted/80 ring-1 ring-border/70">
          <PackageSearch className="size-10 text-muted-foreground/50" />
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
      <Button
        variant="outline"
        size="sm"
        className="mt-2"
        onClick={() => window.location.reload()}
      >
        Clear all filters
      </Button>
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
    <div className="w-full">
      {/* Hero section with gradient */}
      <div className="hero-surface mb-10">
        {/* Background gradient orbs */}
        <div className="pointer-events-none absolute -left-20 -top-20 size-64 rounded-full bg-gradient-to-br from-primary/[0.16] to-primary/[0.02] blur-3xl" />
        <div className="pointer-events-none absolute -bottom-16 -right-16 size-48 rounded-full bg-gradient-to-br from-sky-400/[0.12] to-violet-400/[0.02] blur-3xl" />

        <div className="relative flex items-center gap-4">
          <div className="relative flex size-12 items-center justify-center">
            <span className="absolute inset-0 rounded-xl bg-gradient-to-br from-primary/35 to-primary/10 blur-lg" />
            <div className="relative flex size-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary/25 to-primary/10 ring-1 ring-primary/35">
              <Flame className="size-6 text-primary" />
            </div>
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Tool Catalog</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Browse and discover tools in the Kiln registry
              {tools.length > 0 && (
                <span className="ml-1.5 inline-flex items-center gap-1 font-medium text-foreground">
                  <span className="inline-block size-1.5 rounded-full bg-emerald-500" />
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
          className="h-11 rounded-xl border-border/70 bg-card/70 pl-10 pr-10 text-sm shadow-sm ring-1 ring-border/60 transition-all duration-300 placeholder:text-muted-foreground/60 focus-visible:bg-card focus-visible:ring-2 focus-visible:ring-primary/35"
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
            className={`inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-all duration-300 ${
              activeCategory === null
                ? "bg-primary text-primary-foreground shadow-sm shadow-primary/20 ring-1 ring-primary/50"
                : "bg-card/65 text-muted-foreground ring-1 ring-border/70 hover:bg-card hover:text-foreground hover:ring-border"
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
              className={`inline-flex h-7 items-center rounded-full px-3 text-xs font-medium transition-all duration-300 ${
                activeCategory === cat
                  ? "bg-primary text-primary-foreground shadow-sm shadow-primary/20 ring-1 ring-primary/50"
                  : "bg-card/65 text-muted-foreground ring-1 ring-border/70 hover:bg-card hover:text-foreground hover:ring-border"
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
        <div className="section-surface flex flex-col items-center justify-center gap-6 px-4 py-24 text-center">
          <div className="relative">
            <span className="absolute -inset-6 rounded-full bg-gradient-to-br from-primary/10 to-primary/5 blur-2xl" />
            <div className="relative flex size-20 items-center justify-center rounded-2xl bg-muted/80 ring-1 ring-border/70">
              <Package className="size-10 text-muted-foreground/50" />
            </div>
          </div>
          <div className="max-w-sm space-y-2">
            <h3 className="text-lg font-semibold">No tools registered yet</h3>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Be the first to publish a tool to the Kiln registry.
            </p>
          </div>
          <Link href="/publish">
            <Button size="sm" className="mt-2 gap-1.5">
              <Sparkles className="size-3.5" />
              Publish a tool
            </Button>
          </Link>
        </div>
      )}

      {/* Tool grid */}
      {filtered.length > 0 && (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((tool) => (
            <ToolCard key={tool.id} tool={tool} />
          ))}
        </div>
      )}
    </div>
  )
}
