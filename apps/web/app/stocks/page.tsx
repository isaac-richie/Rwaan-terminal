"use client"

import { useEffect, useMemo, useState, useCallback } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  AlertTriangle, ArrowUpRight, Brain, ChevronRight,
  Clock3, ExternalLink, RefreshCw, Search, TrendingDown,
  TrendingUp, Wallet, X, Zap,
} from "lucide-react"
import { Navbar } from "@/components/navbar"
import { Footer } from "@/components/footer"
import { cn } from "@/lib/utils"
import {
  fetchRwaAssets, fetchRwaQuotes, fetchRelatedMarkets,
  type RwaAsset, type RwaQuote, type RelatedMarket, type RegionEligibility,
} from "@/lib/rwa"

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatMoney(value?: number | null, currency = "USD") {
  if (value == null || !Number.isFinite(value)) return "--"
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency,
    minimumFractionDigits: value >= 100 ? 2 : 2,
    maximumFractionDigits: value >= 100 ? 2 : 3,
  }).format(value)
}

function formatPct(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return "--"
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`
}

function formatVolume(v: number) {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`
  return `$${v.toFixed(0)}`
}

function timeAgo(value?: string) {
  if (!value) return "Delayed"
  const secs = Math.floor((Date.now() - new Date(value).getTime()) / 1000)
  if (secs < 60) return "Live"
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  return `${Math.floor(secs / 3600)}h ago`
}

function formatEndDate(d: string | null) {
  if (!d) return "Open"
  const ms = new Date(d).getTime() - Date.now()
  if (ms < 0) return "Ended"
  const days = Math.ceil(ms / 86_400_000)
  if (days <= 1) return `${Math.ceil(ms / 3_600_000)}h`
  if (days <= 30) return `${days}d`
  return `${Math.ceil(days / 7)}w`
}

// ─── Asset logo/mark ─────────────────────────────────────────────────────────
function AssetMark({ asset, size = "md" }: { asset: RwaAsset; size?: "sm" | "md" | "lg" }) {
  const sizes = { sm: "h-9 w-9 text-[11px]", md: "h-11 w-11 text-[13px]", lg: "h-14 w-14 text-sm" }
  return (
    <div
      className={cn("shrink-0 flex items-center justify-center rounded-xl border border-white/10 font-mono font-bold text-white shadow-[inset_0_1px_0_oklch(1_0_0/0.10)]", sizes[size])}
      style={{ background: `linear-gradient(135deg, ${asset.accent}, oklch(0.13 0.014 255))` }}
    >
      {asset.displaySymbol.slice(0, 4)}
    </div>
  )
}

// ─── Mini sparkline (purely decorative — no historical data yet) ─────────────
function MiniSpark({ positive, accent }: { positive: boolean; accent: string }) {
  const pts = positive
    ? [6, 5, 7, 4, 8, 5, 9, 6, 10, 7, 12]
    : [12, 10, 11, 8, 9, 6, 8, 5, 7, 4, 5]
  const w = 44, h = 18
  const xs = pts.map((_, i) => (i / (pts.length - 1)) * w)
  const min = Math.min(...pts), max = Math.max(...pts)
  const ys = pts.map(p => h - ((p - min) / (max - min)) * h)
  const path = xs.map((x, i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ")
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} fill="none" className="shrink-0 opacity-80">
      <path d={path} stroke={accent} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={xs[xs.length - 1]} cy={ys[ys.length - 1]} r="2" fill={accent} />
    </svg>
  )
}

