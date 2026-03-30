"use client"

import { useCallback, useRef, useState } from "react"
import { useAuth } from "@clerk/nextjs"
import { Show } from "@clerk/nextjs"
import {
  Upload,
  FileCode,
  FileText,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertTriangle,
  Sparkles,
  X,
  ShieldAlert,
} from "lucide-react"

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

const REGISTRY_URL =
  process.env.NEXT_PUBLIC_REGISTRY_URL || "http://localhost:8766"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FixtureResult {
  name: string
  passed: boolean
  message?: string
}

interface PublishResponse {
  tool_id: string
  name: string
  version: string
  fixture_results?: FixtureResult[]
  blocked_packages?: string[]
  message?: string
}

interface PublishError {
  detail?: string
  blocked_packages?: string[]
  fixture_results?: FixtureResult[]
}

// ---------------------------------------------------------------------------
// FileDropZone
// ---------------------------------------------------------------------------

function FileDropZone({
  label,
  accept,
  icon: Icon,
  file,
  onFile,
  description,
}: {
  label: string
  accept: string
  icon: React.ComponentType<{ className?: string }>
  file: File | null
  onFile: (f: File | null) => void
  description: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
      const dropped = e.dataTransfer.files[0]
      if (dropped) onFile(dropped)
    },
    [onFile]
  )

  return (
    <div
      className={`relative rounded-xl border-2 border-dashed transition-all duration-200 ${
        isDragging
          ? "border-primary bg-primary/5"
          : file
            ? "border-emerald-500/50 bg-emerald-500/5"
            : "border-border hover:border-muted-foreground/30"
      }`}
      onDragOver={(e) => {
        e.preventDefault()
        setIsDragging(true)
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const selected = e.target.files?.[0] ?? null
          onFile(selected)
        }}
      />

      <button
        type="button"
        className="flex w-full flex-col items-center gap-3 p-8"
        onClick={() => inputRef.current?.click()}
      >
        <div
          className={`flex size-12 items-center justify-center rounded-xl transition-colors ${
            file
              ? "bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400"
              : "bg-muted text-muted-foreground"
          }`}
        >
          <Icon className="size-6" />
        </div>

        {file ? (
          <div className="text-center">
            <p className="text-sm font-medium text-foreground">{file.name}</p>
            <p className="text-xs text-muted-foreground">
              {(file.size / 1024).toFixed(1)} KB
            </p>
          </div>
        ) : (
          <div className="text-center">
            <p className="text-sm font-medium">{label}</p>
            <p className="text-xs text-muted-foreground">{description}</p>
          </div>
        )}
      </button>

      {file && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onFile(null)
            if (inputRef.current) inputRef.current.value = ""
          }}
          className="absolute right-2 top-2 flex size-6 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Result display
// ---------------------------------------------------------------------------

