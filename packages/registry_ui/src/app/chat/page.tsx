"use client"

import { useCallback } from "react"
import { useAuth, Show, SignInButton } from "@clerk/nextjs"
import {
  openAIMessageFormat,
  openAIReadableStreamAdapter,
} from "@openuidev/react-headless"
import { FullScreen } from "@openuidev/react-ui"
import { openuiLibrary } from "@openuidev/react-ui/genui-lib"
import "@openuidev/react-ui/defaults.css"
import "@openuidev/react-ui/components.css"

import { Button } from "@/components/ui/button"

export default function ChatPage() {
  return (
    <>
      <Show when="signed-out">
        <div className="flex flex-col items-center justify-center h-[calc(100vh-8rem)] gap-4">
          <p className="text-muted-foreground">Sign in to use the chat</p>
          <SignInButton>
            <Button>Sign In</Button>
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
  const { getToken } = useAuth()

  const processMessage = useCallback(
    async ({
      messages,
      abortController,
    }: {
      messages: Parameters<typeof openAIMessageFormat.toApi>[0]
      abortController: AbortController
    }) => {
      const token = await getToken()
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      }
      if (token) headers["Authorization"] = `Bearer ${token}`

      return fetch("/api/chat", {
        method: "POST",
        headers,
        body: JSON.stringify({
          messages: openAIMessageFormat.toApi(messages),
        }),
        signal: abortController.signal,
      })
    },
    [getToken],
  )

  return (
    <div className="h-[calc(100vh-4rem)] [&_.oui-chat-layout]:!bg-transparent [&_.oui-sidebar]:!bg-card/50 [&_.oui-sidebar]:!border-border/50">
      <FullScreen
        processMessage={processMessage}
        streamProtocol={openAIReadableStreamAdapter()}
        componentLibrary={openuiLibrary}
        agentName="Kiln"
      />
    </div>
  )
}
