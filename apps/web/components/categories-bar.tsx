"use client"

import { useEffect, useMemo, useState } from "react"
import {
  Globe,
  Coins,
  Flame,
  Trophy,
  Medal,
  ArrowDownUp,
  ChevronDown,
  MapPin,
  TrendingUp,
  Sparkles,
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
  { id: "WorldCup", label: "World Cup ⚽", icon: Medal },
  { id: "Crypto", label: "Crypto", icon: Coins },
  { id: "Africa", label: "Africa 🌍", icon: MapPin },
  { id: "Sports", label: "Sport", icon: Trophy },
  { id: "Entertainment", label: "Entertainment", icon: Sparkles },
  { id: "World", label: "World", icon: Globe },
  { id: "Macro", label: "Macro", icon: TrendingUp },
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
    <div className="sticky top-[70px] z-40 bg-[oklch(0.105_0.012_260/0.94)] backdrop-blur-2xl border-b border-[oklch(0.20_0.014_255/0.7)]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3 py-2">
          {/* Category chips — Apple-style pill segmented control */}
          <div className="flex items-center gap-1 flex-1 min-w-0 overflow-x-auto no-scrollbar [mask-image:linear-gradient(to_right,black_88%,transparent)] sm:[mask-image:none]">
            {categories.map((cat) => {
              const isActive = selected === cat.id
              const Icon = cat.icon
              return (
                <button
                  key={cat.id}
                  onClick={() => onSelect(cat.id)}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all duration-200",
                    isActive
                      ? "bg-[oklch(0.78_0.16_82)] text-[oklch(0.10_0.012_260)] shadow-[0_2px_12px_oklch(0.78_0.16_82/0.35)]"
                      : "bg-transparent text-[oklch(0.52_0.01_90)] hover:text-[oklch(0.78_0.01_90)] hover:bg-[oklch(0.18_0.014_255/0.7)]"
                  )}
                >
                  <Icon className={cn("w-3 h-3 shrink-0", isActive ? "text-[oklch(0.12_0.012_260)]" : "text-[oklch(0.42_0.01_90)]")} />
                  {cat.label}
                  {typeof cat.count === "number" && isActive && (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-[oklch(0.12_0.012_260/0.25)] text-[oklch(0.12_0.012_260/0.75)]">
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
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all duration-200 border",
                sortOpen
                  ? "border-[oklch(0.78_0.16_82/0.4)] bg-[oklch(0.18_0.014_255)] text-foreground"
                  : "border-[oklch(0.22_0.015_255/0.7)] bg-[oklch(0.14_0.013_255/0.8)] text-muted-foreground hover:border-[oklch(0.30_0.018_255)] hover:text-foreground"
              )}
            >
              <ArrowDownUp className="w-3 h-3" />
              <span className="hidden sm:inline">{currentSort.label}</span>
              <ChevronDown className={cn("w-3 h-3 transition-transform duration-200", sortOpen && "rotate-180")} />
            </button>
            {sortOpen && (
              <div className="absolute right-0 top-full mt-2 w-44 rounded-2xl bg-[oklch(0.155_0.014_255/0.98)] border border-[oklch(0.24_0.016_255/0.7)] shadow-[0_16px_48px_oklch(0_0_0/0.55)] backdrop-blur-xl overflow-hidden z-50">
                <div className="p-1">
                  {sortOptions.map((opt) => (
                    <button
                      key={opt.id}
                      onClick={() => { onSortChange(opt.id); setSortOpen(false) }}
                      className={cn(
                        "w-full text-left px-3 py-2 text-[12px] font-medium rounded-xl transition-colors",
                        sortBy === opt.id
                          ? "text-[oklch(0.84_0.16_82)] bg-[oklch(0.78_0.16_82/0.10)]"
                          : "text-muted-foreground hover:text-foreground hover:bg-[oklch(0.20_0.014_255)]"
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
