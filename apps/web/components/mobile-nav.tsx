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
    <nav className="fixed bottom-0 inset-x-0 z-50 sm:hidden border-t border-[oklch(0.18_0.014_255/0.6)] bg-[oklch(0.09_0.011_260)] pb-safe-bottom shadow-[0_-12px_34px_oklch(0_0_0/0.42)]">
      <div className="flex items-stretch h-16">
        {TABS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href
          return (
            <Link
              key={label}
              href={href}
              className={cn(
                "flex flex-1 flex-col items-center justify-center gap-1 text-[10px] font-semibold uppercase tracking-wide transition-all duration-200",
                active
                  ? "text-[oklch(0.78_0.16_82)]"
                  : "text-[oklch(0.42_0.01_90)] hover:text-foreground",
              )}
            >
              <div className={cn(
                "relative flex items-center justify-center w-10 h-6 rounded-full transition-all duration-200",
                active ? "bg-[oklch(0.78_0.16_82/0.14)]" : ""
              )}>
                <Icon className={cn(
                  "h-[18px] w-[18px] transition-all duration-200",
                  active ? "text-[oklch(0.80_0.16_82)] scale-110" : "text-[oklch(0.42_0.01_90)]",
                )} />
              </div>
              {label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
