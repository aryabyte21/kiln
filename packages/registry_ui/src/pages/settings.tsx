import { useState, useCallback } from "react"
import { SignedIn, SignedOut, SignIn, UserProfile } from "@clerk/clerk-react"
import { motion, AnimatePresence } from "framer-motion"
import {
  Key,
  Copy,
  Check,
  RefreshCw,
  Shield,
  Terminal,
} from "lucide-react"

import { useApiKey } from "@/hooks/use-api-key"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"

const fadeUp = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.3 },
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const copy = useCallback(async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [text])

  return (
    <Button variant="ghost" size="icon-sm" onClick={copy} aria-label="Copy">
      <AnimatePresence mode="wait" initial={false}>
        {copied ? (
          <motion.span
            key="check"
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.6, opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <Check className="size-3.5 text-green-500" />
          </motion.span>
        ) : (
          <motion.span
            key="copy"
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.6, opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <Copy className="size-3.5" />
          </motion.span>
        )}
      </AnimatePresence>
    </Button>
  )
}

function CodeBlock({ code, label }: { code: string; label?: string }) {
  return (
    <div className="relative rounded-lg border border-border bg-muted/40 dark:bg-muted/20">
      {label && (
        <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            {label}
          </span>
          <CopyButton text={code} />
        </div>
      )}
      <div className="flex items-start gap-2 p-3">
        <pre className="flex-1 overflow-x-auto text-xs leading-relaxed">
          <code className="font-mono text-foreground">{code}</code>
        </pre>
        {!label && <CopyButton text={code} />}
      </div>
    </div>
  )
}

function ApiKeySection() {
  const { query, create, regenerate } = useApiKey()
  const [newKey, setNewKey] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const maskedKey = query.data?.api_key
  const hasKey = !!maskedKey

  const handleCreate = async () => {
    const result = await create.mutateAsync()
    setNewKey(result.api_key)
  }

  const handleRegenerate = async () => {
    setConfirmOpen(false)
    const result = await regenerate.mutateAsync()
    setNewKey(result.api_key)
  }

  return (
    <motion.div {...fadeUp}>
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10">
              <Key className="size-4 text-primary" />
            </div>
            <div className="flex-1">
              <CardTitle>API Key</CardTitle>
              <CardDescription>
                Use this key to authenticate CLI and MCP client requests
              </CardDescription>
            </div>
            {hasKey && (
              <Badge variant="outline" className="gap-1">
                <Shield className="size-3" />
                Active
              </Badge>
            )}
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Current key display */}
          {query.isLoading ? (
            <div className="h-8 animate-pulse rounded-lg bg-muted" />
          ) : hasKey ? (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 dark:bg-muted/20">
              <code className="flex-1 font-mono text-sm text-muted-foreground">
                {maskedKey}
              </code>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmOpen(true)}
                disabled={regenerate.isPending}
              >
                {regenerate.isPending ? (
                  <RefreshCw className="size-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="size-3.5" />
                )}
                Regenerate
              </Button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border py-6 text-center">
              <div className="flex size-10 items-center justify-center rounded-full bg-muted">
                <Key className="size-5 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">
                No API key generated
              </p>
              <Button
                onClick={handleCreate}
                disabled={create.isPending}
                size="sm"
              >
                {create.isPending ? (
                  <RefreshCw className="size-3.5 animate-spin" />
                ) : (
                  <Key className="size-3.5" />
                )}
                Generate API Key
              </Button>
            </div>
          )}

          {/* Newly generated key reveal */}
          <AnimatePresence>
            {newKey && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.25 }}
                className="overflow-hidden"
              >
                <div className="space-y-3 rounded-lg border border-green-500/30 bg-green-500/5 p-4 dark:border-green-500/20 dark:bg-green-500/5">
                  <div className="flex items-center gap-2 text-sm font-medium text-green-700 dark:text-green-400">
                    <Check className="size-4" />
                    API key generated successfully
                  </div>
                  <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2">
                    <code className="flex-1 break-all font-mono text-sm">
                      {newKey}
                    </code>
                    <CopyButton text={newKey} />
                  </div>
                  <div className="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-400">
                    <Shield className="mt-0.5 size-3.5 shrink-0" />
                    Store this key securely. You won't be able to see it again.
                  </div>

                  <Separator />

                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground">
                      Usage example
                    </p>
                    <CodeBlock
                      code={`curl -H "X-API-Key: ${newKey}" https://your-registry.example.com/tools`}
                    />
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Error messages */}
          {(create.isError || regenerate.isError) && (
            <motion.p
              {...fadeUp}
              className="text-sm text-destructive"
            >
              {create.error?.message || regenerate.error?.message}
            </motion.p>
          )}
        </CardContent>
      </Card>

      {/* Regenerate confirmation dialog */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Regenerate API Key?</DialogTitle>
            <DialogDescription>
              This will invalidate your current API key immediately. Any
              integrations using the old key will stop working.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleRegenerate}
              disabled={regenerate.isPending}
            >
              {regenerate.isPending ? (
                <RefreshCw className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              Regenerate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  )
}

function QuickStartSection() {
  const httpExample = `# Authenticate with your API key
curl -H "X-API-Key: your-api-key" \\
  https://your-registry.example.com/tools`

  const mcpExample = `{
  "mcpServers": {
    "kiln-registry": {
      "url": "https://your-registry.example.com/mcp",
      "headers": {
        "X-API-Key": "your-api-key"
      }
    }
  }
}`

  return (
    <motion.div {...fadeUp} transition={{ ...fadeUp.transition, delay: 0.1 }}>
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10">
              <Terminal className="size-4 text-primary" />
            </div>
            <div>
              <CardTitle>Quick Start</CardTitle>
              <CardDescription>
                Use your API key to authenticate requests
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="space-y-2">
            <h4 className="flex items-center gap-1.5 text-sm font-medium">
              <Badge variant="secondary" className="font-mono text-[10px]">
                HTTP
              </Badge>
              Header Authentication
            </h4>
            <CodeBlock code={httpExample} label="Terminal" />
          </div>

          <Separator />

          <div className="space-y-2">
            <h4 className="flex items-center gap-1.5 text-sm font-medium">
              <Badge variant="secondary" className="font-mono text-[10px]">
                MCP
              </Badge>
              Client Configuration
            </h4>
            <CodeBlock code={mcpExample} label="mcp.json" />
            <p className="text-xs text-muted-foreground">
              Add this to your MCP client configuration file to connect to the
              registry.
            </p>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  )
}

export default function SettingsPage() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8">
      <SignedOut>
        <div className="flex min-h-[60vh] items-center justify-center">
          <motion.div {...fadeUp}>
            <SignIn />
          </motion.div>
        </div>
      </SignedOut>

      <SignedIn>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
          className="space-y-8"
        >
          {/* Page header */}
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
            <p className="text-sm text-muted-foreground">
              Manage your API key and account preferences
            </p>
          </div>

          {/* API Key management */}
          <ApiKeySection />

          {/* Quick Start / Usage */}
          <QuickStartSection />

          {/* Account profile */}
          <Separator />

          <motion.div
            {...fadeUp}
            transition={{ ...fadeUp.transition, delay: 0.2 }}
          >
            <UserProfile />
          </motion.div>
        </motion.div>
      </SignedIn>
    </div>
  )
}
