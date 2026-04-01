"use client"

import { Show, SignInButton } from "@clerk/nextjs"
import { Bot } from "lucide-react"

import { Button } from "@/components/ui/button"
import { KilnExecute } from "@/components/kiln-execute"

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
            <p className="text-xl font-semibold tracking-tight">Sign in to use Kiln</p>
            <p className="text-sm text-muted-foreground">
              Describe a task in natural language. Kiln plans, synthesizes tools, and executes.
            </p>
          </div>
          <SignInButton mode="modal">
            <Button className="mt-1" size="lg">Sign in</Button>
          </SignInButton>
        </div>
      </Show>
      <Show when="signed-in">
        <KilnExecute />
      </Show>
    </>
  )
}
