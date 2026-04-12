"use client"

import { useMemo, useState } from "react"
import { Plus, MessageSquare, Trash2, Search, MoreHorizontal } from "lucide-react"

import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { Conversation } from "@/lib/chat-store"

interface ChatSidebarProps {
  conversations: Conversation[]
  activeId: string | null
  onNew: () => void
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  onRename: (id: string, title: string) => void
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  const m = Math.floor(diff / 60_000)
  if (m < 1) return "just now"
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  return new Date(ts).toLocaleDateString()
}

export function ChatSidebar({
  conversations,
  activeId,
  onNew,
  onSelect,
  onDelete,
  onRename,
}: ChatSidebarProps) {
  const [query, setQuery] = useState("")
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState("")

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return conversations
    return conversations.filter((c) => c.title.toLowerCase().includes(q))
  }, [conversations, query])

  function commitRename(id: string) {
    if (renameValue.trim()) onRename(id, renameValue.trim())
    setRenamingId(null)
  }

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-border/60 bg-card/40 backdrop-blur-xl">
      {/* Header */}
      <div className="shrink-0 space-y-3 p-4">
        <Button
          onClick={onNew}
          className="w-full justify-start gap-2 bg-gradient-to-br from-primary to-primary/85 shadow-sm transition-all hover:shadow-md hover:shadow-primary/20"
          size="sm"
        >
          <Plus className="size-4" />
          New chat
        </Button>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/50" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats…"
            className="w-full rounded-lg border border-border/60 bg-card/60 py-1.5 pl-8 pr-2.5 text-xs text-foreground placeholder:text-muted-foreground/50 outline-none ring-1 ring-border/60 transition-all focus:border-border focus:ring-2 focus:ring-primary/30"
          />
        </div>
      </div>

      {/* Conversation list */}
      <ScrollArea className="flex-1">
        <div className="px-2 pb-4">
          {filtered.length === 0 ? (
            <div className="px-3 py-8 text-center text-xs text-muted-foreground/60">
              {query ? "No chats match." : "Start a new chat to begin."}
            </div>
          ) : (
            <ul className="space-y-0.5">
              {filtered.map((conv) => {
                const isActive = conv.id === activeId
                const isRenaming = renamingId === conv.id
                return (
                  <li key={conv.id}>
                    <div
                      className={`group relative flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs transition-all ${
                        isActive
                          ? "bg-primary/12 text-foreground ring-1 ring-primary/25"
                          : "text-muted-foreground hover:bg-card/80 hover:text-foreground"
                      }`}
                    >
                      <button
                        onClick={() => onSelect(conv.id)}
                        className="flex flex-1 items-center gap-2 overflow-hidden text-left"
                      >
                        <MessageSquare
                          className={`size-3.5 shrink-0 ${
                            isActive ? "text-primary" : "text-muted-foreground/60"
                          }`}
                        />
                        {isRenaming ? (
                          <input
                            autoFocus
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onBlur={() => commitRename(conv.id)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") commitRename(conv.id)
                              if (e.key === "Escape") setRenamingId(null)
                            }}
                            className="w-full bg-transparent text-xs outline-none"
                          />
                        ) : (
                          <span className="truncate font-medium">{conv.title}</span>
                        )}
                      </button>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          className={`flex size-6 shrink-0 items-center justify-center rounded outline-none transition-opacity ${
                            isActive
                              ? "opacity-100 hover:bg-primary/10"
                              : "opacity-0 hover:bg-card group-hover:opacity-100"
                          }`}
                        >
                          <MoreHorizontal className="size-3.5 text-muted-foreground" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-36">
                          <DropdownMenuItem
                            onClick={() => {
                              setRenamingId(conv.id)
                              setRenameValue(conv.title)
                            }}
                            className="text-xs"
                          >
                            Rename
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => onDelete(conv.id)}
                            className="text-xs text-red-400 focus:text-red-300"
                          >
                            <Trash2 className="mr-1.5 size-3" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    {!isRenaming && (
                      <div
                        className={`mt-0.5 px-3 text-[10px] tabular-nums ${
                          isActive ? "text-primary/70" : "text-muted-foreground/40"
                        }`}
                      >
                        {relativeTime(conv.updatedAt)}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </ScrollArea>

      {/* Footer count */}
      <div className="shrink-0 border-t border-border/40 px-4 py-2.5 text-[10px] uppercase tracking-wider text-muted-foreground/40">
        {conversations.length} {conversations.length === 1 ? "chat" : "chats"}
      </div>
    </aside>
  )
}
