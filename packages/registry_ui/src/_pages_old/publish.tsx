import { SignedIn, SignedOut, SignIn, useAuth } from "@clerk/clerk-react"
import { motion, AnimatePresence } from "framer-motion"
import {
  Upload,
  FileCode,
  FileText,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertTriangle,
} from "lucide-react"
import { useCallback, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"

interface PublishResult {
  success: boolean
  tool_id?: string
  version?: string
  fixtures?: { passed: number; failed: number }
  detail?: string | { message: string; violations?: string[] }
}

export default function PublishPage() {
  const { getToken } = useAuth()
  const [specFile, setSpecFile] = useState<File | null>(null)
  const [implFile, setImplFile] = useState<File | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [result, setResult] = useState<PublishResult | null>(null)

  const handlePublish = useCallback(async () => {
    if (!specFile || !implFile) return

    setIsUploading(true)
    setResult(null)

    try {
      const token = await getToken()
      const formData = new FormData()
      formData.append("spec_file", specFile)
      formData.append("impl_file", implFile)

      const headers: Record<string, string> = {}
      if (token) headers["Authorization"] = `Bearer ${token}`

      const res = await fetch("/tools/register", {
        method: "POST",
        headers,
        body: formData,
      })

      const data = await res.json()
      if (res.ok) {
        setResult({ success: true, ...data })
      } else {
        setResult({ success: false, detail: data.detail || "Unknown error" })
      }
    } catch (e) {
      setResult({ success: false, detail: String(e) })
    } finally {
      setIsUploading(false)
    }
  }, [specFile, implFile, getToken])

  const reset = () => {
    setSpecFile(null)
    setImplFile(null)
    setResult(null)
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <h1 className="text-2xl font-bold tracking-tight">Publish Tool</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload a spec.yaml and implementation file to register a new tool
        </p>
      </motion.div>

      <SignedOut>
        <div className="flex justify-center py-12">
          <SignIn routing="hash" />
        </div>
      </SignedOut>

      <SignedIn>
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <Card className="border-0 shadow-sm ring-1 ring-foreground/[0.06]">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex size-9 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/20">
                  <Upload className="size-4 text-primary" />
                </div>
                <div>
                  <CardTitle>Upload Files</CardTitle>
                  <CardDescription>
                    Both files are validated against the Kiln spec schema and blocked package list
                  </CardDescription>
                </div>
              </div>
            </CardHeader>

            <CardContent className="space-y-4">
              {/* Spec file */}
              <FileDropZone
                label="spec.yaml"
                description="Tool specification (YAML)"
                accept=".yaml,.yml"
                icon={<FileText className="size-5" />}
                file={specFile}
                onFile={setSpecFile}
              />

              {/* Impl file */}
              <FileDropZone
                label="implementation.py"
                description="Python implementation file"
                accept=".py"
                icon={<FileCode className="size-5" />}
                file={implFile}
                onFile={setImplFile}
              />

              <Separator />

              <div className="flex gap-3">
                <Button
                  onClick={handlePublish}
                  disabled={!specFile || !implFile || isUploading}
                  className="gap-2"
                >
                  {isUploading ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Upload className="size-4" />
                  )}
                  {isUploading ? "Publishing..." : "Publish Tool"}
                </Button>
                {(specFile || implFile || result) && (
                  <Button variant="outline" onClick={reset}>
                    Reset
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Result */}
        <AnimatePresence>
          {result && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
            >
              {result.success ? (
                <Card className="border-emerald-500/20 bg-emerald-500/5 shadow-sm">
                  <CardContent className="flex items-start gap-3 pt-6">
                    <CheckCircle2 className="mt-0.5 size-5 text-emerald-600" />
                    <div className="space-y-1">
                      <p className="font-medium text-emerald-700 dark:text-emerald-400">
                        Tool published successfully
                      </p>
                      <p className="text-sm text-muted-foreground">
                        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                          {result.tool_id}
                        </code>
                        {" v"}{result.version}
                      </p>
                      {result.fixtures && (
                        <div className="flex gap-2 pt-1">
                          <Badge variant="secondary" className="gap-1">
                            <CheckCircle2 className="size-3" />
                            {result.fixtures.passed} passed
                          </Badge>
                          {result.fixtures.failed > 0 && (
                            <Badge variant="destructive" className="gap-1">
                              <XCircle className="size-3" />
                              {result.fixtures.failed} failed
                            </Badge>
                          )}
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <Card className="border-destructive/20 bg-destructive/5 shadow-sm">
                  <CardContent className="flex items-start gap-3 pt-6">
                    <XCircle className="mt-0.5 size-5 text-destructive" />
                    <div className="space-y-2">
                      <p className="font-medium text-destructive">
                        Publishing failed
                      </p>
                      <ErrorDetail detail={result.detail} />
                    </div>
                  </CardContent>
                </Card>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </SignedIn>
    </div>
  )
}

function FileDropZone({
  label,
  description,
  accept,
  icon,
  file,
  onFile,
}: {
  label: string
  description: string
  accept: string
  icon: React.ReactNode
  file: File | null
  onFile: (f: File | null) => void
}) {
  return (
    <label className="group relative flex cursor-pointer items-center gap-4 rounded-xl border border-dashed border-border/80 p-4 transition-colors hover:border-primary/40 hover:bg-muted/30">
      <div className="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary">
        {icon}
      </div>
      <div className="flex-1">
        <p className="text-sm font-medium">{label}</p>
        {file ? (
          <p className="text-xs text-emerald-600 dark:text-emerald-400">
            {file.name} ({(file.size / 1024).toFixed(1)} KB)
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      {file && (
        <CheckCircle2 className="size-4 text-emerald-600" />
      )}
      <input
        type="file"
        accept={accept}
        className="absolute inset-0 cursor-pointer opacity-0"
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
      />
    </label>
  )
}

function ErrorDetail({ detail }: { detail?: string | { message: string; violations?: string[] } }) {
  if (!detail) return null
  if (typeof detail === "string") {
    return <p className="text-sm text-muted-foreground">{detail}</p>
  }
  return (
    <div className="space-y-1">
      <p className="text-sm text-muted-foreground">{detail.message}</p>
      {detail.violations && (
        <ul className="space-y-0.5">
          {detail.violations.map((v, i) => (
            <li key={i} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <AlertTriangle className="size-3 text-amber-500" />
              {v}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
