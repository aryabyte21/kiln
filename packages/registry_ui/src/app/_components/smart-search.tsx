"use client"

/**
 * SmartSearch — natural-language tool discovery panel.
 *
 * Sits above the registry catalog grid and lets anyone type what they
 * *want to do* ("get the weather for Tokyo") instead of guessing a tool
 * name. Hits `/tools/search?mode=semantic` on the registry API, ranks by
 * BM25, and renders live results.
 *
 * Visual language: Linear-inspired. Single thin-bordered card, monochrome
 * neutrals, dense spacing, monospace for tool IDs, no decorative gradients
 * or hero icons. The interface should disappear into the work.
 */

import Link from "next/link"
import { useCallback, useEffect, useRef, useState } from "react"
import { ArrowUpRight, Search, Loader2 } from "lucide-react"

import { searchToolsSemantic, type RankedTool } from "@/lib/registry"

const SAMPLE_INTENTS = [
  "weather for Tokyo",
  "top stories on ycombinator",
  "latest bitcoin price",
  "transcript of a youtube video",
]

export function SmartSearch() {
  const [intent, setIntent] = useState("")
  const [hits, setHits] = useState<RankedTool[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Track the most recent in-flight query so responses arriving out of order
  // can't overwrite the current UI state with stale ranked results.
  const latestRef = useRef(0)

  const runSearch = useCallback(async (q: string) => {
    const trimmed = q.trim()
    if (!trimmed) {
      setHits(null)
      setError(null)
      setLoading(false)
      return
    }
    const my = ++latestRef.current
    setLoading(true)
    setError(null)
    try {
      const results = await searchToolsSemantic(trimmed, 5)
      if (my !== latestRef.current) return
      setHits(results)
    } catch (e) {
      if (my !== latestRef.current) return
      setError(e instanceof Error ? e.message : "Search failed")
      setHits([])
    } finally {
      if (my === latestRef.current) setLoading(false)
    }
  }, [])

  // Debounce typing at 180ms — short enough to feel instant, long enough
  // to avoid firing a request on every keystroke during burst typing.
  useEffect(() => {
    const t = setTimeout(() => void runSearch(intent), 180)
    return () => clearTimeout(t)
  }, [intent, runSearch])

  const showResults = hits !== null && intent.trim().length > 0

  return (
    <div className="mb-6 overflow-hidden rounded-lg border border-border/60 bg-card/40">
      {/* Input row */}
      <div className="flex items-center gap-2.5 border-b border-border/50 px-3.5 py-2.5">
        {loading ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground/70" />
        ) : (
          <Search className="size-3.5 shrink-0 text-muted-foreground/70" />
        )}
        <input
          type="text"
          value={intent}
          onChange={(e) => setIntent(e.target.value)}
          placeholder="Describe what you need a tool for…"
          className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/55 focus:outline-none"
          aria-label="Describe what you need a tool for"
        />
        <kbd className="hidden h-5 items-center rounded border border-border/70 bg-muted/60 px-1.5 font-mono text-[10px] text-muted-foreground sm:inline-flex">
          semantic
        </kbd>
      </div>

      {/* Sample queries — only when input is empty */}
      {!intent && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 px-3.5 py-2.5">
          <span className="text-[11px] text-muted-foreground/60">Try</span>
          {SAMPLE_INTENTS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setIntent(s)}
              className="text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            >
              {s}
              <span className="mx-1 text-muted-foreground/30">·</span>
            </button>
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="border-t border-border/50 px-3.5 py-2.5 text-[12px] text-destructive/85">
          {error}
        </div>
      )}

      {/* Results */}
      {showResults && hits && hits.length > 0 && (
        <ul>
          {hits.map((hit) => (
            <li key={hit.id} className="border-t border-border/50">
              <Link
                href={`/tools/${hit.id}`}
                className="group flex items-center gap-3 px-3.5 py-2.5 transition-colors hover:bg-muted/40"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="font-mono text-[12px] text-foreground/90">
                      {hit.name}
                    </span>
                    <span className="truncate text-[12px] text-muted-foreground/70">
                      {hit.description}
                    </span>
                  </span>
                </span>
                <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-muted-foreground/65">
                  {Math.round(hit.confidence * 100)}%
                </span>
                <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {/* Empty result */}
      {showResults && hits && hits.length === 0 && !loading && (
        <div className="border-t border-border/50 px-3.5 py-2.5 text-[12px] text-muted-foreground">
          No registered tool matches.{" "}
          <Link
            href="/chat"
            className="text-foreground underline-offset-4 hover:underline"
          >
            Ask the chat
          </Link>{" "}
          to synthesize one.
        </div>
      )}
    </div>
  )
}
