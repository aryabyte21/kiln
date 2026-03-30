import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { motion } from "framer-motion"
import { Search, Package, Tag, User, Layers } from "lucide-react"
import type { Tool } from "@/hooks/use-tools"
import { useTools } from "@/hooks/use-tools"
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
import { Skeleton } from "@/components/ui/skeleton"

// ---------------------------------------------------------------------------
// Animation variants
// ---------------------------------------------------------------------------

const containerVariants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.06 },
  },
}

const cardVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
  },
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ToolCard({ tool }: { tool: Tool }) {
  const navigate = useNavigate()

  const truncatedDescription =
    tool.description.length > 120
      ? tool.description.slice(0, 120).trimEnd() + "..."
      : tool.description

  return (
    <motion.div variants={cardVariants} layout>
      <Card
        className="h-full cursor-pointer transition-shadow hover:shadow-lg dark:hover:shadow-primary/5"
        onClick={() => navigate(`/tools/${tool.id}`)}
      >
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="flex items-center gap-2">
              <Package className="size-4 shrink-0 text-muted-foreground" />
              {tool.name}
            </CardTitle>
            <Badge variant="secondary" className="shrink-0 text-[10px]">
              v{tool.version}
            </Badge>
          </div>
          <CardDescription>{truncatedDescription}</CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-3">
          {/* Category */}
          <div className="flex items-center gap-2">
            <Layers className="size-3.5 text-muted-foreground" />
            <Badge variant="outline">{tool.category}</Badge>
          </div>

          {/* Tags */}
          {tool.tags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <Tag className="size-3.5 shrink-0 text-muted-foreground" />
              {tool.tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="text-[10px]">
                  {tag}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>

        <CardFooter className="mt-auto">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <User className="size-3.5" />
            <span>{tool.author}</span>
          </div>
        </CardFooter>
      </Card>
    </motion.div>
  )
}

function ToolCardSkeleton() {
  return (
    <Card className="h-full">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-5 w-12" />
        </div>
        <Skeleton className="mt-1 h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Skeleton className="h-5 w-24" />
        <div className="flex gap-1.5">
          <Skeleton className="h-5 w-14" />
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-5 w-12" />
        </div>
      </CardContent>
      <CardFooter className="mt-auto">
        <Skeleton className="h-4 w-24" />
      </CardFooter>
    </Card>
  )
}

function EmptyState({ query }: { query: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
      <div className="rounded-full bg-muted p-4">
        <Search className="size-8 text-muted-foreground" />
      </div>
      <div>
        <h3 className="text-lg font-medium">No tools found</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          No results match{" "}
          <span className="font-medium text-foreground">"{query}"</span>. Try a
          different search term or clear the filters.
        </p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function CatalogPage() {
  const { data: tools, isLoading, isError, error } = useTools()
  const [search, setSearch] = useState("")
  const [activeCategory, setActiveCategory] = useState<string | null>(null)

  // Derive unique categories
  const categories = useMemo(() => {
    if (!tools) return []
    const set = new Set(tools.map((t) => t.category))
    return Array.from(set).sort()
  }, [tools])

  // Filter logic
  const filtered = useMemo(() => {
    if (!tools) return []
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
    <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Tool Catalog</h1>
        <p className="mt-2 text-muted-foreground">
          Browse and discover tools in the Kiln registry
          {!isLoading && tools && (
            <span className="ml-1 font-medium text-foreground">
              ({filtered.length}
              {filtered.length !== tools.length && ` of ${tools.length}`})
            </span>
          )}
        </p>
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search by name, description, id, or tag..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-10 pl-9"
        />
      </div>

      {/* Category pills */}
      {categories.length > 0 && (
        <div className="mb-8 flex flex-wrap gap-2">
          <Badge
            variant={activeCategory === null ? "default" : "outline"}
            className="cursor-pointer select-none"
            onClick={() => setActiveCategory(null)}
          >
            All
          </Badge>
          {categories.map((cat) => (
            <Badge
              key={cat}
              variant={activeCategory === cat ? "default" : "outline"}
              className="cursor-pointer select-none"
              onClick={() =>
                setActiveCategory((prev) => (prev === cat ? null : cat))
              }
            >
              {cat}
            </Badge>
          ))}
        </div>
      )}

      {/* Error state */}
      {isError && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          Failed to load tools: {(error as Error).message}
        </div>
      )}

      {/* Loading skeleton grid */}
      {isLoading && (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <ToolCardSkeleton key={i} />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !isError && filtered.length === 0 && (search || activeCategory) && (
        <EmptyState query={search || activeCategory || ""} />
      )}

      {/* Tool grid */}
      {!isLoading && filtered.length > 0 && (
        <motion.div
          className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3"
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          key={`${search}-${activeCategory}`}
        >
          {filtered.map((tool) => (
            <ToolCard key={tool.id} tool={tool} />
          ))}
        </motion.div>
      )}
    </div>
  )
}
