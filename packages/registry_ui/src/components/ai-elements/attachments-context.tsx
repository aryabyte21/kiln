"use client"

import { createContext, useContext, useMemo } from "react"

export interface Attachment {
  id: string
  kind: "image"
  mime: string
  data_url: string
  bytes?: number
  node_id?: string
  tool?: string
  meta?: Record<string, string | number | boolean>
}

const AttachmentsContext = createContext<Record<string, Attachment>>({})

export function AttachmentsProvider({
  value,
  children,
}: {
  value: Record<string, Attachment>
  children: React.ReactNode
}) {
  const stable = useMemo(() => value, [value])
  return <AttachmentsContext.Provider value={stable}>{children}</AttachmentsContext.Provider>
}

export function useAttachment(id: string | undefined): Attachment | undefined {
  const map = useContext(AttachmentsContext)
  if (!id) return undefined
  return map[id]
}

/** Convert any backend marker shape into a single canonical markdown image.
 *
 * Shapes the LLM produces (we've seen all of these in the wild):
 *   <<image:att_abc>>             — the original token (best case)
 *   kiln-att://att_abc            — bare URL form
 *   ![alt](kiln-att://att_abc)    — wrapped in markdown image syntax
 *   ![[Kiln-att://att_abc]](att_abc) — doubly-wrapped with capitalisation
 *   [text](att_abc)               — markdown link with bare id, no scheme
 *   `att_abc`                     — plain id mention
 *
 * All collapse to `![](kiln-att://att_abc)` for our `img` renderer.
 *
 * Implementation: we tokenise *first* (replacing every match with a sentinel
 * so subsequent rules can't re-match the inserted text), then expand the
 * sentinel once at the end. This avoids the cascading-replacement bug where
 * each rule chews its own previous output.
 */
/* Sentinel format: \u0001 START + id + \u0001 END. Two distinct control
 * characters so the boundary regex is unambiguous. We also strip any
 * tightly-wrapped junk (backticks, markdown link shells) before expanding. */
const S = "\u0001"

export function rewriteAttachmentMarkers(text: string): string {
  let out = text

  const tag = (id: string) => `${S}${id.toLowerCase()}${S}`

  // 1. Markdown image / link forms whose URL contains `att_xxx`
  out = out.replace(
    /!?\[[^\]\n]*\]\(\s*(?:kiln-att:\/\/)?(att_[a-zA-Z0-9_]+)\s*\)/gi,
    (_m, id: string) => tag(id),
  )

  // 2. The original `<<image:att_xxx>>` token
  out = out.replace(/<<image:(att_[a-zA-Z0-9_]+)>>/gi, (_m, id: string) => tag(id))

  // 3. Bare `kiln-att://att_xxx` URLs left over
  out = out.replace(/kiln-att:\/\/(att_[a-zA-Z0-9_]+)/gi, (_m, id: string) => tag(id))

  // 4. Bare `att_xxx` id mentioned in prose — but skip ids already wrapped
  // in our sentinel (or we'd double-tag).
  out = out.replace(
    new RegExp(`(?<!${S})\\b(att_[a-zA-Z0-9_]{6,})\\b(?!${S})`, "g"),
    (_m, id: string) => tag(id),
  )

  // 5. Strip wrapping junk around a sentinel (backticks, markdown link/image shells)
  // We loop until no more shells remain.
  const sentinelInside = `[\\s\\S]*?${S}att_[a-zA-Z0-9_]+${S}[\\s\\S]*?`
  for (let i = 0; i < 4; i++) {
    const before = out
    // Markdown image/link wrappers — non-greedy alt so nested brackets match.
    out = out.replace(
      new RegExp(`!?\\[[\\s\\S]*?\\]\\(\\s*(${sentinelInside})\\s*\\)`, "g"),
      "$1",
    )
    // Backtick wrappers
    out = out.replace(new RegExp("`+\\s*(" + sentinelInside + ")\\s*`+", "g"), "$1")
    // Empty markdown link shells like `[]()` adjacent to the sentinel — pure noise
    out = out.replace(/\[\s*\]\(\s*\)/g, "")
    if (out === before) break
  }

  // 6. Expand sentinels into canonical markdown images
  out = out.replace(new RegExp(`${S}(att_[a-zA-Z0-9_]+)${S}`, "g"), (_m, id: string) =>
    `![](kiln-att://${id})`,
  )

  // 7. Collapse duplicate consecutive image refs for the same id
  out = out.replace(
    /(!\[\]\(kiln-att:\/\/(att_[a-zA-Z0-9_]+)\))(?:\s*\1)+/g,
    "$1",
  )

  return out
}
