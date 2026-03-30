"use client"

import { useRef, useEffect } from "react"
import { useChat } from "@ai-sdk/react"
import { Show, SignInButton } from "@clerk/nextjs"
import {
  Flame,
  Bot,
  Send,
  Loader2,
  Sparkles,
  Search,
  Code,
  Wrench,
  Zap,
  BookOpen,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Card } from "@/components/ui/card"

const EXAMPLE_QUERIES = [
  { icon: Search, text: "Find tools for web scraping" },
  { icon: Code, text: "How do I publish a new tool?" },
  { icon: Wrench, text: "What MCP tools are available?" },
  { icon: Zap, text: "Show me the most popular tools" },
  { icon: BookOpen, text: "Explain how the registry works" },
  { icon: Sparkles, text: "Suggest tools for data analysis" },
]

export default function ChatPage() {
  return (
    <>
      <Show when="signed-out">
        <div className="flex flex-col items-center justify-center h-[calc(100vh-8rem)] gap-4">
          <div className="flex size-16 items-center justify-center rounded-2xl bg-muted ring-1 ring-foreground/[0.06]">
            <Bot className="size-8 text-muted-foreground/60" />
          </div>
          <p className="text-lg font-medium">Sign in to use the chat</p>
          <p className="text-sm text-muted-foreground">
            Chat with Kiln to explore the registry
          </p>
          <SignInButton>
            <Button className="mt-2">Sign In</Button>
          </SignInButton>
        </div>
      </Show>
      <Show when="signed-in">
        <KilnChat />
      </Show>
    </>
  )
}

function KilnChat() {
  const { messages, input, handleInputChange, handleSubmit, isLoading, append } =
    useChat({ api: "/api/chat" })

  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleExampleClick = (text: string) => {
    append({ role: "user", content: text })
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      if (input.trim() && !isLoading) {
        handleSubmit(e as unknown as React.FormEvent)
      }
    }
  }

  const hasMessages = messages.length > 0

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] -mx-6 -my-8">
      {/* Messages area */}
      <div className="flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          <div ref={scrollRef} className="h-full overflow-y-auto">
            {!hasMessages ? (
              /* Welcome state */
              <div className="flex flex-col items-center justify-center h-full min-h-[60vh] px-6 py-12">
                <div className="relative mb-6">
                  <span className="absolute inset-0 rounded-2xl bg-gradient-to-br from-orange-500/25 to-amber-500/10 blur-xl" />
                  <div className="relative flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500/20 to-amber-500/10 ring-1 ring-orange-500/20">
                    <Flame className="size-8 text-orange-400" />
                  </div>
                </div>
                <h2 className="text-2xl font-bold tracking-tight mb-2">
                  Ask Kiln anything
                </h2>
                <p className="text-sm text-muted-foreground mb-8 max-w-md text-center">
                  Explore the registry, find tools, learn how to publish, or get help
                  with your setup.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-w-2xl w-full">
                  {EXAMPLE_QUERIES.map(({ icon: Icon, text }) => (
                    <button
                      key={text}
                      onClick={() => handleExampleClick(text)}
                      className="group flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-left text-sm text-muted-foreground transition-all hover:border-white/[0.12] hover:bg-white/[0.05] hover:text-foreground"
                    >
                      <Icon className="size-4 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-orange-400" />
                      <span>{text}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              /* Message list */
              <div className="mx-auto max-w-3xl space-y-6 px-6 py-6 pb-4">
                {messages.map((message) => (
                  <div key={message.id}>
                    {message.role === "user" ? (
                      <div className="flex justify-end">
                        <div className="max-w-[80%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm text-primary-foreground">
                          <p className="whitespace-pre-wrap">{message.content}</p>
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-3">
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted ring-1 ring-foreground/[0.06]">
                          <Bot className="size-4 text-muted-foreground" />
                        </div>
                        <Card className="max-w-[85%] border-white/[0.06] bg-card/60 px-4 py-3">
                          <p className="text-sm leading-relaxed whitespace-pre-wrap">
                            {message.content}
                          </p>
                        </Card>
                      </div>
                    )}
                  </div>
                ))}

                {/* Loading indicator */}
                {isLoading &&
                  messages.length > 0 &&
                  messages[messages.length - 1].role === "user" && (
                    <div className="flex gap-3">
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted ring-1 ring-foreground/[0.06]">
                        <Bot className="size-4 text-muted-foreground" />
                      </div>
                      <div className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
                        <Loader2 className="size-4 animate-spin" />
                        <span>Thinking...</span>
                      </div>
                    </div>
                  )}
              </div>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Input bar */}
      <div className="shrink-0 border-t border-white/[0.06] bg-background/60 backdrop-blur-xl px-6 py-4">
        <form
          onSubmit={handleSubmit}
          className="mx-auto flex max-w-3xl items-end gap-3"
        >
          <div className="relative flex-1">
            <textarea
              ref={inputRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={onKeyDown}
              placeholder="Ask Kiln something..."
              rows={1}
              className="field-sizing-content min-h-[44px] max-h-[200px] w-full resize-none rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-3 pr-12 text-sm text-foreground placeholder:text-muted-foreground/60 outline-none transition-colors focus:border-white/[0.16] focus:bg-white/[0.06]"
            />
          </div>
          <Button
            type="submit"
            size="icon"
            disabled={!input.trim() || isLoading}
            className="size-11 shrink-0 rounded-xl bg-primary hover:bg-primary/90 disabled:opacity-40"
          >
            {isLoading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
          </Button>
        </form>
      </div>
    </div>
  )
}
