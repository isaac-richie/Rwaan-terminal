"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  ArrowUpRight,
  Brain,
  Flame,
  Newspaper,
  Sparkles,
  Zap,
} from "lucide-react"
import { fetchMarkets } from "@/lib/markets"
import type { PolymarketMarket } from "@/lib/polymarket"
import { cn } from "@/lib/utils"

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
    <section className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-7 relative z-[1] overflow-hidden">
      <div className="space-y-5">
        <div className="h-8 w-48 shimmer rounded-full" />
        <div className="h-16 w-3/4 shimmer rounded-2xl" />
        <div className="grid gap-4 lg:grid-cols-[1fr_0.48fr]">
          <div className="h-[420px] shimmer rounded-2xl" />
          <div className="h-[420px] shimmer rounded-2xl" />
        </div>
      </div>
    </section>
  )
}

export function MarketHero() {
  const router = useRouter()
  const [trending, setTrending] = useState<PolymarketMarket[]>([])
  const [breaking, setBreaking] = useState<PolymarketMarket[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const [hotMarkets, newsMarkets] = await Promise.all([
          fetchMarkets("all", 10, "trending", 0),
          fetchMarkets("News", 14, "newest", 0).catch(() => []),
        ])
        if (cancelled) return
        setTrending(hotMarkets)
        setBreaking(newsMarkets.length ? newsMarkets : hotMarkets.slice(0, 8))
        setActiveIndex(0)
      } catch (err) {
        console.error("[rawali] Hero load failed:", err)
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
    if (market?.id) router.push(`/markets/${market.id}`)
  }

  if (loading && trending.length === 0) return <HeroSkeleton />
  if (!activeMarket) return null

  return (
    <section className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-7 relative z-[1] overflow-hidden">

      {/* ── Hero headline ────────────────────────────────── */}
      <div className="mb-8">
        {/* Live badge */}
        <div
          className="hero-enter inline-flex items-center gap-2 rounded-full border border-[oklch(0.78_0.16_82/0.25)] bg-[oklch(0.78_0.16_82/0.07)] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.24em] text-[oklch(0.82_0.16_82)]"
          style={{ animationDelay: "0ms" }}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-[oklch(0.68_0.18_155)] pulse-dot" />
          Rawali · prediction terminal · live
        </div>

        {/* Main heading — three visual lines */}
        <h1
          className="hero-enter mt-4 font-bold tracking-tight text-foreground"
          style={{ animationDelay: "80ms" }}
        >
          <span className="block text-4xl leading-[1.02] sm:text-5xl lg:text-6xl">
            Trade the signal
          </span>
          <span className="block text-4xl leading-[1.02] text-[oklch(0.55_0.02_255)] sm:text-5xl lg:text-6xl">
            before it becomes
          </span>
          <span className="block text-4xl leading-[1.02] sm:text-5xl lg:text-6xl">
            consensus
            <span className="text-[oklch(0.78_0.16_82)]">.</span>
          </span>
        </h1>

        {/* Sub-row: description + feature chips */}
        <div
          className="hero-enter mt-5 flex flex-wrap items-center gap-3"
          style={{ animationDelay: "160ms" }}
        >
          <p className="text-sm leading-relaxed text-muted-foreground max-w-sm">
            Live Polymarket liquidity. BNB-native funding. AI market briefings.
          </p>
          <div className="flex flex-wrap gap-2">
            {[
              { icon: Zap, label: "BNB funded" },
              { icon: Brain, label: "AI reports" },
              { icon: Flame, label: "Live books" },
            ].map(({ icon: Icon, label }) => (
              <span key={label} className="inline-flex items-center gap-1.5 rounded-lg border border-[oklch(0.22_0.015_255)] bg-[oklch(0.14_0.012_260/0.8)] px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                <Icon className="h-3 w-3 text-[oklch(0.78_0.16_82)]" />
                {label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ── Main two-column layout ───────────────────────── */}
      <div
        className="hero-enter grid items-stretch gap-4 lg:grid-cols-[1fr_minmax(320px,0.48fr)]"
        style={{ animationDelay: "240ms" }}
      >
        {/* Featured market card */}
        <div className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-[oklch(0.22_0.015_255)] bg-[oklch(0.115_0.012_260/0.95)] hero-card-glow">

          {/* Image + question pane */}
          <button
            type="button"
            onClick={() => goToMarket(activeMarket)}
            className="group relative flex-1 min-h-[220px] overflow-hidden text-left scanline"
          >
            {/* Background image */}
            {(activeMarket.image || activeMarket.icon) && (
              <img
                key={activeMarket.id}
                src={activeMarket.image ?? activeMarket.icon}
                alt=""
                className="absolute inset-0 h-full w-full object-cover opacity-35 transition-all duration-700 group-hover:scale-105 group-hover:opacity-45"
              />
            )}

            {/* Layered overlay */}
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_0%,oklch(0.78_0.16_82/0.14),transparent_55%),linear-gradient(180deg,oklch(0.08_0.012_260/0.2)_0%,oklch(0.08_0.012_260/0.92)_100%)]" />

            {/* Amber glow line at top */}
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[oklch(0.78_0.16_82/0.6)] to-transparent" />

            <div className="relative flex h-full flex-col justify-between p-5 sm:p-6">
              <div className="flex items-center justify-between gap-2">
                <span className="rounded-lg border border-[oklch(0.78_0.16_82/0.22)] bg-[oklch(0.78_0.16_82/0.09)] px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-[oklch(0.82_0.16_82)]">
                  {activeMarket.category ?? "Market"}
                </span>
                <div className="flex items-center gap-2">
                  <span className="rounded-lg border border-[oklch(0.68_0.18_155/0.22)] bg-[oklch(0.68_0.18_155/0.08)] px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-[oklch(0.68_0.18_155)]">
                    Live
                  </span>
                  <span className="rounded-lg border border-[oklch(0.22_0.015_255)] bg-[oklch(0.14_0.012_260/0.7)] px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                    Closes {formatEndDate(activeMarket.endDate)}
                  </span>
                </div>
              </div>

              <div>
                <h2 className="line-clamp-3 text-xl font-bold leading-tight text-foreground transition-colors group-hover:text-[oklch(0.95_0.01_90)] sm:text-2xl">
                  {activeMarket.question}
                </h2>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  <span className="font-mono">{activeMarket.volume} Vol.</span>
                  <span className="text-[oklch(0.24_0.015_255)]">·</span>
                  <span className="font-mono">{activeMarket.liquidity} Liq.</span>
                  <span className="ml-auto flex items-center gap-1 text-[oklch(0.78_0.16_82/0.7)] group-hover:text-[oklch(0.78_0.16_82)]">
                    Open market <ArrowUpRight className="h-3 w-3" />
                  </span>
                </div>
              </div>
            </div>
          </button>

          {/* Probability + trade controls */}
          <div className="border-t border-[oklch(0.20_0.015_255)] bg-[oklch(0.10_0.012_260/0.8)] px-5 py-4 sm:px-6">
            <div className="flex items-center gap-6">
              {/* Radial arc */}
              <div className="relative shrink-0">
                <ProbArc pct={activePrice} size={120} />
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <div className="font-mono text-2xl font-bold text-foreground leading-none">{activePrice.toFixed(0)}¢</div>
                  <div className="mt-0.5 text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{activeLabel}</div>
                </div>
              </div>

              <div className="flex-1 min-w-0">
                {/* Yes / No row */}
                <div className="flex items-end justify-between gap-4 mb-3">
                  <div>
                    <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Yes</div>
                    <div className="mt-0.5 font-mono text-lg font-bold text-[oklch(0.68_0.18_155)]">{activePrice.toFixed(0)}¢</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">No</div>
                    <div className="mt-0.5 font-mono text-lg font-bold text-[oklch(0.62_0.18_25)]">{noPrice.toFixed(0)}¢</div>
                  </div>
                </div>

                {/* Flat bar underneath */}
                <div className="h-1.5 overflow-hidden rounded-full bg-[oklch(0.18_0.014_255)]">
                  <div
                    className="h-full rounded-full prob-bar-fill transition-all duration-700"
                    style={{ width: `${activePrice}%` }}
                  />
                </div>

                {/* Nav dots + CTA */}
                <div className="mt-3 flex items-center justify-between gap-3">
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
                    className="flex items-center gap-1.5 rounded-xl bg-[oklch(0.78_0.16_82)] px-4 py-2 text-xs font-bold text-[oklch(0.10_0.012_260)] transition hover:bg-[oklch(0.83_0.16_82)] btn-press"
                  >
                    Trade now <ArrowUpRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Ticker strip */}
          {marqueeMarkets.length > 0 && (
            <div className="shrink-0 border-t border-[oklch(0.20_0.015_255)] bg-[oklch(0.095_0.012_260)] py-3">
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
                        className="flex w-[260px] items-center gap-2.5 rounded-xl border border-[oklch(0.20_0.015_255)] bg-[oklch(0.13_0.013_255/0.9)] px-3 py-2 text-left transition hover:border-[oklch(0.78_0.16_82/0.30)] hover:bg-[oklch(0.15_0.014_255)] btn-press"
                      >
                        <span className="grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-lg border border-[oklch(0.20_0.015_255)] bg-[oklch(0.16_0.014_255)]">
                          {market.image || market.icon ? (
                            <img src={market.image ?? market.icon} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <Flame className="h-3.5 w-3.5 text-[oklch(0.78_0.16_82)]" />
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[11px] font-semibold text-foreground leading-snug">{market.question}</span>
                          <span className="block mt-0.5 font-mono text-[9px] text-muted-foreground">{market.volume}</span>
                        </span>
                        <span className={cn(
                          "shrink-0 rounded-lg px-2 py-0.5 font-mono text-[11px] font-bold",
                          isHigh ? "bg-[oklch(0.68_0.18_155/0.12)] text-[oklch(0.68_0.18_155)]"
                          : "bg-[oklch(0.60_0.18_25/0.10)] text-[oklch(0.62_0.18_25)]"
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

        {/* ── Breaking news sidebar — hidden on mobile, shown lg+ ── */}
        <aside
          className="hidden lg:flex flex-col rounded-2xl border border-[oklch(0.22_0.015_255)] bg-[oklch(0.115_0.012_260/0.95)] overflow-hidden hero-card-glow"
        >
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

          {/* News list */}
          <div className="flex-1 overflow-y-auto no-scrollbar">
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
                    <span className="mt-1 flex items-center gap-2 text-[9px] text-muted-foreground">
                      <span className="truncate">{market.category ?? "News"}</span>
                      <span className="text-[oklch(0.22_0.015_255)]">·</span>
                      <span className="font-mono">{market.volume}</span>
                    </span>
                  </span>
                  <span className={cn(
                    "mt-0.5 shrink-0 rounded-lg px-2 py-1 font-mono text-[11px] font-bold",
                    isHigh
                      ? "bg-[oklch(0.68_0.18_155/0.10)] text-[oklch(0.68_0.18_155)]"
                      : "bg-[oklch(0.60_0.18_25/0.10)] text-[oklch(0.62_0.18_25)]"
                  )}>
                    {price.toFixed(0)}¢
                  </span>
                </button>
              )
            })}
          </div>

          {/* Intelligence CTA */}
          <div className="shrink-0 border-t border-[oklch(0.18_0.014_255)] bg-[oklch(0.10_0.012_260/0.8)] p-4">
            <div className="rounded-xl border border-[oklch(0.78_0.16_82/0.18)] bg-[oklch(0.78_0.16_82/0.05)] p-3.5">
              <div className="flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5 text-[oklch(0.78_0.16_82)]" />
                <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[oklch(0.82_0.16_82)]">Rawali intelligence</span>
              </div>
              <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
                Deep AI reports per market — live context, structural drivers, and a definitive YES/NO verdict. Unlock for $1 USDT.
              </p>
              <div className="mt-3 flex items-center gap-1.5 text-[10px] font-bold text-[oklch(0.78_0.16_82)]">
                <span className="h-1 w-1 rounded-full bg-[oklch(0.78_0.16_82)]" />
                Available on every market page
              </div>
            </div>
          </div>
        </aside>
      </div>
    </section>
  )
}
