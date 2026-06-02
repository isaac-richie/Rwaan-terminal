"use client"

import { useState } from "react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { Clock, TrendingUp, Zap } from "lucide-react"
import { cn } from "@/lib/utils"
import { cacheMarketForDetail } from "@/lib/market-detail-cache"
import type { PolymarketMarket } from "@/lib/polymarket"

function formatEndDate(dateStr: string): string {
  if (!dateStr) return "Open"
  try {
    const d = new Date(dateStr)
    const diff = d.getTime() - Date.now()
    if (diff < 0) return "Ended"
    const hours = Math.ceil(diff / 3_600_000)
    const days  = Math.ceil(diff / 86_400_000)
    if (hours <= 24) return `${Math.max(1, hours)}h`
    if (days  === 1) return "1d"
    if (days  <= 30) return `${days}d`
    if (days  <= 365) return `${Math.ceil(days / 7)}w`
    return `${Math.ceil(days / 365)}y`
  } catch { return "Open" }
}

function getBinaryPrices(outcomes: PolymarketMarket["outcomes"]) {
  const yes = outcomes?.find((o) => o.name.toLowerCase().includes("yes"))?.price ?? outcomes?.[0]?.price ?? 50
  return {
    yes: Math.max(0, Math.min(100, yes)),
    no:  Math.max(0, Math.min(100, 100 - yes)),
  }
}

interface TradingCardProps {
  market: PolymarketMarket
  index: number
}

export function TradingCard({ market, index }: TradingCardProps) {
  const router = useRouter()
  const [imgError, setImgError] = useState(false)

  const animDelay = Math.min(index * 50, 500)
  const { yes, no } = getBinaryPrices(market.outcomes)
  const yesWidth = `${Math.max(4, Math.min(96, yes))}%`
  const endLabel = formatEndDate(market.endDate)
  const closingSoon = endLabel.endsWith("h") || endLabel === "Today" || endLabel === "1d"

  const imgSrc = (market.image ?? market.icon) as string | undefined

  const navigate = () => {
    cacheMarketForDetail(market)
    router.push(`/markets/${market.id}`)
  }

  return (
    <article
      className="card-enter group surface-card surface-card-hover rounded-2xl overflow-hidden flex flex-col cursor-pointer"
      style={{ animationDelay: `${animDelay}ms`, animationFillMode: "both" }}
      onClick={navigate}
    >
      <div className="p-3.5 sm:p-4 flex flex-col flex-1 gap-2.5 sm:gap-3">

        {/* ── Row 1: Icon + Question ── */}
        <div className="flex items-start gap-2.5 sm:gap-3">
          {/* Thumbnail */}
          <div className="relative h-10 w-10 sm:h-11 sm:w-11 rounded-xl bg-[oklch(0.16_0.014_255)] overflow-hidden flex-shrink-0 border border-[oklch(0.22_0.015_255/0.7)] group-hover:scale-[1.06] transition-transform duration-300 ease-out">
            {imgSrc && !imgError ? (
              <Image src={imgSrc} alt="" fill quality={90} sizes="44px"
                unoptimized
                className="object-contain p-1" onError={() => setImgError(true)} />
            ) : (
              <div className="h-full w-full flex items-center justify-center"
                style={{ background: `linear-gradient(135deg, oklch(0.38 0.12 ${(index * 47) % 360}) 0%, oklch(0.28 0.10 ${(index * 47 + 80) % 360}) 100%)` }}>
                <span className="text-[12px] sm:text-[13px] font-black text-white/70 select-none">
                  {(market.question ?? "?").charAt(0).toUpperCase()}
                </span>
              </div>
            )}
          </div>

          {/* Category badges + question */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 mb-1 flex-wrap">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide truncate max-w-[80px] sm:max-w-[96px] sm:px-1.5 sm:py-0.5 sm:rounded-md sm:bg-[oklch(0.18_0.014_255)] sm:border sm:border-[oklch(0.24_0.016_255/0.7)]">
                {market.category ?? "Market"}
              </span>
              {market.featured && (
                <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-[oklch(0.84_0.16_82)] sm:rounded-md sm:border sm:border-[oklch(0.78_0.16_82/0.28)] sm:bg-[oklch(0.78_0.16_82/0.10)] sm:px-1.5 sm:py-0.5 uppercase">
                  <Zap className="h-2.5 w-2.5" />Hot
                </span>
              )}
              {closingSoon && (
                <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-[oklch(0.68_0.18_25)] sm:rounded-md sm:border sm:border-[oklch(0.60_0.18_25/0.25)] sm:bg-[oklch(0.60_0.18_25/0.08)] sm:px-1.5 sm:py-0.5">
                  <Clock className="h-2.5 w-2.5" />{endLabel}
                </span>
              )}
            </div>
            <h3 className="text-[13px] sm:text-sm font-semibold text-foreground leading-snug line-clamp-2 group-hover:text-[oklch(0.95_0.01_90)] transition-colors duration-200">
              {market.question}
            </h3>
          </div>
        </div>

        {/* ── Row 2: Probability bar ── */}
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12px] font-bold text-[oklch(0.74_0.20_155)] tabular-nums">
              Yes {Math.round(yes)}¢
            </span>
            <span className="text-[12px] font-bold text-[oklch(0.65_0.20_25)] tabular-nums">
              No {Math.round(no)}¢
            </span>
          </div>
          <div className="h-1.5 sm:h-2 overflow-hidden rounded-full bg-[oklch(0.16_0.012_260)] relative">
            <div className="h-full rounded-full prob-bar-fill transition-all duration-500" style={{ width: yesWidth }} />
          </div>
        </div>

        {/* ── Row 3: Stats + Buy buttons ── */}
        <div className="flex items-center justify-between gap-2 mt-auto">
          {/* Stats */}
          <div className="flex items-center gap-2 text-[10px] sm:text-[11px] text-muted-foreground min-w-0">
            <span className="flex items-center gap-1 font-medium min-w-0">
              <TrendingUp className="w-3 h-3 shrink-0 text-[oklch(0.78_0.16_82/0.75)]" />
              <span className="font-mono truncate max-w-[56px] sm:max-w-[72px]">{market.volume}</span>
            </span>
            {!closingSoon && (
              <>
                <span className="text-[oklch(0.24_0.014_255)] shrink-0">·</span>
                <span className="flex items-center gap-1 font-medium shrink-0">
                  <Clock className="w-3 h-3 text-[oklch(0.48_0.01_90)]" />
                  <span className="font-mono">{endLabel}</span>
                </span>
              </>
            )}
          </div>

          {/* Buy buttons */}
          <div className="flex gap-1.5 shrink-0">
            <button onClick={(e) => { e.stopPropagation(); navigate() }}
              className="h-8 sm:h-9 px-3 sm:px-4 rounded-xl btn-yes btn-press flex items-center justify-center gap-1">
              <span className="text-[11px] font-bold text-[oklch(0.80_0.20_155)]">Yes</span>
              <span className="text-[11px] sm:text-[12px] font-bold text-[oklch(0.92_0.12_155)] tabular-nums">{Math.round(yes)}¢</span>
            </button>
            <button onClick={(e) => { e.stopPropagation(); navigate() }}
              className="h-8 sm:h-9 px-3 sm:px-4 rounded-xl btn-no btn-press flex items-center justify-center gap-1">
              <span className="text-[11px] font-bold text-[oklch(0.72_0.20_25)]">No</span>
              <span className="text-[11px] sm:text-[12px] font-bold text-[oklch(0.90_0.12_25)] tabular-nums">{Math.round(no)}¢</span>
            </button>
          </div>
        </div>
      </div>
    </article>
  )
}
