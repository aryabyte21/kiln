import { useState, useCallback } from "react"
import { SignedIn, SignedOut, SignIn, UserProfile, useUser } from "@clerk/clerk-react"
import { motion, AnimatePresence } from "framer-motion"
import {
  Key,
  Copy,
  Check,
  RefreshCw,
  Shield,
  Terminal,
  Settings2,
  Zap,
  ChevronRight } from "lucide-react"

import { useApiKey } from "@/hooks/use-api-key"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter } from "@/components/ui/dialog"

const fadeUp = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.3 } }

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
  // Tokenize code for simple syntax highlighting
  function highlightCode(source: string) {
    // Split into lines for rendering
    return source.split("\n").map((line, lineIdx) => {
      // Tokenize each line
      const tokens: { text: string; className: string }[] = []
      let remaining = line

      while (remaining.length > 0) {
        // Comments (# or //)
        const commentMatch = remaining.match(/^(#.*)/) || remaining.match(/^(\/\/.*)/)
        if (commentMatch) {
          tokens.push({ text: commentMatch[1], className: "text-emerald-600 dark:text-emerald-400" })
          remaining = remaining.slice(commentMatch[1].length)
          continue
        }

        // Strings (double-quoted)
        const stringMatch = remaining.match(/^("(?:[^"\\]|\\.)*")/)
        if (stringMatch) {
          tokens.push({ text: stringMatch[1], className: "text-amber-600 dark:text-amber-400" })
          remaining = remaining.slice(stringMatch[1].length)
          continue
        }

        // URLs
        const urlMatch = remaining.match(/^(https?:\/\/[^\s"']+)/)
        if (urlMatch) {
          tokens.push({ text: urlMatch[1], className: "text-sky-600 dark:text-sky-400 underline decoration-sky-600/30 dark:decoration-sky-400/30" })
          remaining = remaining.slice(urlMatch[1].length)
          continue
        }

        // Keywords / flags
        const flagMatch = remaining.match(/^(-H|--\w[\w-]*)/)
        if (flagMatch) {
          tokens.push({ text: flagMatch[1], className: "text-violet-600 dark:text-violet-400" })
          remaining = remaining.slice(flagMatch[1].length)
          continue
        }

        // JSON keys (word followed by colon)
        const keyMatch = remaining.match(/^("[\w-]+")\s*(:)/)
        if (keyMatch) {
          tokens.push({ text: keyMatch[1], className: "text-sky-600 dark:text-sky-400" })
          tokens.push({ text: keyMatch[2], className: "text-muted-foreground" })
          remaining = remaining.slice(keyMatch[0].length)
          continue
        }

        // Braces / brackets
        const braceMatch = remaining.match(/^([{}[\]])/)
        if (braceMatch) {
          tokens.push({ text: braceMatch[1], className: "text-muted-foreground/80" })
          remaining = remaining.slice(1)
          continue
        }

        // Command names (curl, etc.)
        const cmdMatch = remaining.match(/^(curl|wget|npm|npx|pnpm|yarn|node)\b/)
        if (cmdMatch) {
          tokens.push({ text: cmdMatch[1], className: "text-pink-600 dark:text-pink-400 font-semibold" })
          remaining = remaining.slice(cmdMatch[1].length)
          continue
        }

        // Default: consume one character
        tokens.push({ text: remaining[0], className: "text-foreground" })
        remaining = remaining.slice(1)
      }

      return (
        <span key={lineIdx}>
          {lineIdx > 0 && "\n"}
          {tokens.map((token, i) => (
            <span key={i} className={token.className}>
              {token.text}
            </span>
          ))}
        </span>
      )
    })
  }

  return (
    <div className="relative overflow-hidden rounded-xl ring-1 ring-foreground/[0.06] transition-all duration-200 hover:ring-foreground/[0.1]">
      {label && (
        <div className="flex items-center justify-between border-b border-border/50 bg-muted/30 px-4 py-2 dark:bg-muted/15">
          <div className="flex items-center gap-2">
            <div className="flex gap-1.5">
              <span className="size-2.5 rounded-full bg-foreground/10" />
              <span className="size-2.5 rounded-full bg-foreground/10" />
              <span className="size-2.5 rounded-full bg-foreground/10" />
            </div>
            <span className="text-xs font-medium text-muted-foreground">
              {label}
            </span>
          </div>
          <CopyButton text={code} />
        </div>
      )}
      <div className="flex items-start gap-2 bg-muted/15 p-4 dark:bg-muted/10">
        <pre className="flex-1 overflow-x-auto text-[13px] leading-relaxed">
          <code className="font-mono">{highlightCode(code)}</code>
        </pre>
        {!label && <CopyButton text={code} />}
      </div>
    </div>
  )
}

function SettingsHeader() {
  const { user } = useUser()

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary/5 via-primary/[0.02] to-transparent p-6 ring-1 ring-foreground/[0.06] dark:from-primary/10 dark:via-primary/5"
    >
      <div className="absolute -right-12 -top-12 size-40 rounded-full bg-primary/5 blur-3xl dark:bg-primary/10" />
      <div className="relative flex items-center gap-4">
        <Avatar className="size-14 ring-2 ring-background shadow-lg">
          <AvatarImage src={user?.imageUrl} alt={user?.fullName || "User"} />
          <AvatarFallback className="bg-primary/10 text-lg font-semibold text-primary">
            {user?.firstName?.[0] || user?.emailAddresses?.[0]?.emailAddress?.[0]?.toUpperCase() || "U"}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Settings2 className="size-6 text-primary/70" />
            Settings
          </h1>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">
            {user?.fullName
              ? `Welcome, ${user.fullName}`
              : "Manage your API key and account preferences"}
          </p>
        </div>
      </div>
    </motion.div>
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
      <Card className="border-0 shadow-sm ring-1 ring-foreground/[0.06] transition-shadow duration-300 hover:shadow-md">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-xl bg-amber-500/10 ring-1 ring-amber-500/20 dark:bg-amber-500/15">
              <Key className="size-4 text-amber-600 dark:text-amber-400" />
            </div>
            <div className="flex-1">
              <CardTitle>API Key</CardTitle>
              <CardDescription>
                Use this key to authenticate CLI and MCP client requests
              </CardDescription>
            </div>
            {hasKey && (
              <Badge variant="outline" className="gap-1.5 border-emerald-500/30 text-emerald-600 dark:border-emerald-500/20 dark:text-emerald-400">
                <span className="relative flex size-1.5">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
                </span>
                Active
              </Badge>
            )}
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Current key display */}
          {query.isLoading ? (
            <div className="h-10 animate-pulse rounded-xl bg-muted/50" />
          ) : hasKey ? (
            <div className="flex items-center gap-2 rounded-xl bg-muted/30 px-4 py-2.5 ring-1 ring-foreground/[0.06] dark:bg-muted/15">
              <code className="flex-1 font-mono text-sm tracking-wide text-muted-foreground">
                {maskedKey}
              </code>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmOpen(true)}
                disabled={regenerate.isPending}
                className="gap-1.5"
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
            <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-border/80 py-8 text-center">
              <div className="flex size-12 items-center justify-center rounded-2xl bg-muted ring-1 ring-foreground/[0.06]">
                <Key className="size-6 text-muted-foreground/60" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium">No API key generated</p>
                <p className="text-xs text-muted-foreground">
                  Generate a key to start using the registry API
                </p>
              </div>
              <Button
                onClick={handleCreate}
                disabled={create.isPending}
                size="sm"
                className="gap-1.5"
              >
                {create.isPending ? (
                  <RefreshCw className="size-3.5 animate-spin" />
                ) : (
                  <Zap className="size-3.5" />
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
                transition={{ duration: 0.3 }}
                className="overflow-hidden"
              >
                <div className="space-y-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-5 dark:border-emerald-500/15 dark:bg-emerald-500/[0.07]">
                  <div className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-400">
                    <div className="flex size-6 items-center justify-center rounded-full bg-emerald-500/15">
                      <Check className="size-3.5" />
                    </div>
                    API key generated successfully
                  </div>
                  <div className="flex items-center gap-2 rounded-lg bg-background px-4 py-2.5 ring-1 ring-foreground/[0.06]">
                    <code className="flex-1 break-all font-mono text-sm">
                      {newKey}
                    </code>
                    <CopyButton text={newKey} />
                  </div>
                  <div className="flex items-start gap-2.5 rounded-lg bg-amber-500/5 px-3 py-2.5 text-xs text-amber-700 ring-1 ring-amber-500/10 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-amber-500/15">
                    <Shield className="mt-0.5 size-3.5 shrink-0" />
                    <span>Store this key securely. You won't be able to see it again.</span>
                  </div>

                  <Separator className="bg-emerald-500/10" />

                  <div className="space-y-2">
                    <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <ChevronRight className="size-3" />
                      Usage example
                    </p>
                    <CodeBlock
                      code={`curl -H "X-API-Key: ${newKey}" https://your-registry.example.com/tools`}
                      label="Terminal"
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
              className="flex items-center gap-2 rounded-lg bg-destructive/5 px-3 py-2 text-sm text-destructive ring-1 ring-destructive/10"
            >
              <Shield className="size-3.5 shrink-0" />
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
      <Card className="border-0 shadow-sm ring-1 ring-foreground/[0.06] transition-shadow duration-300 hover:shadow-md">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-xl bg-violet-500/10 ring-1 ring-violet-500/20 dark:bg-violet-500/15">
              <Terminal className="size-4 text-violet-600 dark:text-violet-400" />
            </div>
            <div>
              <CardTitle>Quick Start</CardTitle>
              <CardDescription>
                Use your API key to authenticate requests
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-5">
          <div className="space-y-3">
            <h4 className="flex items-center gap-2 text-sm font-medium">
              <Badge variant="secondary" className="font-mono text-[10px]">
                HTTP
              </Badge>
              Header Authentication
            </h4>
            <CodeBlock code={httpExample} label="Terminal" />
          </div>

          <Separator className="bg-border/50" />

          <div className="space-y-3">
            <h4 className="flex items-center gap-2 text-sm font-medium">
              <Badge variant="secondary" className="font-mono text-[10px]">
                MCP
              </Badge>
              Client Configuration
            </h4>
            <CodeBlock code={mcpExample} label="mcp.json" />
            <p className="text-xs leading-relaxed text-muted-foreground">
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
          {/* Page header with avatar */}
          <SettingsHeader />

          {/* API Key management */}
          <ApiKeySection />

          {/* Quick Start / Usage */}
          <QuickStartSection />

          {/* Account profile */}
          <Separator className="bg-border/50" />

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
