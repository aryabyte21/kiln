import type { Metadata } from "next"
import { ClerkProvider, Show, UserButton, SignInButton } from "@clerk/nextjs"
import { Geist, Geist_Mono } from "next/font/google"
import Link from "next/link"
import { Flame, LayoutGrid, Upload, Settings } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import "./globals.css"

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] })
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] })

export const metadata: Metadata = {
  title: "Kiln Registry",
  description: "Self-evolving tool registry for autonomous AI agents",
}

const nav = [
  { href: "/", label: "Registry", icon: LayoutGrid },
  { href: "/publish", label: "Publish", icon: Upload },
  { href: "/settings", label: "Settings", icon: Settings },
] as const

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} dark h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-background text-foreground">
        <ClerkProvider>
          {/* Header */}
          <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
            <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4">
              <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
                <Flame className="h-5 w-5 text-orange-500" />
                <span className="text-lg">Kiln</span>
                <span className="hidden text-xs text-muted-foreground sm:inline">Registry</span>
              </Link>

              <Separator orientation="vertical" className="mx-1 h-6" />

              <nav className="flex items-center gap-1">
                {nav.map(({ href, label, icon: Icon }) => (
                  <Link key={href} href={href}>
                    <Button variant="ghost" size="sm" className="gap-1.5 text-sm">
                      <Icon className="h-4 w-4" />
                      <span className="hidden sm:inline">{label}</span>
                    </Button>
                  </Link>
                ))}
              </nav>

              <div className="ml-auto flex items-center gap-2">
                <Show when="signed-out">
                  <SignInButton>
                    <Button variant="outline" size="sm">Sign in</Button>
                  </SignInButton>
                </Show>
                <Show when="signed-in">
                  <UserButton />
                </Show>
              </div>
            </div>
          </header>

          {/* Content */}
          <main className="flex-1">
            <div className="mx-auto max-w-7xl px-4 py-6">
              {children}
            </div>
          </main>

          {/* Footer */}
          <footer className="border-t border-border/50 py-4 text-center text-xs text-muted-foreground">
            Kiln — Self-Evolving Tool Registry for Autonomous AI Agents
          </footer>
        </ClerkProvider>
      </body>
    </html>
  )
}
