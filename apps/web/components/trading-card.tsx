"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { BookmarkPlus, Clock, TrendingUp, Droplets, Zap } from "lucide-react"
import { cn } from "@/lib/utils"
import type { PolymarketMarket } from "@/lib/polymarket"

function formatEndDate(dateStr: string): string {
  if (!dateStr) return "Open"
  try {
    const d = new Date(dateStr)
    const now = new Date()
    const diff = d.getTime() - now.getTime()
    const hours = Math.ceil(diff / (1000 * 60 * 60))
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24))
    if (diff < 0) return "Resolved"
    if (hours <= 24) return `${Math.max(1, hours)}h`
    if (days === 0) return "Today"
    if (days === 1) return "1d"
    if (days <= 30) return `${days}d`
    if (days <= 365) return `${Math.ceil(days / 7)}w`
    return `${Math.ceil(days / 365)}y`
  } catch {
    return "Open"
  }
}

function getBinaryPrices(outcomes: PolymarketMarket["outcomes"]) {
  const yes = outcomes?.find((o) => o.name.toLowerCase().includes("yes"))?.price ?? outcomes?.[0]?.price ?? 50
  return {
    yes: Math.max(0, Math.min(100, yes)),
    no: Math.max(0, Math.min(100, 100 - yes)),
  }
}

// Deterministic mini sparkline from index seed
function getSparkline(seed: number, yes: number): number[] {
  const points: number[] = []
  let v = yes
  for (let i = 0; i < 8; i++) {
    const noise = ((seed * (i + 1) * 7919) % 100) / 100 - 0.5
    v = Math.max(5, Math.min(95, v + noise * 8))
    points.push(v)
  }
  return points
}

function MiniSparkline({ points, positive }: { points: number[]; positive: boolean }) {
  const min = Math.min(...points)
  const max = Math.max(...points)
  const range = Math.max(max - min, 1)
  const w = 44
  const h = 18
  const xs = points.map((_, i) => (i / (points.length - 1)) * w)
  const ys = points.map((p) => h - ((p - min) / range) * h)
  const path = xs.map((x, i) => `${i === 0 ? "M" : "L"}${x},${ys[i]}`).join(" ")
  const color = positive ? "oklch(0.68_0.18_155)" : "oklch(0.60_0.18_25)"
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} fill="none" className="shrink-0">
      <path d={path} stroke={`${color}`} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={xs[xs.length - 1]} cy={ys[ys.length - 1]} r="2" fill={`${color}`} />
    </svg>
  )
}

interface TradingCardProps {
  market: PolymarketMarket
  index: number
}

