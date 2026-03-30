import { useCallback, useMemo, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { useAuth } from "@clerk/clerk-react"
import { AnimatePresence, motion } from "framer-motion"
import {
  ArrowLeft,
  Check,
  Code,
  Copy,
  Loader2,
  Play,
} from "lucide-react"

import type { ToolParam } from "@/hooks/use-tools"
import { useExecuteTool, useTool } from "@/hooks/use-tools"
import { cn } from "@/lib/utils"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildDefaultValues(params: ToolParam[]): Record<string, unknown> {
  const defaults: Record<string, unknown> = {}
  for (const p of params) {
    if (p.default !== undefined) {
      defaults[p.name] = p.default
    } else if (p.type === "bool") {
      defaults[p.name] = false
    } else {
      defaults[p.name] = ""
    }
  }
  return defaults
}

function coerceValue(raw: unknown, type: string): unknown {
  if (type === "int" || type === "integer") return Number(raw)
  if (type === "float" || type === "number") return Number(raw)
  if (type === "bool" || type === "boolean") return Boolean(raw)
  return raw
}

const tabMotion = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
  transition: { duration: 0.2, ease: "easeInOut" as const },
}

// ---------------------------------------------------------------------------
// CopyButton
// ---------------------------------------------------------------------------

function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [text])

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              className={cn("shrink-0", className)}
              onClick={handleCopy}
            />
          }
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </TooltipTrigger>
        <TooltipContent>{copied ? "Copied!" : "Copy"}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

// ---------------------------------------------------------------------------
// CodeBlock
// ---------------------------------------------------------------------------

