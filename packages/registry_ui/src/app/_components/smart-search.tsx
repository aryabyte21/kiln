"use client"

/**
 * SmartSearch — natural-language tool discovery panel.
 *
 * Sits above the registry catalog grid and lets anyone type what they
 * *want to do* ("get the weather for Tokyo") instead of guessing a tool
 * name. Hits `/tools/search?mode=semantic` on the registry API, ranks by
 * BM25, and renders live results with a confidence chip per hit.
 *
 * This is the canonical demo of Kiln's intent-routing primitive — the
 * same thing an agent calls via POST /tools/route before asking the
 * synthesis pipeline to generate a brand-new tool.
 */

import Link from "next/link"
import { useCallback, useEffect, useRef, useState } from "react"
import { ArrowRight, Sparkles, Wand2, Loader2 } from "lucide-react"

import { searchToolsSemantic, type RankedTool } from "@/lib/registry"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"

const SAMPLE_INTENTS = [
  "get weather for Tokyo",
  "top stories on ycombinator",
  "latest bitcoin price",
  "transcript of a youtube video",
  "search wikipedia",
]

function ConfidenceChip({ confidence }: { confidence: number }) {
  // Three buckets — picked so the chip stays glanceable:
  //   ≥ 0.85  strong (green)
  //   ≥ 0.6   likely (amber)
  //   else    weak   (muted)
  // The thresholds match the synthesis-gate cutoff we recommend for
  // agents (≥ 0.82 = reuse, else allow synthesis), rounded for humans.
  const pct = Math.round(confidence * 100)
  const [label, tone] =
    confidence >= 0.85
      ? ["strong", "bg-emerald-500/15 text-emerald-400 ring-emerald-500/40"]
      : confidence >= 0.6
        ? ["likely", "bg-amber-500/15 text-amber-400 ring-amber-500/40"]
        : ["weak", "bg-muted text-muted-foreground ring-border/60"]
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${tone}`}
      title={`BM25 confidence ${pct}% (${label})`}
    >
      {pct}%
    </span>
  )
}

export function SmartSearch() {
  const [intent, setIntent] = useState("")
  const [hits, setHits] = useState<RankedTool[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Track the most recent in-flight query so responses that arrive out of
  // order (slow network, user still typing) don't clobber the current UI
  // state with stale ranked results.
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
      const results = await searchToolsSemantic(trimmed, 6)
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

  return (
    <div className="section-surface relative mb-6 overflow-hidden">
      <div className="pointer-events-none absolute -left-24 -top-24 size-64 rounded-full bg-gradient-to-br from-primary/[0.18] to-primary/[0.02] blur-3xl" />
      <div className="pointer-events-none absolute -bottom-20 -right-20 size-56 rounded-full bg-gradient-to-br from-violet-500/[0.15] to-sky-400/[0.02] blur-3xl" />

      <div className="relative p-5 sm:p-6">
        <div className="mb-3 flex items-center gap-2">
          <span className="inline-flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-primary/25 to-primary/10 ring-1 ring-primary/40">
            <Wand2 className="size-3.5 text-primary" />
          </span>
          <div>
            <h2 className="text-sm font-semibold tracking-tight">
              Smart search
            </h2>
            <p className="text-xs text-muted-foreground">
              Describe what you want — we&apos;ll rank the best-matching tools.
            </p>
          </div>
        </div>

        <label className="relative block">
          <span className="sr-only">Describe what you want a tool to do</span>
          <Sparkles className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-primary/70" />
          <Input
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            placeholder="e.g. get me the top stories on ycombinator"
            className="h-12 rounded-xl border-primary/30 bg-card/80 pl-10 pr-4 text-sm shadow-sm ring-1 ring-primary/20 transition-all duration-300 placeholder:text-muted-foreground/70 focus-visible:bg-card focus-visible:ring-2 focus-visible:ring-primary/50"
          />
          {loading && (
            <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground/70" />
          )}
        </label>

        {!intent && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {SAMPLE_INTENTS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setIntent(s)}
                className="rounded-full bg-muted/70 px-3 py-1 text-xs text-muted-foreground ring-1 ring-border/70 transition hover:bg-muted hover:text-foreground"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {error && (
          <p className="mt-4 text-xs text-destructive">
            Couldn&apos;t reach the registry: {error}
          </p>
        )}

        {hits && hits.length > 0 && (
          <ul className="mt-4 space-y-1.5">
            {hits.map((hit, idx) => (
              <li key={hit.id}>
                <Link
                  href={`/tools/${hit.id}`}
                  className="group flex items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 transition hover:border-border/70 hover:bg-card/70"
                >
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-[11px] font-semibold text-muted-foreground ring-1 ring-border/60">
                    {idx + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">
                        {hit.name}
                      </span>
                      <ConfidenceChip confidence={hit.confidence} />
                      {idx === 0 && (
                        <Badge
                          variant="secondary"
                          className="h-5 px-1.5 text-[10px]"
                        >
                          best match
                        </Badge>
                      )}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {hit.description}
                    </p>
                  </div>
                  <ArrowRight className="size-4 shrink-0 text-muted-foreground/60 transition group-hover:translate-x-0.5 group-hover:text-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        )}

        {hits && hits.length === 0 && !loading && (
          <p className="mt-4 text-xs text-muted-foreground">
            No match in the registry.{" "}
            <Link
              href="/chat"
              className="text-primary underline-offset-4 hover:underline"
            >
              Ask the chat
            </Link>{" "}
            — it can synthesize a new tool for this intent.
          </p>
        )}
      </div>
    </div>
  )
}
