"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import {
  ArrowUpRight,
  Flame,
  Newspaper,
  TrendingUp,
} from "lucide-react"
import { fetchMarkets, getCachedMarkets } from "@/lib/markets"
import { cacheMarketForDetail } from "@/lib/market-detail-cache"
import type { PolymarketMarket } from "@/lib/polymarket"
import { cn } from "@/lib/utils"

const PREMIUM_ANALYSIS_FEE_ENABLED =
  process.env.NEXT_PUBLIC_PREMIUM_ANALYSIS_FEE_ENABLED === "true"

function getPrimaryPrice(market?: PolymarketMarket | null) {
  if (!market) return 50
  const yes = market.outcomes?.find((o) => o.name.toLowerCase().includes("yes"))?.price
  const first = market.outcomes?.[0]?.price
  const price = typeof yes === "number" ? yes : typeof first === "number" ? first : 50
  return Math.max(1, Math.min(99, price))
}

function getPrimaryLabel(market?: PolymarketMarket | null) {
  if (!market) return "Yes"
  const yes = market.outcomes?.find((o) => o.name.toLowerCase().includes("yes"))?.name
  return yes ?? market.outcomes?.[0]?.name ?? "Yes"
}

function formatEndDate(dateStr?: string) {
  if (!dateStr) return "Open"
  const ts = new Date(dateStr).getTime()
  if (!Number.isFinite(ts)) return "Open"
  const days = Math.ceil((ts - Date.now()) / 86_400_000)
  if (days < 0) return "Resolved"
  if (days === 0) return "Today"
  if (days === 1) return "1d"
  if (days <= 30) return `${days}d`
  if (days <= 365) return `${Math.ceil(days / 7)}w`
  return `${Math.ceil(days / 365)}y`
}

// SVG radial probability arc
function ProbArc({ pct, size = 140 }: { pct: number; size?: number }) {
  const r = (size - 16) / 2
  const cx = size / 2
  const cy = size / 2
  const circ = 2 * Math.PI * r
  const offset = circ - (pct / 100) * circ
  const isHigh = pct >= 60
  const color = isHigh ? "oklch(0.68 0.18 155)" : pct >= 40 ? "oklch(0.78 0.16 82)" : "oklch(0.60 0.18 25)"

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="prob-ring">
      <circle cx={cx} cy={cy} r={r} className="prob-ring-track" strokeWidth="6" />
      <circle
        cx={cx} cy={cy} r={r}
        className="prob-ring-fill"
        strokeWidth="6"
        stroke={color}
        style={{
          strokeDasharray: circ,
          strokeDashoffset: offset,
          filter: `drop-shadow(0 0 8px ${color})`,
        }}
      />
    </svg>
  )
}

function HeroSkeleton() {
  return (
    <section className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 rawli-page-top pb-7 relative z-[1] overflow-hidden">
      <div className="space-y-4">
        <div className="h-7 w-44 shimmer rounded-full" />
        <div className="grid gap-4 lg:grid-cols-[1fr_minmax(300px,0.44fr)]">
          <div className="h-[440px] shimmer rounded-2xl" />
          <div className="h-[440px] shimmer rounded-2xl hidden lg:block" />
        </div>
      </div>
    </section>
  )
}

// Tiny crisp market thumbnail — rendered at native resolution so it never blurs
function MarketThumb({ src, size = 48 }: { src?: string | null; size?: number }) {
  const [err, setErr] = useState(false)
  if (!src || err) {
    return (
      <div
        className="shrink-0 rounded-xl border border-[oklch(0.24_0.016_255)] bg-[oklch(0.16_0.014_255)] grid place-items-center"
        style={{ width: size, height: size }}
      >
        <TrendingUp className="w-5 h-5 text-[oklch(0.78_0.16_82/0.6)]" />
      </div>
    )
  }
  return (
    <div
      className="relative shrink-0 overflow-hidden rounded-xl border border-[oklch(0.24_0.016_255)] bg-[oklch(0.14_0.013_255)]"
      style={{ width: size, height: size }}
    >
      <Image
        src={src}
        alt=""
        fill
        quality={90}
        sizes={`${size}px`}
        className="object-cover"
        onError={() => setErr(true)}
      />
    </div>
  )
}

