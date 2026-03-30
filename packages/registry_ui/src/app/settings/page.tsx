"use client"

import { useCallback, useState } from "react"
import { useAuth, UserProfile } from "@clerk/nextjs"
import { Show } from "@clerk/nextjs"
import {
  Key,
  Copy,
  Check,
  RefreshCw,
  Loader2,
  Eye,
  EyeOff,
  Settings,
  ShieldCheck,
} from "lucide-react"

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

const REGISTRY_URL =
  process.env.NEXT_PUBLIC_REGISTRY_URL || "http://localhost:8766"

// ---------------------------------------------------------------------------
// API Key Management
// ---------------------------------------------------------------------------

function ApiKeySection() {
  const { getToken } = useAuth()

  const [apiKey, setApiKey] = useState<string | null>(null)
  const [isVisible, setIsVisible] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isRegenerating, setIsRegenerating] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const maskedKey = apiKey
    ? `${apiKey.slice(0, 8)}${"*".repeat(Math.max(0, apiKey.length - 12))}${apiKey.slice(-4)}`
    : null

  const fetchApiKey = useCallback(async () => {
    setIsGenerating(true)
    setError(null)

    try {
      const token = await getToken()
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      }
      if (token) headers["Authorization"] = `Bearer ${token}`

      const res = await fetch(`${REGISTRY_URL}/api-keys`, {
        method: "POST",
        headers,
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Failed to generate API key" }))
        throw new Error(err.detail || "Failed to generate API key")
      }

      const data = await res.json()
      setApiKey(data.api_key || data.key)
      setIsVisible(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate API key")
    } finally {
      setIsGenerating(false)
    }
  }, [getToken])

  const regenerateApiKey = useCallback(async () => {
    setIsRegenerating(true)
    setError(null)

    try {
      const token = await getToken()
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      }
      if (token) headers["Authorization"] = `Bearer ${token}`

      const res = await fetch(`${REGISTRY_URL}/api-keys/regenerate`, {
        method: "POST",
        headers,
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Failed to regenerate API key" }))
        throw new Error(err.detail || "Failed to regenerate API key")
      }

      const data = await res.json()
      setApiKey(data.api_key || data.key)
      setIsVisible(true)
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Failed to regenerate API key"
      )
    } finally {
      setIsRegenerating(false)
    }
  }, [getToken])

  const handleCopy = useCallback(() => {
    if (!apiKey) return
    navigator.clipboard.writeText(apiKey).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [apiKey])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Key className="size-4" />
          API Key
        </CardTitle>
        <CardDescription>
          Use your API key to authenticate requests to the Kiln registry from
          your code or CI/CD pipelines.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {apiKey ? (
          <>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Input
                  readOnly
                  value={isVisible ? apiKey : maskedKey || ""}
                  className="font-mono text-sm pr-20"
                />
                <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => setIsVisible(!isVisible)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    {isVisible ? (
                      <EyeOff className="size-3.5" />
                    ) : (
                      <Eye className="size-3.5" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={handleCopy}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    {copied ? (
                      <Check className="size-3.5 text-emerald-500" />
                    ) : (
                      <Copy className="size-3.5" />
                    )}
                  </Button>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={regenerateApiKey}
                disabled={isRegenerating}
                className="gap-1.5"
              >
                {isRegenerating ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="size-3.5" />
                )}
                Regenerate
              </Button>
              <p className="text-xs text-muted-foreground">
                This will invalidate your current key
              </p>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-4 py-6">
            <div className="flex size-12 items-center justify-center rounded-xl bg-muted">
              <Key className="size-6 text-muted-foreground" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium">No API key generated</p>
              <p className="text-xs text-muted-foreground">
                Generate a key to start using the Kiln API
              </p>
            </div>
            <Button
              onClick={fetchApiKey}
              disabled={isGenerating}
              className="gap-1.5"
            >
              {isGenerating ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Key className="size-4" />
              )}
              {isGenerating ? "Generating..." : "Generate API Key"}
            </Button>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {error}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SettingsPage() {
  return (
    <div className="w-full py-4">
      <Show when="signed-out">
        <div className="flex flex-col items-center justify-center gap-6 py-24 text-center">
          <div className="flex size-16 items-center justify-center rounded-2xl bg-muted ring-1 ring-foreground/[0.06]">
            <Settings className="size-8 text-muted-foreground/60" />
          </div>
          <div className="max-w-sm space-y-2">
            <h3 className="text-lg font-semibold">Sign in required</h3>
            <p className="text-sm leading-relaxed text-muted-foreground">
              You need to sign in to access account settings.
            </p>
          </div>
        </div>
      </Show>

      <Show when="signed-in">
        <SettingsContent />
      </Show>
    </div>
  )
}

function SettingsContent() {
  return (
    <div className="mx-auto max-w-2xl space-y-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 dark:bg-primary/15">
            <Settings className="size-5 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Manage your account and API keys
            </p>
          </div>
        </div>
      </div>

      {/* API Key */}
      <ApiKeySection />

      <Separator />

      {/* Clerk profile */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Account</h2>
        </div>
        <div className="overflow-hidden rounded-xl [&_.cl-rootBox]:w-full [&_.cl-card]:shadow-none [&_.cl-card]:ring-1 [&_.cl-card]:ring-foreground/10">
          <UserProfile
            routing="hash"
            appearance={{
              elements: {
                rootBox: "w-full",
                card: "shadow-none w-full",
              },
            }}
          />
        </div>
      </div>
    </div>
  )
}
