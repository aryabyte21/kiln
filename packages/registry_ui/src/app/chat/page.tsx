"use client"

import { useRef, useEffect, useState, useMemo } from "react"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"
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
  MessageSquare,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Card } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { KilnExecute } from "@/components/kiln-execute"

const EXAMPLE_QUERIES = [
  { icon: Search, text: "Find tools for web scraping" },
  { icon: Code, text: "How do I publish a new tool?" },
  { icon: Wrench, text: "What MCP tools are available?" },
  { icon: Zap, text: "Show me the most popular tools" },
  { icon: BookOpen, text: "Explain how the registry works" },
  { icon: Sparkles, text: "Suggest tools for data analysis" },
]

// ---------------------------------------------------------------------------
// Simple markdown renderer (handles bold, code, inline code, lists)
// ---------------------------------------------------------------------------

function MarkdownContent({ content }: { content: string }) {
  const rendered = useMemo(() => {
    const lines = content.split("\n")
    const elements: React.ReactNode[] = []
    let listItems: string[] = []
    let listType: "ul" | "ol" | null = null

    function flushList() {
      if (listItems.length > 0 && listType) {
        const Tag = listType
        elements.push(
          <Tag
            key={`list-${elements.length}`}
            className={`my-2 space-y-1 pl-4 ${listType === "ul" ? "list-disc" : "list-decimal"}`}
          >
            {listItems.map((item, i) => (
              <li key={i} className="text-sm leading-relaxed">
                <InlineMarkdown text={item} />
              </li>
            ))}
          </Tag>
        )
        listItems = []
        listType = null
      }
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]

      if (/^\s*[-*]\s+/.test(line)) {
        if (listType !== "ul") flushList()
        listType = "ul"
        listItems.push(line.replace(/^\s*[-*]\s+/, ""))
        continue
      }

      if (/^\s*\d+\.\s+/.test(line)) {
        if (listType !== "ol") flushList()
        listType = "ol"
        listItems.push(line.replace(/^\s*\d+\.\s+/, ""))
        continue
      }

      flushList()

      if (line.startsWith("```")) {
        const codeLines: string[] = []
        i++
        while (i < lines.length && !lines[i].startsWith("```")) {
          codeLines.push(lines[i])
          i++
        }
        elements.push(
          <pre
            key={`code-${elements.length}`}
            className="my-2 overflow-x-auto rounded-lg border border-white/[0.06] bg-white/[0.03] p-3 text-xs leading-relaxed"
          >
            <code>{codeLines.join("\n")}</code>
          </pre>
        )
        continue
      }

      if (line.startsWith("### ")) {
        elements.push(
          <p key={`h3-${elements.length}`} className="mt-3 mb-1 text-sm font-semibold">
            <InlineMarkdown text={line.slice(4)} />
          </p>
        )
        continue
      }
      if (line.startsWith("## ")) {
        elements.push(
          <p key={`h2-${elements.length}`} className="mt-3 mb-1 text-sm font-bold">
            <InlineMarkdown text={line.slice(3)} />
          </p>
        )
        continue
      }

      if (line.trim() === "") {
        elements.push(<div key={`br-${elements.length}`} className="h-2" />)
        continue
      }

      elements.push(
        <p key={`p-${elements.length}`} className="text-sm leading-relaxed">
          <InlineMarkdown text={line} />
        </p>
      )
    }

    flushList()
    return elements
  }, [content])

  return <div className="space-y-0.5">{rendered}</div>
}

