import { SignedIn, UserButton } from "@clerk/clerk-react"
import {
  Flame,
  LayoutGrid,
  Moon,
  Settings,
  Sun,
} from "lucide-react"
import { useEffect, useState } from "react"
import { Link, Route, Routes, useLocation } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import CatalogPage from "@/pages/catalog"
import SettingsPage from "@/pages/settings"
import ToolDetailPage from "@/pages/tool-detail"

export function App() {
  const [dark, setDark] = useState(true)
  const location = useLocation()

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark)
  }, [dark])

  const nav = [
    { to: "/", label: "Registry", icon: LayoutGrid },
    { to: "/settings", label: "Settings", icon: Settings },
  ] as const

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
        {/* ── Header ── */}
        <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
          <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4">
            {/* Brand */}
            <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
              <Flame className="h-5 w-5 text-orange-500" />
              <span className="text-lg">Kiln</span>
              <span className="hidden text-xs text-muted-foreground sm:inline">Registry</span>
            </Link>

            <Separator orientation="vertical" className="mx-1 h-6" />

            {/* Nav */}
            <nav className="flex items-center gap-1">
              {nav.map(({ to, label, icon: Icon }) => (
                <Link key={to} to={to}>
                  <Button
                    variant={location.pathname === to ? "secondary" : "ghost"}
                    size="sm"
                    className="gap-1.5 text-sm"
                  >
                    <Icon className="h-4 w-4" />
                    <span className="hidden sm:inline">{label}</span>
                  </Button>
                </Link>
              ))}
            </nav>

            {/* Right side */}
            <div className="ml-auto flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setDark((d) => !d)}
              >
                {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>
              <SignedIn>
                <UserButton afterSignOutUrl="/" />
              </SignedIn>
            </div>
          </div>
        </header>

        {/* ── Content ── */}
        <main className="flex-1">
          <div className="mx-auto max-w-7xl px-4 py-6">
            <Routes>
              <Route path="/" element={<CatalogPage />} />
              <Route path="/tools/:toolId" element={<ToolDetailPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Routes>
          </div>
        </main>

        {/* ── Footer ── */}
        <footer className="border-t border-border/50 py-4 text-center text-xs text-muted-foreground">
          Kiln — Self-Evolving Tool Registry for Autonomous AI Agents
        </footer>
      </div>
  )
}
