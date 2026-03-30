"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { LayoutGrid, MessageSquare, Upload, Settings } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

const iconMap: Record<string, LucideIcon> = {
  LayoutGrid,
  MessageSquare,
  Upload,
  Settings,
}

interface NavItem {
  href: string
  label: string
  icon: string
}

export function NavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname()

  return (
    <nav className="flex items-center gap-1">
      {items.map(({ href, label, icon }) => {
        const isActive = href === "/" ? pathname === "/" : pathname.startsWith(href)
        const Icon = iconMap[icon]

        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-all",
              isActive
                ? "bg-white/[0.08] text-foreground shadow-sm shadow-black/10"
                : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground/80"
            )}
          >
            {Icon && <Icon className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">{label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