// ─── Asset card (grid) ───────────────────────────────────────────────────────
function AssetCard({ asset, quote, selected, onSelect }: {
  asset: RwaAsset; quote?: RwaQuote; selected: boolean; onSelect: () => void
}) {
  const positive = (quote?.changePct ?? 0) >= 0
  const accent = positive ? "oklch(0.68 0.18 155)" : "oklch(0.62 0.18 25)"
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "group w-full rounded-2xl border p-3.5 sm:p-4 text-left transition-all duration-200 active:scale-[0.98]",
        "bg-[oklch(0.12_0.012_260/0.88)]",
        selected
          ? "border-[oklch(0.78_0.16_82/0.55)] shadow-[0_0_0_1px_oklch(0.78_0.16_82/0.16),0_16px_48px_oklch(0_0_0/0.28)]"
          : "border-[oklch(0.22_0.015_255/0.72)] hover:border-[oklch(0.78_0.16_82/0.30)]"
      )}
    >
      <div className="flex items-start gap-3">
        <AssetMark asset={asset} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="font-mono text-sm font-bold text-foreground">{asset.displaySymbol}</div>
              <div className="truncate text-[11px] text-muted-foreground mt-0.5">{asset.name}</div>
            </div>
            <span className={cn(
              "shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide",
              asset.assetClass === "etf"
                ? "bg-[oklch(0.62_0.17_250/0.12)] text-[oklch(0.72_0.16_250)]"
                : "bg-[oklch(0.78_0.16_82/0.12)] text-[oklch(0.82_0.16_82)]"
            )}>
              {asset.assetClass}
            </span>
          </div>

          <div className="mt-3 flex items-end justify-between gap-2">
            <div>
              <div className="font-mono text-lg sm:text-xl font-semibold text-foreground leading-none">
                {formatMoney(quote?.price, quote?.currency)}
              </div>
              <div className={cn(
                "mt-1 text-[11px] font-bold tabular-nums",
                positive ? "text-[oklch(0.68_0.18_155)]" : "text-[oklch(0.62_0.18_25)]"
              )}>
                {formatPct(quote?.changePct)}
              </div>
            </div>
            <MiniSpark positive={positive} accent={accent} />
          </div>
        </div>
      </div>

      {/* Sector tag */}
      <div className="mt-3 flex items-center gap-1.5">
        <span className="text-[10px] text-muted-foreground/60 font-medium">{asset.sector}</span>
        {asset.risk === "high" && (
          <span className="rounded px-1 py-0.5 text-[9px] font-bold bg-[oklch(0.62_0.18_25/0.12)] text-[oklch(0.68_0.18_25)]">
            High beta
          </span>
        )}
      </div>
    </button>
  )
}

// ─── Related market chip ─────────────────────────────────────────────────────
function RelatedMarketChip({ market }: { market: RelatedMarket }) {
  const router = useRouter()
  const positive = (market.yesPrice ?? 0.5) >= 0.5
  return (
    <button
      type="button"
      onClick={() => router.push(`/markets/${market.id}`)}
      className="w-full text-left rounded-xl border border-[oklch(0.22_0.015_255/0.72)] bg-[oklch(0.10_0.012_260/0.72)] p-3 hover:border-[oklch(0.78_0.16_82/0.30)] transition-colors active:scale-[0.98] group"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[12px] text-foreground leading-snug line-clamp-2 flex-1">{market.question}</p>
        <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground/50 mt-0.5 group-hover:text-[oklch(0.78_0.16_82)] transition-colors" />
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={cn("text-[11px] font-bold tabular-nums", positive ? "text-[oklch(0.68_0.18_155)]" : "text-[oklch(0.62_0.18_25)]")}>
            Yes {market.yesPrice != null ? `${(market.yesPrice * 100).toFixed(0)}¢` : "--"}
          </span>
          <span className="text-[10px] text-muted-foreground">{formatVolume(market.volume)}</span>
        </div>
        <span className="text-[10px] text-muted-foreground">{formatEndDate(market.endDate)}</span>
      </div>
    </button>
  )
}

// ─── Filters ─────────────────────────────────────────────────────────────────
const SECTOR_GROUPS = ["All", "Big Tech", "AI & Chips", "Crypto Equities", "EV & Mobility", "Finance", "Healthcare", "Energy", "ETFs"]

