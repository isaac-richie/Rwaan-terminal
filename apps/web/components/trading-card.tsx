"use client"

import { useState } from "react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { Clock, Coins, Droplets, Flame, TrendingUp, Zap } from "lucide-react"
import { cn } from "@/lib/utils"
import type { PolymarketMarket } from "@/lib/polymarket"

function formatEndDate(dateStr: string): string {
  if (!dateStr) return "Open"
  try {
    const d = new Date(dateStr)
    const diff = d.getTime() - Date.now()
    if (diff < 0) return "Resolved"
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

// ─── Desktop-only sparkline ──────────────────────────────────────────────────
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
  const min = Math.min(...points), max = Math.max(...points)
  const range = Math.max(max - min, 1)
  const w = 44, h = 18
  const xs = points.map((_, i) => (i / (points.length - 1)) * w)
  const ys = points.map((p) => h - ((p - min) / range) * h)
  const path = xs.map((x, i) => `${i === 0 ? "M" : "L"}${x},${ys[i]}`).join(" ")
  const color = positive ? "oklch(0.68_0.18_155)" : "oklch(0.60_0.18_25)"
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} fill="none" className="shrink-0">
      <path d={path} stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={xs[xs.length - 1]} cy={ys[ys.length - 1]} r="2" fill={color} />
    </svg>
  )
}

// ─── Feed badge chip ─────────────────────────────────────────────────────────
const BADGE_STYLES: Record<string, { border: string; bg: string; text: string; icon: React.ElementType }> = {
  "24h Crypto":     { border: "oklch(0.78 0.16 82 / 0.4)",  bg: "oklch(0.78 0.16 82 / 0.12)",  text: "oklch(0.90 0.18 82)",   icon: Coins },
  "Crypto":         { border: "oklch(0.62 0.18 230 / 0.35)", bg: "oklch(0.62 0.18 230 / 0.10)", text: "oklch(0.76 0.16 230)",  icon: Coins },
  "Closes today":   { border: "oklch(0.60 0.18 45 / 0.35)",  bg: "oklch(0.60 0.18 45 / 0.10)",  text: "oklch(0.75 0.18 45)",   icon: Clock },
  "Deep liquidity": { border: "oklch(0.60 0.18 155 / 0.35)", bg: "oklch(0.60 0.18 155 / 0.10)", text: "oklch(0.74 0.18 155)",  icon: Droplets },
  "Hot volume":     { border: "oklch(0.70 0.18 25 / 0.35)",  bg: "oklch(0.70 0.18 25 / 0.10)",  text: "oklch(0.80 0.18 25)",   icon: Flame },
  "Tradable":       { border: "oklch(0.45 0.01 260 / 0.35)", bg: "oklch(0.45 0.01 260 / 0.08)", text: "oklch(0.62 0.01 260)",  icon: TrendingUp },
}

