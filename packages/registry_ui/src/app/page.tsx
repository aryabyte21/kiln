import { Button } from "@/components/ui/button"
import { Flame, ArrowRight, CheckCircle, X, Package } from "lucide-react"
import Link from "next/link"

import { fetchTools, fetchToolStats } from "@/lib/registry"
import type { Tool, ToolStats } from "@/lib/registry"
import { Card, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

const hoverClassName = "hover:-translate-y-0.5 hover:shadow-[0_22px_56px_hsl(223_80%_4%_/_0.48)]"

export default async function LandingPage() {
  let tools: Tool[] = []
  let stats: ToolStats | null = null
  let error: string | null = null

  try {
    ;[tools, stats] = await Promise.all([fetchTools(), fetchToolStats()])
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load tools"
  }

  return <Home tools={tools} error={error} />
}

function Home({
  tools,
  error,
}: {
  tools: Tool[]
  error: string | null
}) {
  return (
    <div className="w-full">
      {/* ================= HERO ================= */}
      <section className="relative overflow-hidden px-6 py-20 text-center">
        {/* Background glow */}
        <div className="pointer-events-none absolute -top-40 left-1/2 -translate-x-1/2 size-[600px] rounded-full bg-primary/10 blur-3xl" />

        <div className="">
          <div className="flex justify-center mb-6">
            <div className="relative flex size-14 items-center justify-center">
              <span className="absolute inset-0 rounded-xl bg-primary/30 blur-xl" />
              <div className="relative flex size-14 items-center justify-center rounded-xl bg-primary/20 ring-1 ring-primary/40">
                <Flame className="size-7 text-primary" />
              </div>
            </div>
          </div>

          <h1 className="text-4xl md:text-5xl font-bold tracking-tight">
            Your AI agent shouldn’t stop when a tool is missing.
          </h1>

          <p className="mt-4 text-lg text-muted-foreground">
            Kiln is a self-evolving tool system.
            Ask anything — it builds the tools it needs, then gets it done.
          </p>

          <div className="mt-8 flex justify-center gap-4">
            <Button variant={"default"} className={hoverClassName}>
              Get Started <ArrowRight className="size-4" />
            </Button>

            <Link href="/tools">
              <Button variant={"outline"} className={hoverClassName}>
                View Registry
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* ================= PROBLEM ================= */}
      <section className="px-6 py-20 max-w-6xl mx-auto">
        <h2 className="text-2xl font-semibold text-center mb-12">
          Today’s AI agents are fundamentally limited
        </h2>

        <div className="grid md:grid-cols-3 gap-8 text-sm">
          <div className="p-6 rounded-xl border border-border">
            <h3 className="font-medium mb-2">Missing tools = failure</h3>
            <p className="text-muted-foreground">
              Agents cannot complete tasks if the required tool does not exist.
            </p>
          </div>

          <div className="p-6 rounded-xl border border-border">
            <h3 className="font-medium mb-2">Manual integrations</h3>
            <p className="text-muted-foreground">
              Developers must write, deploy, and restart systems to add tools.
            </p>
          </div>

          <div className="p-6 rounded-xl border border-border">
            <h3 className="font-medium mb-2">Fragmented ecosystem</h3>
            <p className="text-muted-foreground">
              Tools don’t work across frameworks like LangChain or CrewAI.
            </p>
          </div>
        </div>
      </section>

      {/* ================= MAGIC ================= */}
      <section className="px-6 py-20 text-center bg-muted/30 border-y border-border">
        <h2 className="text-3xl font-semibold mb-6">
          Missing tool? Kiln builds it instantly.
        </h2>

        <p className="text-muted-foreground max-w-2xl mx-auto">
          When your agent encounters a missing capability, Kiln generates the tool,
          validates it, and makes it instantly available to all agents.
        </p>

        <div className="mt-10 flex justify-center gap-6 text-sm items-center">
          <span>Ask</span>
          <span>→</span>
          <span>Plan</span>
          <span>→</span><Card className=" flex-row justify-center gap-5 outline p-5 items-center">
          <span className="text-primary font-medium">Missing Tool</span>
          <span>→</span>
          <span className="text-primary font-medium">Generate</span>
          <span>→</span>
          <span className="text-primary font-medium">Register</span>
          </Card><span>→</span>
          <span>Execute</span>
        </div>
      </section>

      {/* ================= HOW IT WORKS ================= */}
      <section className="px-6 py-20 max-w-6xl mx-auto">
        <h2 className="text-2xl font-semibold text-center mb-12">
          How Kiln Works
        </h2>

        <div className="grid md:grid-cols-3 gap-6 text-sm">
          {[
            "Detect missing capability",
            "Generate tool via LLM",
            "Sandbox execution (gVisor)",
            "Validate with tests & schema",
            "Register with versioning",
            "Hot-load without restart",
          ].map((step, i) => (
            <div key={i} className="flex items-start gap-3 p-4 border border-border rounded-lg">
              <CheckCircle className="size-4 text-primary mt-1" />
              {step}
            </div>
          ))}
        </div>
      </section>

      {/* ================= REGISTRY PREVIEW ================= */}
      <section className="px-6 py-20 text-center bg-muted/30 border-y border-border">
        <h2 className="text-2xl font-semibold mb-6">
          A shared registry for all agents
        </h2>

        <p className="text-muted-foreground max-w-xl mx-auto mb-10">
          Discover, version, and reuse tools across frameworks. No duplication.
        </p>

        <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {error && (
            <div className="flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive dark:border-destructive/20 dark:bg-destructive/10">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-destructive/10">
                <X className="size-4" />
              </div>
              <p>Failed to load tools: {error}</p>
            </div>
          )}
          {!error && (
            tools.sort(() => Math.random() - 0.5).slice(0, 3).map((tool, i) => (
              <div key={i} className={`p-5 border border-border rounded-xl text-left ${hoverClassName} "section-surface group/tool relative h-full cursor-pointer overflow-hidden border-border/70 bg-card/75 transition-all duration-300 hover:-translate-y-1 hover:border-primary/25 hover:shadow-[0_28px_72px_hsl(223_80%_4%_/_0.55)]"`}>
                <Link href={`/tools/${tool.id}`} className="block">
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
                </Link>
              </div>
            ))
          )
          }
        </div>
      </section>

      {/* ================= TRUST ================= */}
      <section className="px-6 py-20 max-w-6xl mx-auto text-center">
        <h2 className="text-2xl font-semibold mb-6">
          Built for safety and scale
        </h2>

        <div className="grid md:grid-cols-4 gap-6 text-sm">
          {[
            "gVisor sandboxed execution",
            "Dependency safety checks",
            "Policy enforcement",
            "Audit logging & RBAC",
          ].map((item, i) => (
            <div key={i} className="p-4 border border-border rounded-lg">
              {item}
            </div>
          ))}
        </div>
      </section>

      {/* ================= FINAL CTA ================= */}
      <section className="px-6 py-20 text-center">
        <h2 className="text-3xl font-semibold mb-4">
          Stop building tools. Start using them.
        </h2>

        <p className="text-muted-foreground mb-8">
          Connect Kiln and unlock a self-expanding ecosystem for your agents.
        </p>

        <div className="flex justify-center gap-4">
          <Button variant={"default"} className={`${hoverClassName} px-6 py-6`}>
            Get Started
          </Button>
        </div>
      </section>
    </div>
  )
}
