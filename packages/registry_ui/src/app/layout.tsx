import type { Metadata } from "next"
import { ClerkProvider, Show, UserButton, SignInButton } from "@clerk/nextjs"
import { Geist, Geist_Mono } from "next/font/google"
import Link from "next/link"
import { Flame } from "lucide-react"

import { Button } from "@/components/ui/button"
import { NavLinks } from "@/app/_components/nav-links"
import "./globals.css"

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] })
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] })

export const metadata: Metadata = {
  title: "Kiln Registry",
  description: "Self-evolving tool registry for autonomous AI agents",
}

const nav = [
  { href: "/", label: "Registry", icon: "LayoutGrid" as const },
  { href: "/chat", label: "Chat", icon: "MessageSquare" as const },
  { href: "/publish", label: "Publish", icon: "Upload" as const },
  { href: "/settings", label: "Settings", icon: "Settings" as const },
]

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} dark h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-background text-foreground">
        <ClerkProvider>
          {/* ── Navbar ─────────────────────────────────────────────── */}
          <header className="sticky top-0 z-50 border-b border-white/[0.06] bg-background/60 backdrop-blur-xl">
            <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-6">
              {/* Logo */}
              <Link href="/" className="group flex items-center gap-2.5">
                <span className="relative flex h-8 w-8 items-center justify-center">
                  {/* Gradient glow behind the icon */}
                  <span className="absolute inset-0 rounded-lg bg-gradient-to-br from-orange-500/25 to-amber-500/10 blur-md transition-all group-hover:from-orange-500/35 group-hover:to-amber-500/20" />
                  <Flame className="relative h-5 w-5 text-orange-400 transition-colors group-hover:text-orange-300" />
                </span>
                <span className="text-[15px] font-semibold tracking-tight text-foreground/90">
                  Kiln
                </span>
              </Link>

              {/* Separator */}
              <div className="h-4 w-px bg-white/[0.08]" />

              {/* Nav links — client component for active state */}
              <NavLinks items={nav} />

              {/* Right side */}
              <div className="ml-auto flex items-center gap-3">
                <Show when="signed-out">
                  <SignInButton>
                    <Button
                      size="sm"
                      className="bg-white/[0.08] text-foreground/80 hover:bg-white/[0.14] hover:text-foreground border-white/[0.06]"
                    >
                      Sign in
                    </Button>
                  </SignInButton>
                </Show>
                <Show when="signed-in">
                  <div className="ring-1 ring-white/[0.08] rounded-full p-[2px] transition-all hover:ring-white/[0.16]">
                    <UserButton
                      appearance={{
                        elements: {
                          avatarBox: "h-7 w-7",
                        },
                      }}
                    />
                  </div>
                </Show>
              </div>
            </div>
          </header>

          {/* ── Content ────────────────────────────────────────────── */}
          <main className="flex-1">
            <div className="mx-auto max-w-7xl px-6 py-8">{children}</div>
          </main>

          {/* ── Footer ─────────────────────────────────────────────── */}
          <footer className="border-t border-white/[0.04] py-6">
            <div className="mx-auto flex max-w-7xl items-center justify-between px-6">
              <div className="flex items-center gap-2 text-xs text-muted-foreground/60">
                <Flame className="h-3.5 w-3.5 text-orange-500/40" />
                <span>Kiln</span>
              </div>
              <p className="text-xs text-muted-foreground/40">
                &copy; {new Date().getFullYear()} Kiln
              </p>
            </div>
          </footer>
        </ClerkProvider>
      </body>
    </html>
  )
}
