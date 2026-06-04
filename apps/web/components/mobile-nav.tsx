"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Home, Star, Briefcase, Building2 } from "lucide-react"
import { cn } from "@/lib/utils"

const TABS = [
  { href: "/",          label: "Markets",   icon: Home },
  { href: "/stocks",    label: "Stocks",    icon: Building2 },
  { href: "/portfolio", label: "Portfolio", icon: Briefcase },
  { href: "/points",    label: "Points",    icon: Star },
]

export function MobileNav() {
  const pathname = usePathname()

  return (
    <nav className="fixed bottom-0 inset-x-0 z-50 sm:hidden border-t border-[oklch(0.18_0.014_255/0.32)] bg-[oklch(0.08_0.008_260)] pb-safe-bottom">
      <div className="flex items-stretch h-14">
        {TABS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href
          return (
            <Link
              key={label}
              href={href}
              title={label}
              className={cn(
                "group flex flex-1 items-center justify-center transition-all duration-300",
                active
                  ? "text-[oklch(0.78_0.16_82)]"
                  : "text-[oklch(0.48_0.01_260)] hover:text-[oklch(0.58_0.01_260)]",
              )}
            >
              {/* Icon with glow effect on active */}
              <div className="relative flex items-center justify-center">
                <Icon className={cn(
                  "h-5 w-5 transition-all duration-300",
                  active && "drop-shadow-[0_0_8px_oklch(0.78_0.16_82/0.4)]"
                )} />
                {/* Bottom underline indicator for active */}
                {active && (
                  <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-[oklch(0.78_0.16_82)] mt-2 transition-all duration-300" />
                )}
              </div>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