export function TradingCard({ market, index }: TradingCardProps) {
  const router = useRouter()
  const [bookmarked, setBookmarked] = useState(false)
  const [imgError, setImgError] = useState(false)

  const animDelay = Math.min(index * 50, 500)
  const { yes, no } = getBinaryPrices(market.outcomes)
  const yesWidth = `${Math.max(4, Math.min(96, yes))}%`
  const feedBadges = market.feedBadges ?? []
  const sparkline = getSparkline(index + 1, yes)
  const trendUp = sparkline[sparkline.length - 1] >= sparkline[0]
  const endLabel = formatEndDate(market.endDate)
  const closingSoon = endLabel.endsWith("h") || endLabel === "Today" || endLabel === "1d"

  return (
    <article
      className="card-enter group surface-card surface-card-hover rounded-2xl overflow-hidden flex flex-col cursor-pointer border border-[oklch(0.22_0.015_255)] transition-all duration-200 hover:border-[oklch(0.28_0.018_255)] hover:shadow-[0_8px_32px_oklch(0_0_0/0.35)]"
      style={{ animationDelay: `${animDelay}ms`, animationFillMode: "both" }}
      onClick={() => router.push(`/markets/${market.id}`)}
    >
      <div className="p-4 flex flex-col flex-1 gap-3">

        {/* Zone 1: Image + Category + Title */}
        <div className="flex items-start gap-3">
          <div className="relative h-11 w-11 rounded-xl bg-[oklch(0.16_0.014_255)] overflow-hidden flex-shrink-0 border border-[oklch(0.24_0.016_255)]">
            {(market.image || market.icon) && !imgError ? (
              <img
                src={market.image ?? market.icon}
                alt=""
                className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-500"
                onError={() => setImgError(true)}
                onLoad={(e) => {
                  if ((e.target as HTMLImageElement).naturalWidth === 0) setImgError(true)
                }}
              />
            ) : (
              <div
                className="h-full w-full"
                style={{
                  background: `linear-gradient(135deg, oklch(0.18 0.018 ${index * 37 % 360} / 1) 0%, oklch(0.24 0.026 ${(index * 37 + 70) % 360} / 1) 100%)`,
                }}
              />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
              <span className="px-1.5 py-0.5 rounded bg-[oklch(0.18_0.014_255)] border border-[oklch(0.24_0.016_255)] text-[8px] font-bold text-muted-foreground uppercase tracking-widest truncate max-w-[90px]">
                {market.category ?? "Market"}
              </span>
              {market.featured && (
                <span className="inline-flex items-center gap-0.5 rounded border border-[oklch(0.78_0.16_82/0.22)] bg-[oklch(0.78_0.16_82/0.08)] px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest text-[oklch(0.82_0.16_82)]">
                  <Zap className="h-2 w-2" /> Hot
                </span>
              )}
              {closingSoon && (
                <span className="inline-flex items-center gap-0.5 rounded border border-[oklch(0.60_0.18_25/0.22)] bg-[oklch(0.60_0.18_25/0.07)] px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest text-[oklch(0.68_0.18_25)]">
                  <Clock className="h-2 w-2" /> {endLabel}
                </span>
              )}
            </div>
            <h3 className="text-[13px] font-semibold text-foreground leading-snug line-clamp-2 group-hover:text-[oklch(0.90_0.01_90)] transition-colors">
              {market.question}
            </h3>
          </div>

          <button
            aria-label="Bookmark"
            className="w-7 h-7 rounded-lg flex items-center justify-center text-[oklch(0.35_0.01_90)] hover:text-[oklch(0.78_0.16_82)] hover:bg-[oklch(0.18_0.014_255)] transition-colors shrink-0 opacity-0 group-hover:opacity-100"
            onClick={(e) => { e.stopPropagation(); setBookmarked(!bookmarked) }}
          >
            <BookmarkPlus className={cn("w-3.5 h-3.5", bookmarked && "text-[oklch(0.78_0.16_82)] fill-current opacity-100")} />
          </button>
        </div>

        {/* Feed badges */}
        {feedBadges.length > 0 && (
          <div className="flex min-h-5 flex-wrap gap-1.5">
            {feedBadges.map((badge) => (
              <span
                key={badge}
                className={cn(
                  "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest",
                  badge === "Closes today"
                    ? "border-[oklch(0.78_0.16_82/0.25)] bg-[oklch(0.78_0.16_82/0.10)] text-[oklch(0.82_0.16_82)]"
                    : badge === "Crypto"
                    ? "border-[oklch(0.56_0.18_250/0.25)] bg-[oklch(0.56_0.18_250/0.10)] text-[oklch(0.74_0.12_250)]"
                    : "border-[oklch(0.24_0.016_255)] bg-[oklch(0.16_0.014_255)] text-muted-foreground"
                )}
              >
                {badge}
              </span>
            ))}
          </div>
        )}

        {/* Zone 2: Probability bar + prices + sparkline */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <span className="text-[11px] font-bold text-[oklch(0.72_0.18_155)] tabular-nums w-10 shrink-0">
                {Math.round(yes)}%
              </span>
              <div className="flex-1 h-1.5 overflow-hidden rounded-full bg-[oklch(0.18_0.014_255)] relative">
                <div
                  className="h-full rounded-full prob-bar-fill transition-all duration-500"
                  style={{ width: yesWidth }}
                />
              </div>
              <span className="text-[11px] font-bold text-[oklch(0.62_0.18_25)] tabular-nums w-10 text-right shrink-0">
                {Math.round(no)}%
              </span>
            </div>
            <MiniSparkline points={sparkline} positive={trendUp} />
          </div>
          <div className="flex items-center justify-between px-0.5">
            <span className="text-[9px] text-muted-foreground uppercase tracking-widest font-semibold">Yes</span>
            <span className="text-[9px] text-muted-foreground uppercase tracking-widest font-semibold">No</span>
          </div>
        </div>

        {/* Zone 3: Stats row */}
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1 font-medium min-w-0" title="Volume">
            <TrendingUp className="w-3 h-3 shrink-0 text-[oklch(0.78_0.16_82/0.7)]" />
            <span className="font-mono truncate max-w-[68px]">{market.volume}</span>
          </span>
          <span className="text-[oklch(0.20_0.014_255)] shrink-0">·</span>
          <span className="flex items-center gap-1 font-medium min-w-0" title="Liquidity">
            <Droplets className="w-3 h-3 shrink-0 text-[oklch(0.68_0.18_155/0.7)]" />
            <span className="font-mono truncate max-w-[68px]">{market.liquidity}</span>
          </span>
          {!closingSoon && (
            <>
              <span className="text-[oklch(0.20_0.014_255)] shrink-0">·</span>
              <span className="flex items-center gap-1 font-medium shrink-0" title="Closes">
                <Clock className="w-3 h-3 text-[oklch(0.5_0.01_90)]" />
                <span className="font-mono">{endLabel}</span>
              </span>
            </>
          )}
        </div>

        {/* Zone 4: Buy buttons */}
        <div className="grid grid-cols-2 gap-2 mt-auto pt-0.5">
          <button
            onClick={(e) => {
              e.stopPropagation()
              router.push(`/markets/${market.id}`)
            }}
            className="h-10 rounded-xl btn-yes btn-press flex items-center justify-center gap-2 group/yes"
          >
            <span className="text-[10px] font-bold uppercase tracking-wider text-[oklch(0.72_0.18_155)]">Yes</span>
            <span className="text-sm font-bold text-foreground tabular-nums">{Math.round(yes)}¢</span>
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              router.push(`/markets/${market.id}`)
            }}
            className="h-10 rounded-xl btn-no btn-press flex items-center justify-center gap-2 group/no"
          >
            <span className="text-[10px] font-bold uppercase tracking-wider text-[oklch(0.62_0.18_25)]">No</span>
            <span className="text-sm font-bold text-foreground tabular-nums">{Math.round(no)}¢</span>
          </button>
        </div>
      </div>
    </article>
  )
}