function InlineMarkdown({ text }: { text: string }) {
  const parts: React.ReactNode[] = []
  const regex = /(\*\*(.+?)\*\*|`([^`]+)`|\*(.+?)\*)/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }

    if (match[2]) {
      parts.push(
        <strong key={match.index} className="font-semibold text-foreground">
          {match[2]}
        </strong>
      )
    } else if (match[3]) {
      parts.push(
        <code
          key={match.index}
          className="rounded bg-white/[0.06] px-1 py-0.5 font-mono text-[0.85em] text-orange-300/90"
        >
          {match[3]}
        </code>
      )
    } else if (match[4]) {
      parts.push(
        <em key={match.index} className="italic text-foreground/80">
          {match[4]}
        </em>
      )
    }

    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return <>{parts}</>
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ChatPage() {
  return (
    <>
      <Show when="signed-out">
        <div className="hero-surface flex min-h-[32rem] flex-col items-center justify-center gap-5 text-center">
          <div className="relative">
            <span className="absolute -inset-4 rounded-2xl bg-gradient-to-br from-primary/30 to-primary/10 blur-xl" />
            <div className="relative flex size-16 items-center justify-center rounded-2xl border border-primary/30 bg-primary/15">
              <Bot className="size-8 text-primary" />
            </div>
          </div>
          <div className="space-y-1.5">
            <p className="text-xl font-semibold tracking-tight">Sign in to use Kiln Chat</p>
            <p className="text-sm text-muted-foreground">
              Ask questions about tools, publishing, and integrations in one place.
            </p>
          </div>
          <SignInButton mode="modal">
            <Button className="mt-1" size="lg">Sign in</Button>
          </SignInButton>
        </div>
      </Show>
      <Show when="signed-in">
        <Tabs defaultValue="execute">
          <div className="flex justify-center pt-2 pb-1">
            <TabsList variant="line">
              <TabsTrigger value="execute">
                <Flame className="size-3.5" />
                Execute
              </TabsTrigger>
              <TabsTrigger value="chat">
                <MessageSquare className="size-3.5" />
                Chat
              </TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="execute">
            <KilnExecute />
          </TabsContent>
          <TabsContent value="chat">
            <KilnChat />
          </TabsContent>
        </Tabs>
      </Show>
    </>
  )
}

function KilnChat() {
  const [input, setInput] = useState("")
  const { messages, sendMessage, status } =
    useChat({
      transport: new DefaultChatTransport({ api: "/api/chat" }),
    })
  const isLoading = status === "streaming" || status === "submitted"

  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleExampleClick = (text: string) => {
    sendMessage({ text })
  }

  const handleSend = () => {
    if (!input.trim() || isLoading) return
    sendMessage({ text: input })
    setInput("")
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const hasMessages = messages.length > 0
  const getMessageText = (message: (typeof messages)[number]) => {
    return message.parts
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("")
  }

  return (
    <div className="section-surface flex h-[calc(100vh-14rem)] min-h-[34rem] flex-col overflow-hidden">
      <div className="flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          <div ref={scrollRef} className="h-full overflow-y-auto">
            {!hasMessages ? (
              <div className="flex flex-col items-center justify-center h-full min-h-[50vh] px-6 py-12">
                <div className="relative mb-8">
                  <span className="absolute -inset-4 animate-pulse rounded-3xl bg-gradient-to-br from-primary/30 to-primary/10 blur-2xl" />
                  <span className="absolute -inset-2 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 blur-xl" />
                  <div className="relative flex size-20 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 ring-1 ring-primary/30 shadow-lg shadow-primary/15">
                    <Flame className="size-10 text-primary" />
                  </div>
                </div>
                <h2 className="text-3xl font-bold tracking-tight mb-3">
                  Ask Kiln anything
                </h2>
                <p className="text-sm text-muted-foreground mb-10 max-w-md text-center leading-relaxed">
                  Explore the registry, find tools, learn how to publish, or get help
                  with your setup.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-w-2xl w-full">
                  {EXAMPLE_QUERIES.map(({ icon: Icon, text }) => (
                    <button
                      key={text}
                      onClick={() => handleExampleClick(text)}
                      className="group flex items-center gap-3 rounded-xl border border-border/70 bg-card/70 px-4 py-3.5 text-left text-sm text-muted-foreground ring-1 ring-border/70 transition-all duration-300 hover:-translate-y-0.5 hover:border-border hover:bg-card hover:text-foreground hover:shadow-lg hover:shadow-primary/8"
                    >
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/65 transition-all duration-300 group-hover:bg-primary/15">
                        <Icon className="size-4 text-muted-foreground/60 transition-colors duration-300 group-hover:text-primary" />
                      </div>
                      <span className="leading-snug">{text}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mx-auto max-w-3xl space-y-6 px-6 py-6 pb-4">
                {messages.map((message) => (
                  <div key={message.id}>
                    {message.role === "user" ? (
                      <div className="flex justify-end">
                        <div className="max-w-[80%] rounded-2xl rounded-br-md border border-primary/40 bg-gradient-to-br from-primary to-primary/85 px-4 py-2.5 text-sm text-primary-foreground shadow-sm">
                          <p className="whitespace-pre-wrap">{getMessageText(message)}</p>
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-3">
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary/20 to-primary/5 ring-1 ring-primary/25">
                          <Bot className="size-4 text-primary" />
                        </div>
                        <Card className="max-w-[85%] border-0 bg-card/80 px-4 py-3 ring-1 ring-border/70">
                          <MarkdownContent content={getMessageText(message)} />
                        </Card>
                      </div>
                    )}
                  </div>
                ))}

                {isLoading &&
                  messages.length > 0 &&
                  messages[messages.length - 1].role === "user" && (
                    <div className="flex gap-3">
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary/20 to-primary/5 ring-1 ring-primary/25">
                        <Bot className="size-4 text-primary" />
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

      <div className="shrink-0 border-t border-border/70 bg-background/85 px-6 py-4 backdrop-blur-xl">
        <form
          onSubmit={(e) => { e.preventDefault(); handleSend() }}
          className="mx-auto flex max-w-3xl items-end gap-3"
        >
          <div className="relative flex-1">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Ask Kiln something..."
              rows={1}
              className="field-sizing-content min-h-[44px] max-h-[200px] w-full resize-none rounded-xl border border-border/70 bg-card/75 px-4 py-3 pr-12 text-sm text-foreground shadow-inner shadow-black/15 ring-1 ring-border/70 placeholder:text-muted-foreground/60 outline-none transition-all duration-300 focus:border-border focus:bg-card focus:ring-2 focus:ring-primary/30 focus:shadow-lg focus:shadow-primary/8"
            />
          </div>
          <Button
            type="submit"
            size="icon"
            disabled={!input.trim() || isLoading}
            className="size-11 shrink-0 rounded-xl border border-primary/35 bg-gradient-to-br from-primary to-primary/80 shadow-sm transition-all duration-300 hover:shadow-md hover:shadow-primary/20 disabled:opacity-40"
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
