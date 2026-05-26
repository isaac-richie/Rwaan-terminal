"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Home, Star, Briefcase } from "lucide-react"
import { cn } from "@/lib/utils"

const TABS = [
  { href: "/",          label: "Markets",   icon: Home },
  { href: "/portfolio", label: "Portfolio", icon: Briefcase },
  { href: "/points",    label: "Points",    icon: Star },
]

export function MobileNav() {
  const pathname = usePathname()

  return (
    <nav className="fixed bottom-0 inset-x-0 z-50 sm:hidden border-t border-[oklch(0.18_0.014_255)] bg-[oklch(0.09_0.011_260/0.97)] backdrop-blur-xl">
      <div className="flex items-stretch h-16">
        {TABS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href
          return (
            <Link
              key={label}
              href={href}
              className={cn(
                "flex flex-1 flex-col items-center justify-center gap-1 text-[10px] font-semibold uppercase tracking-wide transition-colors",
                active
                  ? "text-[oklch(0.78_0.16_82)]"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className={cn(
                "h-5 w-5 transition-colors",
                active ? "text-[oklch(0.78_0.16_82)]" : "text-muted-foreground",
              )} />
              {label}
            </Link>
          )
        })}
      </div>
      {/* Safe area spacer for iOS home bar */}
      <div className="h-safe-bottom bg-[oklch(0.09_0.011_260/0.97)]" />
    </nav>
  )
}