function FixtureResults({ results }: { results: FixtureResult[] }) {
  if (results.length === 0) return null

  const passed = results.filter((r) => r.passed).length
  const failed = results.length - passed

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="size-4" />
          Fixture Results
        </CardTitle>
        <CardDescription>
          {passed} passed, {failed} failed out of {results.length} fixtures
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {results.map((r, i) => (
            <div
              key={i}
              className={`flex items-start gap-3 rounded-lg p-3 text-sm ${
                r.passed
                  ? "bg-emerald-500/5 dark:bg-emerald-500/10"
                  : "bg-destructive/5 dark:bg-destructive/10"
              }`}
            >
              {r.passed ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
              )}
              <div>
                <p className="font-medium">{r.name}</p>
                {r.message && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {r.message}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function BlockedPackages({ packages }: { packages: string[] }) {
  if (packages.length === 0) return null

  return (
    <Card className="border-amber-500/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base text-amber-600 dark:text-amber-400">
          <ShieldAlert className="size-4" />
          Blocked Packages
        </CardTitle>
        <CardDescription>
          The following packages are not allowed and must be removed from your
          implementation.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2">
          {packages.map((pkg) => (
            <Badge
              key={pkg}
              variant="outline"
              className="border-amber-500/30 font-mono text-amber-600 dark:text-amber-400"
            >
              {pkg}
            </Badge>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function PublishPage() {
  return (
    <div className="w-full py-4">
      <Show when="signed-out">
        <div className="flex flex-col items-center justify-center gap-6 py-24 text-center">
          <div className="flex size-16 items-center justify-center rounded-2xl bg-muted ring-1 ring-foreground/[0.06]">
            <Upload className="size-8 text-muted-foreground/60" />
          </div>
          <div className="max-w-sm space-y-2">
            <h3 className="text-lg font-semibold">Sign in required</h3>
            <p className="text-sm leading-relaxed text-muted-foreground">
              You need to sign in to publish tools to the Kiln registry.
            </p>
          </div>
        </div>
      </Show>

      <Show when="signed-in">
        <PublishForm />
      </Show>
    </div>
  )
}

function PublishForm() {
  const { getToken } = useAuth()

  const [specFile, setSpecFile] = useState<File | null>(null)
  const [implFile, setImplFile] = useState<File | null>(null)
  const [isPublishing, setIsPublishing] = useState(false)
  const [publishResult, setPublishResult] = useState<PublishResponse | null>(
    null
  )
  const [publishError, setPublishError] = useState<string | null>(null)
  const [fixtureResults, setFixtureResults] = useState<FixtureResult[]>([])
  const [blockedPackages, setBlockedPackages] = useState<string[]>([])

  const canPublish = specFile && implFile && !isPublishing

  const handlePublish = useCallback(async () => {
    if (!specFile || !implFile) return

    setIsPublishing(true)
    setPublishResult(null)
    setPublishError(null)
    setFixtureResults([])
    setBlockedPackages([])

    try {
      const token = await getToken()
      const formData = new FormData()
      formData.append("spec", specFile)
      formData.append("impl", implFile)

      const headers: Record<string, string> = {}
      if (token) headers["Authorization"] = `Bearer ${token}`

      const res = await fetch(`${REGISTRY_URL}/tools/register`, {
        method: "POST",
        headers,
        body: formData,
      })

      const data = await res.json()

      if (!res.ok) {
        const errData = data as PublishError
        if (errData.fixture_results) {
          setFixtureResults(errData.fixture_results)
        }
        if (errData.blocked_packages) {
          setBlockedPackages(errData.blocked_packages)
        }
        throw new Error(errData.detail || "Failed to publish tool")
      }

      const result = data as PublishResponse
      setPublishResult(result)
      if (result.fixture_results) {
        setFixtureResults(result.fixture_results)
      }
      if (result.blocked_packages) {
        setBlockedPackages(result.blocked_packages)
      }
    } catch (e) {
      setPublishError(e instanceof Error ? e.message : "Failed to publish tool")
    } finally {
      setIsPublishing(false)
    }
  }, [specFile, implFile, getToken])

  const handleReset = useCallback(() => {
    setSpecFile(null)
    setImplFile(null)
    setPublishResult(null)
    setPublishError(null)
    setFixtureResults([])
    setBlockedPackages([])
  }, [])

  return (
    <div className="mx-auto max-w-2xl">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 dark:bg-primary/15">
            <Upload className="size-5 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              Publish a Tool
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Upload your tool specification and implementation to the registry
            </p>
          </div>
        </div>
      </div>

      {/* Upload area */}
      <Card>
        <CardHeader>
          <CardTitle>Upload Files</CardTitle>
          <CardDescription>
            Drag and drop or click to upload your spec.yaml and impl.py files.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <FileDropZone
            label="spec.yaml"
            accept=".yaml,.yml"
            icon={FileText}
            file={specFile}
            onFile={setSpecFile}
            description="Tool specification defining name, params, and metadata"
          />
          <FileDropZone
            label="impl.py"
            accept=".py"
            icon={FileCode}
            file={implFile}
            onFile={setImplFile}
            description="Python implementation of the tool logic"
          />
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="mt-6 flex items-center gap-3">
        <Button
          size="lg"
          onClick={handlePublish}
          disabled={!canPublish}
          className="gap-2"
        >
          {isPublishing ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Upload className="size-4" />
          )}
          {isPublishing ? "Publishing..." : "Publish Tool"}
        </Button>
        {(publishResult || publishError) && (
          <Button variant="outline" size="lg" onClick={handleReset}>
            Reset
          </Button>
        )}
      </div>

      <Separator className="my-6" />

      {/* Success */}
      {publishResult && (
        <Card className="border-emerald-500/30 bg-emerald-500/5 dark:bg-emerald-500/10">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="size-5" />
              Tool Published Successfully
            </CardTitle>
            <CardDescription>
              {publishResult.message ||
                `${publishResult.name} v${publishResult.version} has been registered.`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3 text-sm">
              <div>
                <span className="text-muted-foreground">Tool ID: </span>
                <span className="font-mono font-medium">
                  {publishResult.tool_id}
                </span>
              </div>
              <Separator orientation="vertical" className="h-5" />
              <div>
                <span className="text-muted-foreground">Version: </span>
                <span className="font-mono font-medium">
                  {publishResult.version}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Error */}
      {publishError && (
        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="size-5" />
              Publication Failed
            </CardTitle>
            <CardDescription className="text-destructive/80">
              {publishError}
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {/* Blocked packages */}
      {blockedPackages.length > 0 && (
        <div className="mt-4">
          <BlockedPackages packages={blockedPackages} />
        </div>
      )}

      {/* Fixture results */}
      {fixtureResults.length > 0 && (
        <div className="mt-4">
          <FixtureResults results={fixtureResults} />
        </div>
      )}
    </div>
  )
}