function FeedBadge({ label }: { label: string }) {
  const style = BADGE_STYLES[label]
  if (!style) return null
  const Icon = style.icon
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide border shrink-0"
      style={{ borderColor: style.border, background: style.bg, color: style.text }}
    >
      <Icon className="h-2.5 w-2.5 shrink-0" />
      {label}
    </span>
  )
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
  const sparkline = getSparkline(index + 1, yes)
  const trendUp = sparkline[sparkline.length - 1] >= sparkline[0]
  const endLabel = formatEndDate(market.endDate)
  const closingSoon = endLabel.endsWith("h") || endLabel === "Today" || endLabel === "1d"

  const imgSrc = (market.image ?? market.icon) as string | undefined

  const navigate = () => router.push(`/markets/${market.id}`)

  return (
    <article
      className="card-enter group surface-card surface-card-hover rounded-2xl overflow-hidden flex flex-col cursor-pointer"
      style={{ animationDelay: `${animDelay}ms`, animationFillMode: "both" }}
      onClick={navigate}
    >
      {/* ── Mobile layout (< sm) ──────────────────────────────────────────── */}
      <div className="sm:hidden p-4 flex flex-col gap-3">

        {/* Title row */}
        <div className="flex items-start gap-3">
          {/* Icon */}
          <div className="relative h-10 w-10 rounded-xl bg-[oklch(0.16_0.014_255)] overflow-hidden flex-shrink-0 border border-[oklch(0.22_0.015_255/0.7)]">
            {imgSrc && !imgError ? (
              <Image src={imgSrc} alt="" fill quality={90} sizes="40px"
                className="object-contain p-1" onError={() => setImgError(true)} />
            ) : (
              <div className="h-full w-full flex items-center justify-center"
                style={{ background: `linear-gradient(135deg, oklch(0.38 0.12 ${(index * 47) % 360}) 0%, oklch(0.28 0.10 ${(index * 47 + 80) % 360}) 100%)` }}>
                <span className="text-[12px] font-black text-white/70 select-none">
                  {(market.question ?? "?").charAt(0).toUpperCase()}
                </span>
              </div>
            )}
          </div>

          {/* Category + question */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 mb-1 flex-wrap">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                {market.category ?? "Market"}
              </span>
              {market.featured && (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[oklch(0.84_0.16_82)] uppercase">
                  <Zap className="h-2.5 w-2.5" />Hot
                </span>
              )}
              {/* Top feed badge (mobile — show only 1) */}
              {market.feedBadges?.[0] && <FeedBadge label={market.feedBadges[0]} />}
            </div>
            <h3 className="text-[14px] font-semibold text-foreground leading-snug line-clamp-3">
              {market.question}
            </h3>
          </div>
        </div>

        {/* Polymarket-style outcome rows */}
        <div className="space-y-2">
          {/* YES row */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span className="text-[13px] font-semibold text-foreground">Yes</span>
              <span className="font-mono text-[13px] font-bold text-[oklch(0.74_0.20_155)]">
                {Math.round(yes)}%
              </span>
            </div>
            <div className="flex gap-1.5">
              <button
                onClick={(e) => { e.stopPropagation(); navigate() }}
                className="btn-yes btn-press h-9 w-[3.75rem] rounded-xl flex items-center justify-center"
              >
                <span className="text-[12px] font-bold text-[oklch(0.80_0.20_155)]">Yes</span>
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); navigate() }}
                className="btn-no btn-press h-9 w-[3.75rem] rounded-xl flex items-center justify-center"
              >
                <span className="text-[12px] font-bold text-[oklch(0.74_0.20_25)]">No</span>
              </button>
            </div>
          </div>

          {/* NO row — only show for binary markets with distinct outcomes */}
          {market.outcomes && market.outcomes.length >= 2 && (
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span className="text-[13px] font-semibold text-foreground">No</span>
                <span className="font-mono text-[13px] font-bold text-[oklch(0.65_0.20_25)]">
                  {Math.round(no)}%
                </span>
              </div>
              {/* Spacer to align with buttons above */}
              <div className="w-[116px]" />
            </div>
          )}
        </div>

        {/* Volume + closes */}
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground pt-1 border-t border-[oklch(0.16_0.013_260/0.8)]">
          <span className="font-mono">{market.volume} Vol.</span>
          <span className="text-[oklch(0.20_0.014_255)]">·</span>
          <span className="font-mono">{market.liquidity} Liq.</span>
          {closingSoon && (
            <>
              <span className="text-[oklch(0.20_0.014_255)]">·</span>
              <span className="inline-flex items-center gap-1 text-[oklch(0.68_0.18_25)]">
                <Clock className="h-3 w-3" />{endLabel}
              </span>
            </>
          )}
        </div>
      </div>

      {/* ── Desktop layout (≥ sm) ─────────────────────────────────────────── */}
      <div className="hidden sm:flex p-4 flex-col flex-1 gap-3">

        {/* Icon + Category + Title */}
        <div className="flex items-start gap-3">
          <div className="relative h-11 w-11 rounded-xl bg-[oklch(0.16_0.014_255)] overflow-hidden flex-shrink-0 border border-[oklch(0.22_0.015_255/0.7)] group-hover:scale-[1.08] transition-transform duration-300 ease-out">
            {imgSrc && !imgError ? (
              <Image src={imgSrc} alt="" fill quality={90} sizes="44px"
                className="object-contain p-1" onError={() => setImgError(true)} />
            ) : (
              <div className="h-full w-full flex items-center justify-center"
                style={{ background: `linear-gradient(135deg, oklch(0.38 0.12 ${(index * 47) % 360}) 0%, oklch(0.28 0.10 ${(index * 47 + 80) % 360}) 100%)` }}>
                <span className="text-[13px] font-black text-white/70 select-none">
                  {(market.question ?? "?").charAt(0).toUpperCase()}
                </span>
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
              <span className="px-2 py-0.5 rounded-md bg-[oklch(0.18_0.014_255)] border border-[oklch(0.24_0.016_255/0.7)] text-[10px] font-semibold text-muted-foreground uppercase tracking-wide truncate max-w-[96px]">
                {market.category ?? "Market"}
              </span>
              {market.featured && (
                <span className="inline-flex items-center gap-1 rounded-md border border-[oklch(0.78_0.16_82/0.28)] bg-[oklch(0.78_0.16_82/0.10)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[oklch(0.84_0.16_82)]">
                  <Zap className="h-2.5 w-2.5" /> Hot
                </span>
              )}
              {closingSoon && (
                <span className="inline-flex items-center gap-1 rounded-md border border-[oklch(0.60_0.18_25/0.25)] bg-[oklch(0.60_0.18_25/0.08)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[oklch(0.70_0.18_25)]">
                  <Clock className="h-2.5 w-2.5" /> {endLabel}
                </span>
              )}
              {/* Feed quality badges — show up to 2, skip "Closes today" if already shown above */}
              {market.feedBadges
                ?.filter((b) => !(closingSoon && b === "Closes today"))
                .slice(0, closingSoon ? 1 : 2)
                .map((badge) => <FeedBadge key={badge} label={badge} />)}
            </div>
            <h3 className="text-sm font-semibold text-foreground leading-snug line-clamp-2 group-hover:text-[oklch(0.95_0.01_90)] transition-colors duration-200">
              {market.question}
            </h3>
          </div>
        </div>

        {/* Probability bar */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <span className="text-[12px] font-bold text-[oklch(0.74_0.20_155)] tabular-nums w-10 shrink-0">
                {Math.round(yes)}%
              </span>
              <div className="flex-1 h-2 overflow-hidden rounded-full bg-[oklch(0.16_0.012_260)] relative">
                <div className="h-full rounded-full prob-bar-fill transition-all duration-500" style={{ width: yesWidth }} />
              </div>
              <span className="text-[12px] font-bold text-[oklch(0.65_0.20_25)] tabular-nums w-10 text-right shrink-0">
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

        {/* Stats row */}
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1 font-medium min-w-0">
            <TrendingUp className="w-3 h-3 shrink-0 text-[oklch(0.78_0.16_82/0.75)]" />
            <span className="font-mono truncate max-w-[72px]">{market.volume}</span>
          </span>
          <span className="text-[oklch(0.24_0.014_255)] shrink-0">·</span>
          <span className="flex items-center gap-1 font-medium min-w-0">
            <Droplets className="w-3 h-3 shrink-0 text-[oklch(0.68_0.18_155/0.75)]" />
            <span className="font-mono truncate max-w-[72px]">{market.liquidity}</span>
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
        <div className="grid grid-cols-2 gap-2 mt-auto pt-1">
          <button onClick={(e) => { e.stopPropagation(); navigate() }}
            className="h-10 rounded-xl btn-yes btn-press flex items-center justify-center gap-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wide text-[oklch(0.78_0.20_155)]">Yes</span>
            <span className="text-sm font-bold text-[oklch(0.92_0.12_155)] tabular-nums">{Math.round(yes)}¢</span>
          </button>
          <button onClick={(e) => { e.stopPropagation(); navigate() }}
            className="h-10 rounded-xl btn-no btn-press flex items-center justify-center gap-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wide text-[oklch(0.72_0.20_25)]">No</span>
            <span className="text-sm font-bold text-[oklch(0.90_0.12_25)] tabular-nums">{Math.round(no)}¢</span>
          </button>
        </div>
      </div>
    </article>
  )
}
