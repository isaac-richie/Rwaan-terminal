"use client"

import { useEffect, useMemo, useState } from "react"
import {
  Globe,
  Coins,
  Flame,
  Trophy,
  Sparkles,
  Newspaper,
  ArrowDownUp,
  ChevronDown,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000"

type CategoryItem = {
  id: string
  label: string
  icon: LucideIcon
  count?: number
}

const polymarketCategories: CategoryItem[] = [
  { id: "all", label: "All", icon: Flame },
  { id: "Entertainment", label: "Entertainment", icon: Sparkles },
  { id: "Sports", label: "Sport", icon: Trophy },
  { id: "News", label: "News", icon: Newspaper },
  { id: "Crypto", label: "Crypto", icon: Coins },
  { id: "Geopolitics", label: "Geopolitics", icon: Globe },
]

const sortOptions = [
  { id: "trending", label: "Smart Feed" },
  { id: "daily", label: "Quick Settles" },
  { id: "volume", label: "Volume" },
  { id: "newest", label: "Newest" },
  { id: "ending", label: "Ending Soon" },
]

interface CategoriesBarProps {
  selected: string
  onSelect: (id: string) => void
  sortBy: string
  onSortChange: (id: string) => void
}

type GammaTag = {
  id?: string | number
  slug?: string
  label?: string
  name?: string
  count?: number
}

export function CategoriesBar({
  selected,
  onSelect,
  sortBy,
  onSortChange,
}: CategoriesBarProps) {
  const [tags, setTags] = useState<GammaTag[]>([])
  const [sortOpen, setSortOpen] = useState(false)

  useEffect(() => {
    const loadTags = async () => {
      try {
        const res = await fetch(`${API_BASE}/gamma/tags`)
        if (!res.ok) return
        const data = await res.json()
        if (Array.isArray(data)) setTags(data)
      } catch {
        // ignore
      }
    }
    loadTags()
  }, [])

  // Close sort dropdown on outside click
  useEffect(() => {
    if (!sortOpen) return
    const handle = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("[data-sort-menu]")) setSortOpen(false)
    }
    window.addEventListener("mousedown", handle)
    return () => window.removeEventListener("mousedown", handle)
  }, [sortOpen])

  const categories = useMemo(() => {
    if (!tags.length) return polymarketCategories
    const byLabel = new Map(
      tags.map((tag) => [
        (tag.label ?? tag.name ?? "").toLowerCase(),
        tag.count,
      ])
    )
    return polymarketCategories.map((cat) => ({
      ...cat,
      count: byLabel.get(cat.label.toLowerCase()),
    }))
  }, [tags])

  const currentSort = sortOptions.find((s) => s.id === sortBy) ?? sortOptions[0]

  return (
    <div className="sticky top-[70px] z-40 bg-[oklch(0.11_0.012_260/0.92)] backdrop-blur-xl border-b border-[oklch(0.22_0.015_255)]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3 py-2.5">
          {/* Category chips — fade mask hints at scrollable overflow */}
          <div className="flex items-center gap-1.5 flex-1 min-w-0 overflow-x-auto no-scrollbar [mask-image:linear-gradient(to_right,black_85%,transparent)] sm:[mask-image:none]">
            {categories.map((cat) => {
              const isActive = selected === cat.id
              const Icon = cat.icon
              return (
                <button
                  key={cat.id}
                  onClick={() => onSelect(cat.id)}
                  className={cn(
                    "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold whitespace-nowrap transition-all duration-200 border",
                    isActive
                      ? "bg-[oklch(0.22_0.04_82)] border-[oklch(0.78_0.16_82/0.5)] text-[oklch(0.78_0.16_82)] shadow-[0_0_10px_oklch(0.78_0.16_82/0.12)]"
                      : "bg-transparent border-transparent text-[oklch(0.50_0.01_90)] hover:text-[oklch(0.75_0.01_90)] hover:bg-[oklch(0.16_0.014_255)]"
                  )}
                >
                  <Icon className={cn("w-3 h-3", isActive ? "text-[oklch(0.78_0.16_82)]" : "text-[oklch(0.40_0.01_90)]")} />
                  {cat.label}
                  {typeof cat.count === "number" && isActive && (
                    <span className="text-[9px] font-mono px-1 py-0.5 rounded bg-[oklch(0.78_0.16_82/0.15)] text-[oklch(0.78_0.16_82)]">
                      {cat.count.toLocaleString()}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {/* Sort dropdown */}
          <div className="relative shrink-0" data-sort-menu>
            <button
              onClick={() => setSortOpen((v) => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold text-muted-foreground border border-[oklch(0.22_0.015_255)] bg-[oklch(0.15_0.013_255)] hover:border-[oklch(0.28_0.018_255)] transition-colors"
            >
              <ArrowDownUp className="w-3 h-3" />
              <span className="hidden sm:inline">{currentSort.label}</span>
              <ChevronDown className="w-3 h-3" />
            </button>
            {sortOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-40 rounded-xl bg-[oklch(0.16_0.014_255)] border border-[oklch(0.22_0.015_255)] shadow-2xl overflow-hidden z-50">
                {sortOptions.map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => { onSortChange(opt.id); setSortOpen(false) }}
                    className={cn(
                      "w-full text-left px-3 py-2 text-xs font-medium transition-colors",
                      sortBy === opt.id
                        ? "text-[oklch(0.78_0.16_82)] bg-[oklch(0.78_0.16_82/0.08)]"
                        : "text-muted-foreground hover:text-foreground hover:bg-[oklch(0.2_0.014_255)]"
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
