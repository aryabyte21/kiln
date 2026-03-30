import { SignedIn, UserButton } from "@clerk/clerk-react"
import {
  Flame,
  LayoutGrid,
  Moon,
  Settings,
  Sun } from "lucide-react"
import { useEffect, useState } from "react"
import { Link, Route, Routes, useLocation } from "react-router-dom"
import { motion } from "framer-motion"

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

  const isActive = (to: string) =>
    to === "/" ? location.pathname === "/" : location.pathname.startsWith(to)

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {/* ── Header ── */}
      <header className="sticky top-0 z-50 border-b border-border/40 bg-background/70 backdrop-blur-xl backdrop-saturate-150 supports-[backdrop-filter]:bg-background/60">
        <div className="absolute inset-x-0 -bottom-px h-px bg-gradient-to-r from-transparent via-primary/15 to-transparent" />
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4">
          {/* Brand */}
          <Link to="/" className="group flex items-center gap-2.5 font-semibold tracking-tight">
            <motion.div
              whileHover={{ rotate: 12, scale: 1.1 }}
              whileTap={{ scale: 0.95 }}
              transition={{ type: "spring", stiffness: 400, damping: 15 }}
              className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-orange-500 to-amber-500 shadow-sm shadow-orange-500/20"
            >
              <Flame className="size-4.5 text-white" />
            </motion.div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-lg font-bold">Kiln</span>
              <span className="hidden text-xs font-medium text-muted-foreground transition-colors group-hover:text-foreground/70 sm:inline">
                Registry
              </span>
            </div>
          </Link>

          <Separator orientation="vertical" className="mx-1 h-6 bg-border/50" />

          {/* Nav */}
          <nav className="flex items-center gap-0.5">
            {nav.map(({ to, label, icon: Icon }) => {
              const active = isActive(to)
              return (
                <Link key={to} to={to}>
                  <motion.div
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.97 }}
                    transition={{ duration: 0.15 }}
                  >
                    <Button
                      variant={active ? "secondary" : "ghost"}
                      size="sm"
                      className={`relative gap-1.5 text-sm transition-all duration-200 ${
                        active
                          ? "bg-secondary/80 font-medium shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <Icon className="size-4" />
                      <span className="hidden sm:inline">{label}</span>
                      {active && (
                        <motion.div
                          layoutId="nav-indicator"
                          className="absolute -bottom-[calc(0.5rem+1px)] left-1/2 h-0.5 w-6 -translate-x-1/2 rounded-full bg-primary"
                          transition={{
                            type: "spring",
                            stiffness: 500,
                            damping: 30 }}
                        />
                      )}
                    </Button>
                  </motion.div>
                </Link>
              )
            })}
          </nav>

          {/* Right side */}
          <div className="ml-auto flex items-center gap-1.5">
            <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => setDark((d) => !d)}
              >
                <motion.div
                  key={dark ? "sun" : "moon"}
                  initial={{ rotate: -90, opacity: 0 }}
                  animate={{ rotate: 0, opacity: 1 }}
                  exit={{ rotate: 90, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
                </motion.div>
              </Button>
            </motion.div>
            <SignedIn>
              <div className="ml-1">
                <UserButton afterSignOutUrl="/" />
              </div>
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
      <footer className="relative border-t border-border/40">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/10 to-transparent" />
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-2 px-4 py-5 sm:flex-row">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <div className="flex size-5 items-center justify-center rounded bg-gradient-to-br from-orange-500 to-amber-500">
              <Flame className="size-3 text-white" />
            </div>
            <span>Kiln — Self-Evolving Tool Registry for Autonomous AI Agents</span>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground/60">
            <span>v0.1.0</span>
            <span className="size-0.5 rounded-full bg-muted-foreground/30" />
            <span>&copy; {new Date().getFullYear()} Kiln</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