export function MarketHero() {
  const router = useRouter()
  const cachedTrending = getCachedMarkets("all", 10, "trending", 0)
  const cachedBreaking = getCachedMarkets("World", 14, "newest", 0)
  const [trending, setTrending] = useState<PolymarketMarket[]>(cachedTrending ?? [])
  const [breaking, setBreaking] = useState<PolymarketMarket[]>(
    cachedBreaking?.length ? cachedBreaking : cachedTrending?.slice(0, 8) ?? []
  )
  const [activeIndex, setActiveIndex] = useState(0)
  const [loading, setLoading] = useState(!cachedTrending)
  const touchStartX = useRef<number>(0)

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
  }
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (trending.length <= 1) return
    const dx = e.changedTouches[0].clientX - touchStartX.current
    if (Math.abs(dx) > 48) {
      if (dx < 0) setActiveIndex((i) => (i + 1) % trending.length)
      else setActiveIndex((i) => (i - 1 + trending.length) % trending.length)
    }
  }

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const hotMarkets = await fetchMarkets("all", 10, "trending", 0)
        if (cancelled) return
        setTrending(hotMarkets)
        if (!cachedBreaking?.length) setBreaking(hotMarkets.slice(0, 8))
        setLoading(false)
        const newsMarkets = await fetchMarkets("World", 14, "newest", 0).catch(() => [])
        if (cancelled || !newsMarkets.length) return
        setBreaking(newsMarkets)
      } catch (err) {
        console.error("[rawli] Hero load failed:", err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (trending.length <= 1) return
    const timer = window.setInterval(() => {
      setActiveIndex((i) => (i + 1) % trending.length)
    }, 6500)
    return () => window.clearInterval(timer)
  }, [trending.length])

  const activeMarket = trending[activeIndex] ?? trending[0]
  const activePrice = getPrimaryPrice(activeMarket)
  const noPrice = Math.max(1, 100 - activePrice)
  const activeLabel = getPrimaryLabel(activeMarket)
  const marqueeMarkets = useMemo(() => [...trending, ...trending], [trending])

  const goToMarket = (market?: PolymarketMarket | null) => {
    if (!market?.id) return
    cacheMarketForDetail(market)
    router.push(`/markets/${market.id}`)
  }

  if (loading && trending.length === 0) return <HeroSkeleton />

  if (!activeMarket) {
    return (
      <section className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 rawli-page-top pb-4 sm:pb-7 relative z-[1]">
        <div className="rounded-2xl border border-[oklch(0.22_0.015_255)] bg-[oklch(0.115_0.012_260/0.95)] p-8 text-center">
          <p className="text-sm text-muted-foreground">Markets loading...</p>
        </div>
      </section>
    )
  }

  const heroImg = (activeMarket.image ?? activeMarket.icon) as string | undefined

  return (
    <section className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 rawli-page-top pb-4 sm:pb-7 relative z-[1]">

      {/* ── Compact header — hidden on mobile ── */}
      <div className="mb-4 hidden sm:flex sm:items-center sm:justify-between sm:gap-6">
        <div className="hero-enter flex items-center gap-3" style={{ animationDelay: "0ms" }}>
          <div className="inline-flex items-center gap-2 rounded-full border border-[oklch(0.78_0.16_82/0.25)] bg-[oklch(0.78_0.16_82/0.07)] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.24em] text-[oklch(0.82_0.16_82)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[oklch(0.68_0.18_155)] pulse-dot" />
            Live markets
          </div>
          <span className="text-[11px] text-muted-foreground">Real-time prediction markets</span>
        </div>
      </div>

      {/* ── Two-column grid — fixed row height so both columns match ── */}
      <div
        className="hero-enter grid items-stretch gap-4 lg:grid-cols-[1fr_minmax(300px,0.44fr)] lg:grid-rows-[430px]"
        style={{ animationDelay: "120ms" }}
      >

        {/* ════════════════════════════════════════════════════════
            FEATURED MARKET CARD — data-forward, no blurry background
            ════════════════════════════════════════════════════════ */}
        <div
          className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-[oklch(0.22_0.015_255)] bg-[oklch(0.115_0.012_260/0.95)] hero-card-glow h-full"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          {/* Amber glow line */}
          <div className="h-px bg-gradient-to-r from-transparent via-[oklch(0.78_0.16_82/0.5)] to-transparent" />

          {/* ── Top: Market identity ── */}
          <button
            type="button"
            onClick={() => goToMarket(activeMarket)}
            className="group flex flex-col gap-5 p-5 sm:p-6 text-left"
          >
            {/* Category + time badges */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="rounded-lg bg-[oklch(0.78_0.16_82/0.10)] border border-[oklch(0.78_0.16_82/0.20)] px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-[oklch(0.88_0.16_82)]">
                  {activeMarket.category ?? "Market"}
                </span>
                <span className="rounded-lg bg-[oklch(0.68_0.18_155/0.08)] border border-[oklch(0.68_0.18_155/0.20)] px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-[oklch(0.74_0.18_155)]">
                  Live
                </span>
              </div>
              <span className="rounded-lg bg-[oklch(0.16_0.014_255)] border border-[oklch(0.24_0.016_255)] px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                Closes {formatEndDate(activeMarket.endDate)}
              </span>
            </div>

            {/* Image thumb + question */}
            <div className="flex items-start gap-4 sm:gap-5">
              <MarketThumb src={heroImg} size={56} />
              <div className="min-w-0 flex-1">
                <h2 className="line-clamp-3 text-lg font-bold leading-snug text-foreground transition-colors group-hover:text-[oklch(0.95_0.01_90)] sm:text-xl lg:text-2xl">
                  {activeMarket.question}
                </h2>
                <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span className="font-mono">{activeMarket.volume} traded</span>
                  <span className="text-[oklch(0.24_0.015_255)]">&middot;</span>
                  <span className="font-mono">{activeMarket.liquidity} available</span>
                  <span className="ml-auto hidden sm:flex items-center gap-1 text-[oklch(0.78_0.16_82/0.6)] group-hover:text-[oklch(0.78_0.16_82)] transition-colors">
                    Open market <ArrowUpRight className="h-3 w-3" />
                  </span>
                </div>
              </div>
            </div>
          </button>

          {/* ── Middle: Probability panel — flex-1 fills remaining height between identity and nav dots ── */}
          <div className="mx-5 sm:mx-6 mb-4 flex-1 flex flex-col justify-center rounded-xl border border-[oklch(0.20_0.015_255)] bg-[oklch(0.09_0.010_260/0.8)] p-4">
            <div className="flex items-center gap-6 sm:gap-8">
              {/* Probability arc */}
              <div className="relative shrink-0">
                <ProbArc pct={activePrice} size={110} />
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <div className="font-mono text-2xl font-bold text-foreground leading-none">{activePrice.toFixed(0)}¢</div>
                  <div className="mt-0.5 text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{activeLabel}</div>
                </div>
              </div>

              {/* Yes / No breakdown */}
              <div className="flex-1 min-w-0 space-y-3">
                {/* YES bar */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-[oklch(0.68_0.18_155)]">Yes</span>
                    <span className="font-mono text-sm font-bold text-[oklch(0.68_0.18_155)]">{activePrice.toFixed(0)}¢</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-[oklch(0.16_0.014_255)]">
                    <div
                      className="h-full rounded-full bg-[oklch(0.68_0.18_155)] transition-all duration-700"
                      style={{ width: `${activePrice}%` }}
                    />
                  </div>
                </div>
                {/* NO bar */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-[oklch(0.62_0.18_25)]">No</span>
                    <span className="font-mono text-sm font-bold text-[oklch(0.62_0.18_25)]">{noPrice.toFixed(0)}¢</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-[oklch(0.16_0.014_255)]">
                    <div
                      className="h-full rounded-full bg-[oklch(0.62_0.18_25)] transition-all duration-700"
                      style={{ width: `${noPrice}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ── Bottom: Nav dots + CTA ── */}
          <div className="shrink-0 flex items-center justify-between gap-3 px-5 sm:px-6 pb-4">
            <div className="flex items-center gap-1.5">
              {trending.slice(0, Math.min(trending.length, 8)).map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setActiveIndex(i)}
                  aria-label={`Go to market ${i + 1}`}
                  className={cn(
                    "rounded-full transition-all duration-300",
                    i === activeIndex
                      ? "h-1.5 w-5 bg-[oklch(0.78_0.16_82)]"
                      : "h-1.5 w-1.5 bg-[oklch(0.28_0.016_255)] hover:bg-[oklch(0.40_0.016_255)]"
                  )}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={() => goToMarket(activeMarket)}
              className="flex items-center gap-1.5 rounded-full bg-[oklch(0.78_0.16_82)] px-5 py-2.5 text-xs font-bold text-[oklch(0.10_0.012_260)] transition-all hover:bg-[oklch(0.83_0.16_82)] hover:shadow-[0_4px_16px_oklch(0.78_0.16_82/0.35)] btn-press"
            >
              Trade now <ArrowUpRight className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* ── Ticker strip — desktop only ── */}
          {marqueeMarkets.length > 0 && (
            <div className="hidden sm:block shrink-0 border-t border-[oklch(0.20_0.015_255)] bg-[oklch(0.095_0.012_260)] py-3 overflow-hidden">
              <div className="w-full overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_6%,black_94%,transparent)]">
                <div className="ticker-scroll flex min-w-max gap-2 px-2">
                  {marqueeMarkets.map((market, idx) => {
                    const price = getPrimaryPrice(market)
                    const isHigh = price >= 55
                    return (
                      <button
                        key={`${market.id}-${idx}`}
                        type="button"
                        onClick={() => goToMarket(market)}
                        className="flex w-[260px] items-center gap-2.5 rounded-xl border border-[oklch(0.22_0.015_255/0.65)] bg-[oklch(0.145_0.013_255/0.95)] px-3 py-2 text-left transition hover:border-[oklch(0.78_0.16_82/0.30)] hover:bg-[oklch(0.16_0.014_255)] btn-press"
                      >
                        <span className="relative grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-lg border border-[oklch(0.22_0.015_255/0.6)] bg-[oklch(0.17_0.014_255)]">
                          {market.image || market.icon ? (
                            <Image
                              src={(market.image ?? market.icon) as string}
                              alt=""
                              fill
                              quality={85}
                              sizes="28px"
                              className="object-contain p-0.5"
                            />
                          ) : (
                            <Flame className="h-3.5 w-3.5 text-[oklch(0.78_0.16_82)]" />
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[11px] font-semibold text-foreground leading-snug">{market.question}</span>
                          <span className="block mt-0.5 font-mono text-[10px] text-muted-foreground">{market.volume}</span>
                        </span>
                        <span className={cn(
                          "shrink-0 rounded-lg px-2 py-1 font-mono text-[11px] font-bold",
                          isHigh ? "bg-[oklch(0.28_0.12_155/0.9)] text-[oklch(0.78_0.20_155)]"
                          : "bg-[oklch(0.26_0.12_25/0.9)] text-[oklch(0.72_0.20_25)]"
                        )}>
                          {price.toFixed(0)}¢
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ════════════════════════════════════════════════════════
            BREAKING NEWS SIDEBAR — desktop only
            ════════════════════════════════════════════════════════ */}
        <aside className="hidden lg:flex flex-col h-full rounded-2xl border border-[oklch(0.20_0.014_255/0.8)] bg-[oklch(0.118_0.012_260/0.96)] overflow-hidden hero-card-glow">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[oklch(0.18_0.014_255)] px-4 py-3">
            <div className="flex items-center gap-2">
              <Newspaper className="h-3.5 w-3.5 text-[oklch(0.78_0.16_82)]" />
              <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-foreground">Breaking</span>
            </div>
            <span className="flex items-center gap-1 rounded-full border border-[oklch(0.68_0.18_155/0.22)] bg-[oklch(0.68_0.18_155/0.07)] px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-[oklch(0.68_0.18_155)]">
              <span className="h-1 w-1 rounded-full bg-[oklch(0.68_0.18_155)] pulse-dot" />
              Live
            </span>
          </div>

          {/* News list — scrollable */}
          <div className="min-h-0 flex-1 overflow-y-auto no-scrollbar">
            {breaking.map((market, i) => {
              const price = getPrimaryPrice(market)
              const isHigh = price >= 55
              return (
                <button
                  key={market.id}
                  type="button"
                  onClick={() => goToMarket(market)}
                  className="news-item-enter group flex w-full items-start gap-3 border-b border-[oklch(0.14_0.012_260)] px-4 py-3 text-left transition-colors last:border-0 hover:bg-[oklch(0.14_0.012_260/0.8)]"
                  style={{ animationDelay: `${i * 40}ms` }}
                >
                  <span className="mt-0.5 shrink-0 font-mono text-[10px] font-bold text-[oklch(0.30_0.015_255)]">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 text-[12px] font-semibold leading-snug text-foreground transition-colors group-hover:text-[oklch(0.90_0.01_90)]">
                      {market.question}
                    </span>
                    <span className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                      <span className="truncate">{market.category ?? "News"}</span>
                      <span className="text-[oklch(0.24_0.015_255)]">&middot;</span>
                      <span className="font-mono">{market.volume}</span>
                    </span>
                  </span>
                  <span className={cn(
                    "mt-0.5 shrink-0 rounded-lg px-2 py-1 font-mono text-[11px] font-bold",
                    isHigh
                      ? "bg-[oklch(0.28_0.12_155/0.9)] text-[oklch(0.78_0.20_155)]"
                      : "bg-[oklch(0.26_0.12_25/0.9)] text-[oklch(0.72_0.20_25)]"
                  )}>
                    {price.toFixed(0)}¢
                  </span>
                </button>
              )
            })}
          </div>

        </aside>
      </div>

      {/* ── Mobile ticker strip ── */}
      {marqueeMarkets.length > 0 && (
        <div className="sm:hidden mt-3 -mx-4 border-t border-[oklch(0.20_0.015_255)] bg-[oklch(0.095_0.012_260)] py-3 overflow-hidden">
          <div className="w-full overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_5%,black_95%,transparent)]">
            <div className="ticker-scroll flex min-w-max gap-2 px-2">
              {marqueeMarkets.map((market, idx) => {
                const price = getPrimaryPrice(market)
                const isHigh = price >= 55
                const imgSrc = (market.image ?? market.icon) as string | undefined
                return (
                  <button
                    key={`mobile-${market.id}-${idx}`}
                    type="button"
                    onClick={() => goToMarket(market)}
                    className="flex w-[210px] shrink-0 items-center gap-2.5 rounded-xl border border-[oklch(0.22_0.015_255/0.65)] bg-[oklch(0.145_0.013_255/0.95)] px-3 py-2 text-left active:scale-[0.97] transition-transform"
                  >
                    <span className="relative grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-lg border border-[oklch(0.22_0.015_255/0.6)] bg-[oklch(0.17_0.014_255)]">
                      {imgSrc ? (
                        <Image src={imgSrc} alt="" fill quality={85} sizes="28px" className="object-contain p-0.5" />
                      ) : (
                        <Flame className="h-3.5 w-3.5 text-[oklch(0.78_0.16_82)]" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11px] font-semibold text-foreground leading-snug">{market.question}</span>
                      <span className="block mt-0.5 font-mono text-[10px] text-muted-foreground">{market.volume}</span>
                    </span>
                    <span className={cn(
                      "shrink-0 rounded-lg px-2 py-1 font-mono text-[11px] font-bold",
                      isHigh ? "bg-[oklch(0.28_0.12_155/0.9)] text-[oklch(0.78_0.20_155)]"
                             : "bg-[oklch(0.26_0.12_25/0.9)] text-[oklch(0.72_0.20_25)]"
                    )}>
                      {price.toFixed(0)}¢
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

    </section>
  )
}