function CodeBlock({
  code,
  language,
}: {
  code: string
  language: string
}) {
  return (
    <div className="group/code relative rounded-lg border border-border bg-muted/50 dark:bg-muted/30">
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {language}
        </span>
        <CopyButton text={code} />
      </div>
      <pre className="overflow-x-auto p-4 text-sm leading-relaxed">
        <code className="text-foreground/90">{code}</code>
      </pre>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function ToolDetailSkeleton() {
  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-8">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-5 w-96" />
      <div className="flex gap-2">
        <Skeleton className="h-5 w-16" />
        <Skeleton className="h-5 w-20" />
      </div>
      <Skeleton className="h-px w-full" />
      <Skeleton className="h-8 w-64" />
      <div className="space-y-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Overview Tab
// ---------------------------------------------------------------------------

function OverviewTab({ params }: { params: ToolParam[] }) {
  if (params.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        This tool does not define any input parameters.
      </p>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-3 text-base font-semibold">Input Parameters</h3>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 dark:bg-muted/30">
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                  Name
                </th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                  Type
                </th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                  Required
                </th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                  Default
                </th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                  Description
                </th>
              </tr>
            </thead>
            <tbody>
              {params.map((p) => (
                <tr
                  key={p.name}
                  className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                >
                  <td className="px-4 py-2.5 font-mono text-xs font-medium">
                    {p.name}
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge variant="secondary">{p.type}</Badge>
                  </td>
                  <td className="px-4 py-2.5">
                    {p.required ? (
                      <Badge variant="destructive">required</Badge>
                    ) : (
                      <span className="text-muted-foreground">optional</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                    {p.default !== undefined ? String(p.default) : "\u2014"}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {p.description || "\u2014"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Playground Tab
// ---------------------------------------------------------------------------

function PlaygroundTab({ toolId, params }: { toolId: string; params: ToolParam[] }) {
  const { isSignedIn, getToken } = useAuth()
  const executeMutation = useExecuteTool()

  const [formValues, setFormValues] = useState<Record<string, unknown>>(() =>
    buildDefaultValues(params),
  )

  const setValue = useCallback((name: string, value: unknown) => {
    setFormValues((prev) => ({ ...prev, [name]: value }))
  }, [])

  const handleExecute = useCallback(async () => {
    const args: Record<string, unknown> = {}
    for (const p of params) {
      const raw = formValues[p.name]
      if (raw === "" && !p.required) continue
      args[p.name] = coerceValue(raw, p.type)
    }

    const token = await getToken()
    executeMutation.mutate({ toolId, args, token: token ?? undefined })
  }, [executeMutation, formValues, getToken, params, toolId])

  if (!isSignedIn) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Authentication Required</CardTitle>
          <CardDescription>
            Sign in to use the playground and execute tools.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Parameters</CardTitle>
          <CardDescription>
            Fill in the parameters below and click Execute to run this tool.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {params.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              This tool has no parameters.
            </p>
          ) : (
            <div className="grid gap-4">
              {params.map((p) => (
                <div key={p.name} className="grid gap-1.5">
                  <label
                    htmlFor={`param-${p.name}`}
                    className="flex items-center gap-2 text-sm font-medium"
                  >
                    <span className="font-mono">{p.name}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {p.type}
                    </Badge>
                    {p.required && (
                      <span className="text-destructive text-xs">*</span>
                    )}
                  </label>
                  {p.description && (
                    <p className="text-xs text-muted-foreground">
                      {p.description}
                    </p>
                  )}
                  {renderField(p, formValues[p.name], setValue)}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Button
        size="lg"
        onClick={handleExecute}
        disabled={executeMutation.isPending}
        className="w-full sm:w-auto"
      >
        {executeMutation.isPending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Play className="size-4" />
        )}
        {executeMutation.isPending ? "Executing..." : "Execute"}
      </Button>

      <AnimatePresence mode="wait">
        {executeMutation.isError && (
          <motion.div key="error" {...tabMotion}>
            <Card className="border-destructive/50">
              <CardHeader>
                <CardTitle className="text-destructive">Error</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-destructive">
                  {executeMutation.error?.message ?? "Execution failed"}
                </p>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {executeMutation.isSuccess && (
          <motion.div key="result" {...tabMotion}>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Result</h3>
                <CopyButton
                  text={JSON.stringify(executeMutation.data, null, 2)}
                />
              </div>
              <pre className="overflow-x-auto rounded-lg border border-border bg-muted/50 p-4 text-sm leading-relaxed dark:bg-muted/30">
                <code className="text-foreground/90">
                  {JSON.stringify(executeMutation.data, null, 2)}
                </code>
              </pre>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function renderField(
  param: ToolParam,
  value: unknown,
  onChange: (name: string, value: unknown) => void,
) {
  const id = `param-${param.name}`

  // Enum -> select
  if (param.enum && param.enum.length > 0) {
    return (
      <select
        id={id}
        value={String(value ?? "")}
        onChange={(e) => onChange(param.name, e.target.value)}
        className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
      >
        <option value="">Select...</option>
        {param.enum.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    )
  }

  // Bool -> checkbox
  if (param.type === "bool" || param.type === "boolean") {
    return (
      <label className="flex items-center gap-2 text-sm">
        <input
          id={id}
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(param.name, e.target.checked)}
          className="size-4 rounded border-input accent-primary"
        />
        <span className="text-muted-foreground">
          {value ? "true" : "false"}
        </span>
      </label>
    )
  }

  // Number types
  if (
    param.type === "int" ||
    param.type === "integer" ||
    param.type === "float" ||
    param.type === "number"
  ) {
    return (
      <Input
        id={id}
        type="number"
        step={param.type === "int" || param.type === "integer" ? 1 : "any"}
        value={String(value ?? "")}
        onChange={(e) => onChange(param.name, e.target.value)}
        placeholder={param.default !== undefined ? String(param.default) : ""}
      />
    )
  }

  // Default: text
  return (
    <Input
      id={id}
      type="text"
      value={String(value ?? "")}
      onChange={(e) => onChange(param.name, e.target.value)}
      placeholder={param.default !== undefined ? String(param.default) : ""}
    />
  )
}

// ---------------------------------------------------------------------------
// Integration Tab
// ---------------------------------------------------------------------------

function IntegrationTab({
  toolId,
  toolDef,
}: {
  toolId: string
  toolDef: Record<string, unknown>
}) {
  const pythonSnippet = `from kiln import KilnRuntime

runtime = KilnRuntime(api_key="YOUR_API_KEY")

result = runtime.execute(
    tool_id="${toolId}",
    args={
        # Add your parameters here
    },
)
print(result)`

  const curlSnippet = `curl -X POST \\
  https://registry.kiln.dev/tools/${toolId}/execute \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -d '{
    "args": {

    }
  }'`

  const jsonSchema = JSON.stringify(toolDef, null, 2)

  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-3 text-base font-semibold flex items-center gap-2">
          <Code className="size-4" />
          Python
        </h3>
        <CodeBlock code={pythonSnippet} language="python" />
      </div>

      <div>
        <h3 className="mb-3 text-base font-semibold flex items-center gap-2">
          <Code className="size-4" />
          HTTP (curl)
        </h3>
        <CodeBlock code={curlSnippet} language="bash" />
      </div>

      <div>
        <h3 className="mb-3 text-base font-semibold flex items-center gap-2">
          <Code className="size-4" />
          Tool Definition (JSON Schema)
        </h3>
        <CodeBlock code={jsonSchema} language="json" />
      </div>

      <p className="text-xs text-muted-foreground">
        Replace <code className="rounded bg-muted px-1 py-0.5">YOUR_API_KEY</code>{" "}
        with your actual API key. You can generate one in your account settings.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function ToolDetailPage() {
  const { toolId } = useParams<{ toolId: string }>()
  const navigate = useNavigate()
  const { data: tool, isLoading, isError, error } = useTool(toolId ?? "")

  const [activeTab, setActiveTab] = useState<string | number>("overview")

  const toolName = useMemo(() => tool?.name ?? "Tool", [tool?.name])

  if (isLoading) {
    return <ToolDetailSkeleton />
  }

  if (isError || !tool) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-8">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft className="size-4" />
          Back to Registry
        </Button>
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-destructive">
              {isError ? "Error Loading Tool" : "Tool Not Found"}
            </CardTitle>
            <CardDescription>
              {error?.message ?? "The requested tool could not be found."}
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8">
      {/* Back button */}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => navigate(-1)}
        className="mb-6 -ml-2"
      >
        <ArrowLeft className="size-4" />
        Back to Registry
      </Button>

      {/* Header */}
      <header className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            {toolName}
          </h1>
          <Badge variant="outline">{tool.version}</Badge>
          <Badge variant="secondary">{tool.category}</Badge>
        </div>

        <p className="max-w-2xl text-base text-muted-foreground leading-relaxed">
          {tool.description}
        </p>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
          <span>
            By <span className="font-medium text-foreground">{tool.author}</span>
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
      </header>

      <Separator className="my-6" />

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
      >
        <TabsList variant="line">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="playground">
            <Play className="size-3.5" />
            Playground
          </TabsTrigger>
          <TabsTrigger value="integration">
            <Code className="size-3.5" />
            Integration
          </TabsTrigger>
        </TabsList>

        <div className="mt-6">
          <AnimatePresence mode="wait">
            <TabsContent key="overview-panel" value="overview">
              <motion.div {...tabMotion}>
                <OverviewTab params={tool.params} />
              </motion.div>
            </TabsContent>

            <TabsContent key="playground-panel" value="playground">
              <motion.div {...tabMotion}>
                <PlaygroundTab
                  toolId={tool.id}
                  params={tool.params}
                />
              </motion.div>
            </TabsContent>

            <TabsContent key="integration-panel" value="integration">
              <motion.div {...tabMotion}>
                <IntegrationTab
                  toolId={tool.id}
                  toolDef={tool.tool_def as unknown as Record<string, unknown>}
                />
              </motion.div>
            </TabsContent>
          </AnimatePresence>
        </div>
      </Tabs>
    </div>
  )
}