// ─── Main page ───────────────────────────────────────────────────────────────
export default function StocksPage() {
  const [assets, setAssets] = useState<RwaAsset[]>([])
  const [quotes, setQuotes] = useState<Record<string, RwaQuote>>({})
  const [eligibility, setEligibility] = useState<RegionEligibility | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [activeSector, setActiveSector] = useState("All")
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [relatedMarkets, setRelatedMarkets] = useState<RelatedMarket[]>([])
  const [relatedLoading, setRelatedLoading] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)

  const selectedAsset = useMemo(
    () => assets.find((a) => a.id === selectedId) ?? null,
    [assets, selectedId]
  )
  const selectedQuote = selectedAsset ? quotes[selectedAsset.quoteSymbol] : undefined

  const filteredAssets = useMemo(() => {
    return assets.filter((a) => {
      if (activeSector !== "All" && a.sectorGroup !== activeSector) return false
      if (search) {
        const q = search.toLowerCase()
        return a.symbol.toLowerCase().includes(q) || a.name.toLowerCase().includes(q) || a.sector.toLowerCase().includes(q)
      }
      return true
    })
  }, [assets, activeSector, search])

  const load = useCallback(async (quiet = false) => {
    quiet ? setRefreshing(true) : setLoading(true)
    setError(null)
    try {
      const catalog = await fetchRwaAssets("NG")
      const quoteMap = await fetchRwaQuotes(catalog.assets.map((a) => a.quoteSymbol))
      setAssets(catalog.assets)
      setQuotes(quoteMap)
      setEligibility(catalog.eligibility)
      setSelectedId((cur) => cur ?? catalog.assets[0]?.id ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Catalog unavailable")
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // Load related Polymarket markets when asset changes
  useEffect(() => {
    if (!selectedAsset) return
    setRelatedMarkets([])
    setRelatedLoading(true)
    fetchRelatedMarkets(selectedAsset.id)
      .then(setRelatedMarkets)
      .catch(() => setRelatedMarkets([]))
      .finally(() => setRelatedLoading(false))
  }, [selectedAsset?.id])

  const handleSelectAsset = (id: string) => {
    setSelectedId(id)
    setDetailOpen(true)
  }

  const positive = (selectedQuote?.changePct ?? 0) >= 0

  return (
    <div className="terminal-grid-bg min-h-screen bg-background flex flex-col ambient-glow">
      <Navbar />

      <main className="relative z-[1] flex-1 mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 rawli-page-top pb-20 lg:pb-10">

        {/* ── Header ────────────────────────────────────────────────────── */}
        <div className="mb-5 sm:mb-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-[oklch(0.78_0.16_82/0.24)] bg-[oklch(0.78_0.16_82/0.08)] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-[oklch(0.82_0.16_82)]">
                <Zap className="h-3 w-3" />
                Tokenized Stocks · Beta
              </div>
              <h1 className="mt-2 sm:mt-3 text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight text-foreground">
                Global equities via BNB Chain
              </h1>
              <p className="mt-1 text-sm text-muted-foreground max-w-xl">
                Live quotes on US stocks and ETFs. Buy routing via Ondo RWA rails — coming soon.
              </p>
            </div>
            <button
              type="button"
              onClick={() => load(true)}
              disabled={refreshing}
              className="shrink-0 flex items-center gap-1.5 h-9 px-3 rounded-xl border border-[oklch(0.22_0.015_255)] bg-[oklch(0.14_0.013_255)] text-xs font-semibold text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
          </div>

          {/* Stats strip */}
          <div className="mt-3 grid grid-cols-3 gap-2 sm:gap-3">
            {[
              { label: "Assets", value: assets.length > 0 ? String(assets.length) : "--", icon: TrendingUp },
              {
                label: "Ondo route",
                value: eligibility?.ondo.status === "eligible" ? "✓ Eligible" :
                       eligibility?.ondo.status === "blocked" ? "✗ Blocked" :
                       eligibility?.ondo.status === "qualified_investor_only" ? "Qualified only" :
                       "KYC required",
                icon: Wallet,
                green: eligibility?.ondo.status === "eligible",
              },
              {
                label: "xStocks route",
                value: eligibility?.backed.status === "available" ? "✓ Available" :
                       eligibility?.backed.status === "blocked" ? "✗ Blocked" :
                       "Checking…",
                icon: Brain,
                green: eligibility?.backed.status === "available",
              },
            ].map(({ label, value, icon: Icon, green }) => (
              <div key={label} className={cn(
                "rounded-xl border px-3 py-2.5",
                green
                  ? "border-[oklch(0.68_0.18_155/0.25)] bg-[oklch(0.68_0.18_155/0.06)]"
                  : "border-[oklch(0.22_0.015_255/0.72)] bg-[oklch(0.10_0.012_260/0.62)]"
              )}>
                <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60">
                  <Icon className="h-3 w-3" />{label}
                </div>
                <div className={cn("mt-1.5 text-sm font-bold", green ? "text-[oklch(0.68_0.18_155)]" : "text-foreground")}>{value}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-[1fr_360px] xl:grid-cols-[1fr_400px]">

          {/* ── Left: asset grid ──────────────────────────────────────── */}
          <section className="space-y-4">
            {/* Search + sector filters */}
            <div className="space-y-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search stocks, ETFs…"
                  className="w-full h-10 pl-9 pr-9 rounded-xl border border-[oklch(0.22_0.015_255)] bg-[oklch(0.13_0.012_260)] text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-[oklch(0.78_0.16_82/0.4)] transition-colors"
                />
                {search && (
                  <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2">
                    <X className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                  </button>
                )}
              </div>

              {/* Sector pill scroll */}
              <div className="flex gap-2 overflow-x-auto no-scrollbar pb-0.5">
                {SECTOR_GROUPS.map((sg) => (
                  <button
                    key={sg}
                    type="button"
                    onClick={() => setActiveSector(sg)}
                    className={cn(
                      "shrink-0 h-8 px-3 rounded-full text-[11px] font-bold uppercase tracking-wide transition-all",
                      activeSector === sg
                        ? "bg-[oklch(0.78_0.16_82)] text-[oklch(0.10_0.012_260)] shadow-[0_2px_8px_oklch(0.78_0.16_82/0.3)]"
                        : "border border-[oklch(0.22_0.015_255)] bg-[oklch(0.12_0.012_260)] text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {sg}
                  </button>
                ))}
              </div>
            </div>

            {/* Error state */}
            {error && (
              <div className="rounded-xl border border-[oklch(0.60_0.18_25/0.36)] bg-[oklch(0.60_0.18_25/0.08)] p-3 text-sm text-[oklch(0.72_0.18_25)] flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                {error}
              </div>
            )}

            {/* Asset grid */}
            <div className="grid gap-2.5 sm:gap-3 grid-cols-1 sm:grid-cols-2">
              {loading
                ? Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="h-[130px] rounded-2xl shimmer" style={{ animationDelay: `${i * 60}ms` }} />
                  ))
                : filteredAssets.length === 0
                ? (
                    <div className="col-span-2 rounded-2xl border border-dashed border-[oklch(0.22_0.015_255)] p-8 text-center text-sm text-muted-foreground">
                      No assets match your search.
                    </div>
                  )
                : filteredAssets.map((asset) => (
                    <AssetCard
                      key={asset.id}
                      asset={asset}
                      quote={quotes[asset.quoteSymbol]}
                      selected={selectedAsset?.id === asset.id}
                      onSelect={() => handleSelectAsset(asset.id)}
                    />
                  ))}
            </div>
          </section>

          {/* ── Right: detail panel (desktop sticky, mobile sheet) ─────── */}
          {/* Desktop */}
          <aside className="hidden lg:block">
            {selectedAsset ? (
              <DetailPanel
                asset={selectedAsset}
                quote={selectedQuote}
                relatedMarkets={relatedMarkets}
                relatedLoading={relatedLoading}
                positive={positive}
              />
            ) : (
              <div className="rounded-2xl border border-[oklch(0.22_0.015_255/0.72)] bg-[oklch(0.11_0.012_260/0.92)] p-6 text-center text-sm text-muted-foreground sticky top-24 min-h-[300px] flex items-center justify-center">
                Select an asset to see details
              </div>
            )}
          </aside>
        </div>
      </main>

      {/* ── Mobile: sticky bottom CTA ─────────────────────────────────── */}
      {selectedAsset && (
        <div className="lg:hidden fixed bottom-0 inset-x-0 z-40 glass-surface border-t border-[oklch(0.28_0.016_255/0.55)] safe-bottom">
          <div className="flex items-center gap-2 px-4 py-2.5 max-w-7xl mx-auto">
            <AssetMark asset={selectedAsset} size="sm" />
            <div className="flex-1 min-w-0">
              <div className="font-mono text-sm font-bold text-foreground">{selectedAsset.displaySymbol}</div>
              <div className={cn("text-[11px] font-bold tabular-nums", positive ? "text-[oklch(0.68_0.18_155)]" : "text-[oklch(0.62_0.18_25)]")}>
                {formatMoney(selectedQuote?.price)} {formatPct(selectedQuote?.changePct)}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setDetailOpen(true)}
              className="h-9 px-4 rounded-xl bg-[oklch(0.78_0.16_82)] text-[oklch(0.10_0.012_260)] text-[11px] font-bold active:scale-95 transition-transform"
            >
              Details
            </button>
          </div>
        </div>
      )}

      {/* ── Mobile: detail sheet ──────────────────────────────────────── */}
      {detailOpen && selectedAsset && (
        <div className="lg:hidden fixed inset-0 z-50 flex flex-col">
          <button
            type="button"
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setDetailOpen(false)}
          />
          <div className="relative mt-auto max-h-[90dvh] overflow-y-auto rounded-t-3xl border-t border-[oklch(0.28_0.016_255/0.55)] bg-[oklch(0.11_0.012_260)]">
            <div className="sticky top-0 z-10 flex items-center justify-between bg-[oklch(0.11_0.012_260)] px-5 pt-4 pb-3 border-b border-[oklch(0.22_0.015_255/0.5)]">
              <div className="h-1 w-10 rounded-full bg-[oklch(0.30_0.016_255)] mx-auto absolute left-1/2 -translate-x-1/2 top-2" />
              <span className="font-mono font-bold text-foreground">{selectedAsset.displaySymbol}</span>
              <button onClick={() => setDetailOpen(false)} className="h-8 w-8 flex items-center justify-center rounded-lg border border-[oklch(0.22_0.015_255)] text-muted-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-4">
              <DetailPanel
                asset={selectedAsset}
                quote={selectedQuote}
                relatedMarkets={relatedMarkets}
                relatedLoading={relatedLoading}
                positive={positive}
              />
            </div>
          </div>
        </div>
      )}

      <Footer />
    </div>
  )
}

// ─── Detail panel (shared desktop + mobile sheet) ────────────────────────────
function DetailPanel({ asset, quote, relatedMarkets, relatedLoading, positive }: {
  asset: RwaAsset
  quote?: RwaQuote
  relatedMarkets: RelatedMarket[]
  relatedLoading: boolean
  positive: boolean
}) {
  return (
    <div className="space-y-3 lg:sticky lg:top-24">
      {/* Asset header */}
      <div className="rounded-2xl border border-[oklch(0.25_0.016_255/0.78)] bg-[oklch(0.11_0.012_260/0.92)] p-4 sm:p-5">
        <div className="flex items-center gap-3">
          <AssetMark asset={asset} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="font-mono text-2xl font-bold text-foreground">{asset.displaySymbol}</h2>
              <span className={cn(
                "rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide",
                asset.assetClass === "etf"
                  ? "bg-[oklch(0.62_0.17_250/0.12)] text-[oklch(0.72_0.16_250)]"
                  : "bg-[oklch(0.78_0.16_82/0.12)] text-[oklch(0.82_0.16_82)]"
              )}>
                {asset.assetClass}
              </span>
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">{asset.name}</p>
          </div>
        </div>

        {/* Price block */}
        <div className="mt-4 rounded-xl border border-[oklch(0.22_0.015_255/0.72)] bg-[oklch(0.08_0.01_260/0.62)] p-4">
          <div className="flex items-end justify-between gap-3">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 mb-1">Live Quote</div>
              <div className="font-mono text-4xl font-semibold text-foreground leading-none">
                {formatMoney(quote?.price, quote?.currency)}
              </div>
              <div className="mt-2 flex items-center gap-3">
                <span className={cn(
                  "flex items-center gap-1 text-sm font-bold",
                  positive ? "text-[oklch(0.68_0.18_155)]" : "text-[oklch(0.62_0.18_25)]"
                )}>
                  {positive ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                  {formatPct(quote?.changePct)}
                </span>
                <span className="text-[11px] text-muted-foreground">{formatMoney(quote?.change)}</span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] text-muted-foreground">{quote?.source ?? "Yahoo Finance"}</div>
              <div className="text-[11px] font-semibold mt-0.5" style={{ color: positive ? "oklch(0.68 0.18 155)" : "oklch(0.62 0.18 25)" }}>
                {quote ? timeAgo(quote.fetchedAt) : "Pending"}
              </div>
              {quote?.delayed && <div className="text-[9px] text-muted-foreground/50 mt-0.5">15-min delayed</div>}
            </div>
          </div>

          {/* Change bar */}
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[oklch(0.18_0.014_255)]">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${Math.min(95, Math.max(5, Math.abs(quote?.changePct ?? 0) * 15 + 20))}%`,
                background: positive ? "oklch(0.68 0.18 155)" : "oklch(0.62 0.18 25)",
              }}
            />
          </div>
        </div>

        {/* Theme read */}
        <div className="mt-3 rounded-xl border border-[oklch(0.22_0.015_255/0.72)] bg-[oklch(0.08_0.01_260/0.54)] p-3.5">
          <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 mb-2">Rawli Read</div>
          <p className="text-sm leading-relaxed text-foreground">{asset.theme}</p>
          <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
            Full AI analysis — catalysts, regime, volatility, and tokenized route risk — coming in the next update.
          </p>
        </div>

        {/* Sector + risk */}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-[oklch(0.22_0.015_255/0.5)] bg-[oklch(0.09_0.01_260/0.5)] p-2.5">
            <div className="text-[9px] uppercase tracking-widest text-muted-foreground/50 font-bold">Sector</div>
            <div className="mt-1 text-xs font-semibold text-foreground">{asset.sector}</div>
          </div>
          <div className="rounded-lg border border-[oklch(0.22_0.015_255/0.5)] bg-[oklch(0.09_0.01_260/0.5)] p-2.5">
            <div className="text-[9px] uppercase tracking-widest text-muted-foreground/50 font-bold">Beta</div>
            <div className={cn("mt-1 text-xs font-semibold", asset.risk === "high" ? "text-[oklch(0.68_0.18_25)]" : "text-[oklch(0.68_0.18_155)]")}>
              {asset.risk === "high" ? "High" : "Medium"}
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled
            className="flex h-11 items-center justify-center gap-2 rounded-xl bg-[oklch(0.78_0.16_82/0.40)] text-[oklch(0.10_0.012_260)] text-sm font-bold opacity-60 cursor-not-allowed"
          >
            <Brain className="h-4 w-4" />
            AI Analysis
          </button>
          <button
            type="button"
            disabled
            className="flex h-11 items-center justify-center gap-2 rounded-xl border border-[oklch(0.22_0.015_255)] bg-[oklch(0.13_0.012_260)] text-muted-foreground text-sm font-bold opacity-60 cursor-not-allowed"
          >
            <Wallet className="h-4 w-4" />
            Buy soon
          </button>
        </div>

        {/* Eligibility note */}
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-[oklch(0.68_0.18_155/0.22)] bg-[oklch(0.68_0.18_155/0.06)] p-2.5">
          <Zap className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[oklch(0.68_0.18_155)]" />
          <p className="text-[11px] leading-4 text-[oklch(0.72_0.10_155)]">
            Nigeria is eligible for both Ondo and xStocks routes. No jurisdiction block applies. KYC integration is the final step before buy routing goes live.
          </p>
        </div>
      </div>

      {/* Related Polymarket prediction markets */}
      {(relatedMarkets.length > 0 || relatedLoading) && (
        <div className="rounded-2xl border border-[oklch(0.22_0.015_255/0.72)] bg-[oklch(0.10_0.012_260/0.82)] p-4">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
              Related Prediction Markets
            </div>
            <Link
              href={`/?q=${encodeURIComponent(asset.polymarketKeyword ?? asset.displaySymbol)}`}
              className="flex items-center gap-1 text-[10px] text-[oklch(0.78_0.16_82)] hover:underline"
            >
              View all <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>
          {relatedLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => <div key={i} className="h-16 rounded-xl shimmer" />)}
            </div>
          ) : (
            <div className="space-y-2">
              {relatedMarkets.map((m) => <RelatedMarketChip key={m.id} market={m} />)}
            </div>
          )}
        </div>
      )}

      {/* Back link */}
      <Link
        href="/"
        className="flex h-10 items-center justify-center gap-2 rounded-xl border border-[oklch(0.22_0.015_255)] bg-[oklch(0.12_0.012_260)] text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
      >
        Back to prediction markets <ChevronRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  )
}
