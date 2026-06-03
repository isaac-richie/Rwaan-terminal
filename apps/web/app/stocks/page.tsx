"use client"

import { useEffect, useMemo, useState, useCallback } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { BrowserProvider, Contract, formatUnits as formatTokenUnits } from "ethers"
import { usePrivy, type ConnectedWallet } from "@privy-io/react-auth"
import {
  Activity, BadgeDollarSign, BarChart3,
  AlertTriangle, ArrowUpRight, Brain, ChevronDown, ChevronRight,
  Clock3, Cpu, ExternalLink, Landmark, Layers3, RefreshCw, Search, TrendingDown,
  TrendingUp, Wallet, X, Zap, ArrowDownUp, Loader2, ShieldCheck, Sparkles,
  type LucideIcon,
} from "lucide-react"
import { Navbar } from "@/components/navbar"
import { Footer } from "@/components/footer"
import { cn } from "@/lib/utils"
import { useActivePrivyWallet } from "@/hooks/use-active-privy-wallet"
import { friendlyErrorMessage } from "@/lib/friendly-errors"
import {
  fetchRwaAssets, fetchRwaQuotes, fetchRelatedMarkets, fetchRwaRouteHealth, fetchRwaSwapQuote,
  type RwaAsset, type RwaQuote, type RelatedMarket, type RwaSwapQuote,
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

function routeLabel(route?: RwaAsset["route"]) {
  if (!route) return "Checking route"
  if (route.exitVerified) return "Live"
  if (route.status === "blocked") return "Region blocked"
  if (route.status === "watch_only") return "Watch only"
  if (route.status === "route_unsafe") return "Thin liquidity"
  if (route.status === "quote_adapter_unavailable") return "Route offline"
  return "Buy/Sell locked"
}

function routeTone(route?: RwaAsset["route"]) {
  if (route?.exitVerified) return "positive"
  if (route?.status === "watch_only" || route?.status === "blocked") return "danger"
  return "gold"
}

const BSC_CHAIN_ID = 56
const BSC_CHAIN_HEX = "0x38"
const BSC_CHAIN_PARAMS = {
  chainId: BSC_CHAIN_HEX,
  chainName: "BNB Smart Chain",
  nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
  rpcUrls: ["https://bsc-dataseed.binance.org", "https://bsc.publicnode.com"],
  blockExplorerUrls: ["https://bscscan.com"],
}

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner,address spender) view returns (uint256)",
  "function approve(address spender,uint256 amount) returns (bool)",
]

const PANCAKE_V3_ROUTER_ABI = [
  "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
]

type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
}

type SwitchableWallet = ConnectedWallet & {
  switchChain?: (chainId: number) => Promise<void>
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function rawToHuman(raw?: string | null, decimals = 18, max = 6) {
  if (!raw) return "--"
  try {
    const value = Number(formatTokenUnits(raw, decimals))
    if (!Number.isFinite(value)) return "--"
    return value.toLocaleString("en-US", { maximumFractionDigits: max })
  } catch {
    return "--"
  }
}

function shortHash(value?: string | null) {
  if (!value) return ""
  return `${value.slice(0, 8)}...${value.slice(-6)}`
}

async function waitForChain(provider: Eip1193Provider, targetHex: string, attempts = 15) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const chainId = await provider.request({ method: "eth_chainId" }).catch(() => null)
    if (String(chainId).toLowerCase() === targetHex) return true
    await sleep(250)
  }
  return false
}

async function ensureBscWallet(wallet: ConnectedWallet): Promise<Eip1193Provider> {
  const switchable = wallet as SwitchableWallet
  let provider = (await wallet.getEthereumProvider()) as Eip1193Provider
  const currentChain = await provider.request({ method: "eth_chainId" }).catch(() => null)
  if (String(currentChain).toLowerCase() === BSC_CHAIN_HEX) return provider

  if (typeof switchable.switchChain === "function") {
    try {
      await switchable.switchChain(BSC_CHAIN_ID)
      await sleep(450)
      provider = (await wallet.getEthereumProvider()) as Eip1193Provider
      if (await waitForChain(provider, BSC_CHAIN_HEX)) return provider
    } catch {
      // Fall through to provider-level switching.
    }
  }

  provider = (await wallet.getEthereumProvider()) as Eip1193Provider
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: BSC_CHAIN_HEX }],
    })
  } catch (err: any) {
    const code = Number(err?.code ?? err?.data?.code)
    if (code !== 4902) throw err
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [BSC_CHAIN_PARAMS],
    })
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: BSC_CHAIN_HEX }],
    })
  }

  await sleep(350)
  provider = (await wallet.getEthereumProvider()) as Eip1193Provider
  if (!(await waitForChain(provider, BSC_CHAIN_HEX))) {
    throw new Error("Could not switch wallet to BNB Smart Chain.")
  }
  return provider
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
  const tone = routeTone(asset.route)
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
        <span
          className={cn(
            "ml-auto rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide",
            tone === "positive"
              ? "bg-[oklch(0.68_0.18_155/0.12)] text-[oklch(0.68_0.18_155)]"
              : tone === "danger"
              ? "bg-[oklch(0.60_0.18_25/0.12)] text-[oklch(0.68_0.18_25)]"
              : "bg-[oklch(0.78_0.16_82/0.12)] text-[oklch(0.82_0.16_82)]"
          )}
        >
          {asset.route?.token.symbol ?? routeLabel(asset.route)}
        </span>
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
type StockFilterKey =
  | "all"
  | "live"
  | "new"
  | "big-tech"
  | "ai"
  | "crypto"
  | "finance"
  | "etfs"
  | "consumer"
  | "global"
  | "healthcare"
  | "high-beta"
  | "watch"

type StockSortKey = "smart" | "volume" | "newest" | "movers" | "live"

const STOCK_FILTERS: Array<{ key: StockFilterKey; label: string; icon: LucideIcon }> = [
  { key: "all", label: "All", icon: Layers3 },
  { key: "live", label: "Live", icon: Activity },
  { key: "new", label: "New", icon: Sparkles },
  { key: "big-tech", label: "Big Tech", icon: BarChart3 },
  { key: "ai", label: "AI", icon: Cpu },
  { key: "crypto", label: "Crypto", icon: Zap },
  { key: "finance", label: "Finance", icon: Landmark },
  { key: "etfs", label: "ETFs", icon: BadgeDollarSign },
  { key: "consumer", label: "Consumer", icon: Wallet },
  { key: "global", label: "Global", icon: ArrowUpRight },
  { key: "healthcare", label: "Health", icon: ShieldCheck },
  { key: "high-beta", label: "High Beta", icon: TrendingUp },
  { key: "watch", label: "Watch", icon: ShieldCheck },
]

const STOCK_SORTS: Array<{ key: StockSortKey; label: string; icon: LucideIcon }> = [
  { key: "smart", label: "Smart Feed", icon: Sparkles },
  { key: "volume", label: "Volume", icon: BarChart3 },
  { key: "newest", label: "Newest", icon: Clock3 },
  { key: "movers", label: "Top Movers", icon: TrendingUp },
  { key: "live", label: "Live Route", icon: Activity },
]

const STOCK_BATCH_SIZE = 12

function matchesStockFilter(asset: RwaAsset, filter: StockFilterKey) {
  switch (filter) {
    case "live":
      return Boolean(asset.route?.exitVerified)
    case "new":
      return Boolean(asset.listedAt)
    case "big-tech":
      return asset.sectorGroup === "Big Tech"
    case "ai":
      return asset.sectorGroup === "AI & Chips" || asset.sector.toLowerCase().includes("ai")
    case "crypto":
      return asset.sectorGroup === "Crypto Equities" || asset.sector.toLowerCase().includes("crypto")
    case "finance":
      return asset.sectorGroup === "Finance"
    case "etfs":
      return asset.assetClass === "etf"
    case "consumer":
      return asset.sectorGroup === "Consumer & Internet"
    case "global":
      return asset.sectorGroup === "Global ADRs" || asset.sector.toLowerCase().includes("emerging")
    case "healthcare":
      return asset.sectorGroup === "Healthcare"
    case "high-beta":
      return asset.risk === "high"
    case "watch":
      return !asset.route?.exitVerified
    case "all":
    default:
      return true
  }
}

function assetVolumeScore(asset: RwaAsset, quote?: RwaQuote) {
  if (typeof quote?.volume === "number" && Number.isFinite(quote.volume)) return quote.volume
  return Math.max(1, 100_000 - (asset.volumeRank ?? 999) * 1_000)
}

function assetListedTime(asset: RwaAsset) {
  return asset.listedAt ? new Date(asset.listedAt).getTime() : 0
}

// ─── Main page ───────────────────────────────────────────────────────────────
export default function StocksPage() {
  const { login } = usePrivy()
  const { wallet, walletAddress, authenticated } = useActivePrivyWallet()
  const [assets, setAssets] = useState<RwaAsset[]>([])
  const [quotes, setQuotes] = useState<Record<string, RwaQuote>>({})
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [activeFilter, setActiveFilter] = useState<StockFilterKey>("all")
  const [sortBy, setSortBy] = useState<StockSortKey>("smart")
  const [sortOpen, setSortOpen] = useState(false)
  const [visibleAssetCount, setVisibleAssetCount] = useState(STOCK_BATCH_SIZE)
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [quoteError, setQuoteError] = useState<string | null>(null)
  const [relatedMarkets, setRelatedMarkets] = useState<RelatedMarket[]>([])
  const [relatedLoading, setRelatedLoading] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const [tradeRequest, setTradeRequest] = useState<{ asset: RwaAsset; side: "buy" | "sell" } | null>(null)

  const selectedAsset = useMemo(
    () => assets.find((a) => a.id === selectedId) ?? null,
    [assets, selectedId]
  )
  const selectedQuote = selectedAsset ? quotes[selectedAsset.quoteSymbol] : undefined
  const mappedCount = useMemo(
    () => assets.filter((asset) => Boolean(asset.route?.token.address)).length,
    [assets]
  )
  const exitVerifiedCount = useMemo(
    () => assets.filter((asset) => asset.route?.exitVerified).length,
    [assets]
  )
  const filterCounts = useMemo(() => {
    return Object.fromEntries(
      STOCK_FILTERS.map((filter) => [
        filter.key,
        assets.filter((asset) => matchesStockFilter(asset, filter.key)).length,
      ])
    ) as Record<StockFilterKey, number>
  }, [assets])

  const filteredAssets = useMemo(() => {
    const filtered = assets.filter((a) => {
      if (!matchesStockFilter(a, activeFilter)) return false
      if (search) {
        const q = search.toLowerCase()
        const searchable = [
          a.symbol,
          a.displaySymbol,
          a.name,
          a.sector,
          a.sectorGroup,
          a.theme,
          a.assetClass,
          a.risk,
          a.quoteSymbol,
          a.polymarketKeyword,
          a.route?.token.symbol,
          a.route?.copy.primary,
          a.route?.copy.secondary,
        ].filter(Boolean).join(" ").toLowerCase()
        return searchable.includes(q)
      }
      return true
    })

    return filtered.sort((a, b) => {
      const quoteA = quotes[a.quoteSymbol]
      const quoteB = quotes[b.quoteSymbol]
      const volumeA = assetVolumeScore(a, quoteA)
      const volumeB = assetVolumeScore(b, quoteB)
      const moveA = Math.abs(quoteA?.changePct ?? 0)
      const moveB = Math.abs(quoteB?.changePct ?? 0)
      const liveA = a.route?.exitVerified ? 1 : 0
      const liveB = b.route?.exitVerified ? 1 : 0
      const newestA = assetListedTime(a)
      const newestB = assetListedTime(b)

      if (sortBy === "volume") return volumeB - volumeA
      if (sortBy === "newest") return newestB - newestA || volumeB - volumeA
      if (sortBy === "movers") return moveB - moveA || volumeB - volumeA
      if (sortBy === "live") return liveB - liveA || volumeB - volumeA

      const smartA = liveA * 2_000_000 + volumeA + moveA * 25_000 + (newestA ? 100_000 : 0)
      const smartB = liveB * 2_000_000 + volumeB + moveB * 25_000 + (newestB ? 100_000 : 0)
      return smartB - smartA
    })
  }, [assets, activeFilter, search, quotes, sortBy])

  const visibleAssets = useMemo(
    () => filteredAssets.slice(0, visibleAssetCount),
    [filteredAssets, visibleAssetCount]
  )
  const hasMoreAssets = visibleAssetCount < filteredAssets.length
  const remainingAssetCount = Math.max(0, filteredAssets.length - visibleAssets.length)

  const load = useCallback(async (quiet = false) => {
    quiet ? setRefreshing(true) : setLoading(true)
    setError(null)
    setQuoteError(null)
    try {
      const catalog = await fetchRwaAssets("NG")
      setAssets(catalog.assets)
      setSelectedId((cur) => cur ?? catalog.assets[0]?.id ?? null)
      setLoading(false)

      try {
        const quoteMap = await fetchRwaQuotes(catalog.assets.map((a) => a.quoteSymbol))
        setQuotes(quoteMap)
      } catch {
        setQuoteError("Quotes are delayed. Rawli is showing the stock catalog with fallback ranking.")
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Catalog unavailable")
      setLoading(false)
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    setVisibleAssetCount(STOCK_BATCH_SIZE)
  }, [activeFilter, search, sortBy])

  useEffect(() => {
    if (!sortOpen) return
    const handle = (event: MouseEvent) => {
      if (!(event.target as HTMLElement).closest("[data-stock-sort-menu]")) setSortOpen(false)
    }
    window.addEventListener("mousedown", handle)
    return () => window.removeEventListener("mousedown", handle)
  }, [sortOpen])

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

  useEffect(() => {
    if (!selectedAsset) return
    if (selectedAsset.route?.copy.primary !== "Route check on select") return

    let cancelled = false
    fetchRwaRouteHealth(selectedAsset.displaySymbol, "NG")
      .then((route) => {
        if (!route || cancelled) return
        setAssets((current) => current.map((asset) =>
          asset.id === selectedAsset.id ? { ...asset, route } : asset
        ))
      })
      .catch(() => {})

    return () => { cancelled = true }
  }, [selectedAsset?.id, selectedAsset?.route?.copy.primary, selectedAsset?.displaySymbol])

  const handleSelectAsset = (id: string) => {
    setSelectedId(id)
    setDetailOpen(true)
  }

  const handleOpenTrade = (asset: RwaAsset, side: "buy" | "sell") => {
    setTradeRequest({ asset, side })
  }

  const positive = (selectedQuote?.changePct ?? 0) >= 0
  const currentSort = STOCK_SORTS.find((sort) => sort.key === sortBy) ?? STOCK_SORTS[0]
  const CurrentSortIcon = currentSort.icon

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
                Live quotes on US stocks and ETFs. Verified assets can now buy and sell through PancakeSwap V3.
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
                label: "Tokens mapped",
                value: assets.length > 0 ? `${mappedCount}/${assets.length}` : "--",
                icon: Wallet,
                green: mappedCount > 0,
              },
              {
                label: "Exit verified",
                value: exitVerifiedCount > 0 ? `${exitVerifiedCount} live` : "Locked",
                icon: ArrowDownUp,
                green: exitVerifiedCount > 0,
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
          <section className="min-w-0 space-y-4">
            {/* Search + stock lanes */}
            <div className="min-w-0 rounded-2xl border border-[oklch(0.22_0.015_255/0.72)] bg-[oklch(0.10_0.012_260/0.72)] p-3 sm:p-3.5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-[oklch(0.82_0.16_82)]" />
                  <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground/70">
                    Rawli lanes
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="font-mono text-[11px] text-muted-foreground">
                    {loading ? "--" : `${visibleAssets.length}/${filteredAssets.length}`}
                  </div>
                  <div className="relative shrink-0" data-stock-sort-menu>
                    <button
                      type="button"
                      aria-label={`Sort stocks by ${currentSort.label}`}
                      aria-expanded={sortOpen}
                      onClick={() => setSortOpen((value) => !value)}
                      className={cn(
                        "inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-[11px] font-bold uppercase tracking-wide transition-all active:scale-[0.97]",
                        sortOpen
                          ? "border-[oklch(0.78_0.16_82/0.45)] bg-[oklch(0.18_0.014_255)] text-foreground"
                          : "border-[oklch(0.22_0.015_255)] bg-[oklch(0.13_0.012_260)] text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <CurrentSortIcon className="h-3.5 w-3.5" />
                      <span className="sm:hidden">Sort</span>
                      <span className="hidden sm:inline">{currentSort.label}</span>
                      <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", sortOpen && "rotate-180")} />
                    </button>
                    {sortOpen && (
                      <div className="absolute right-0 top-full z-50 mt-2 w-44 overflow-hidden rounded-2xl border border-[oklch(0.24_0.016_255/0.75)] bg-[oklch(0.155_0.014_255/0.98)] p-1 shadow-[0_16px_48px_oklch(0_0_0/0.55)] backdrop-blur-xl">
                        {STOCK_SORTS.map((sort) => {
                          const Icon = sort.icon
                          return (
                            <button
                              key={sort.key}
                              type="button"
                              onClick={() => {
                                setSortBy(sort.key)
                                setSortOpen(false)
                              }}
                              className={cn(
                                "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[12px] font-semibold transition-colors",
                                sortBy === sort.key
                                  ? "bg-[oklch(0.78_0.16_82/0.10)] text-[oklch(0.84_0.16_82)]"
                                  : "text-muted-foreground hover:bg-[oklch(0.20_0.014_255)] hover:text-foreground"
                              )}
                            >
                              <Icon className="h-3.5 w-3.5" />
                              {sort.label}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="relative mt-3">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search ticker, company, theme…"
                  className="w-full h-11 pl-9 pr-9 rounded-xl border border-[oklch(0.22_0.015_255)] bg-[oklch(0.13_0.012_260)] text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-[oklch(0.78_0.16_82/0.4)] transition-colors"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:bg-[oklch(0.20_0.014_255)] hover:text-foreground"
                    aria-label="Clear stock search"
                  >
                    <X className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                  </button>
                )}
              </div>

              <div className="mt-3 flex min-w-0 gap-2 overflow-x-auto no-scrollbar pb-0.5">
                {STOCK_FILTERS.map((filter) => {
                  const Icon = filter.icon
                  const active = activeFilter === filter.key
                  return (
                  <button
                    key={filter.key}
                    type="button"
                    onClick={() => setActiveFilter(filter.key)}
                    className={cn(
                      "shrink-0 inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[11px] font-bold uppercase tracking-wide transition-all active:scale-[0.97]",
                      active
                        ? "bg-[oklch(0.78_0.16_82)] text-[oklch(0.10_0.012_260)] shadow-[0_2px_8px_oklch(0.78_0.16_82/0.3)]"
                        : "border border-[oklch(0.22_0.015_255)] bg-[oklch(0.12_0.012_260)] text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span>{filter.label}</span>
                    <span
                      className={cn(
                        "rounded-full px-1.5 py-0.5 font-mono text-[10px]",
                        active
                          ? "bg-[oklch(0.10_0.012_260/0.16)]"
                          : "bg-[oklch(0.22_0.015_255/0.80)] text-muted-foreground/80"
                      )}
                    >
                      {filterCounts[filter.key] ?? 0}
                    </span>
                  </button>
                )})}
              </div>
            </div>

            {/* Error state */}
            {error && (
              <div className="rounded-xl border border-[oklch(0.60_0.18_25/0.36)] bg-[oklch(0.60_0.18_25/0.08)] p-3 text-sm text-[oklch(0.72_0.18_25)] flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                {error}
              </div>
            )}

            {!error && quoteError && (
              <div className="rounded-xl border border-[oklch(0.78_0.16_82/0.30)] bg-[oklch(0.78_0.16_82/0.07)] p-3 text-xs leading-5 text-[oklch(0.78_0.14_82)] flex items-center gap-2">
                <Clock3 className="h-4 w-4 shrink-0" />
                {quoteError}
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
                    <div className="col-span-full rounded-2xl border border-dashed border-[oklch(0.22_0.015_255)] p-8 text-center text-sm text-muted-foreground">
                      No assets in this lane match your search.
                      {(search || activeFilter !== "all") && (
                        <button
                          type="button"
                          onClick={() => {
                            setSearch("")
                            setActiveFilter("all")
                          }}
                          className="mx-auto mt-4 flex h-9 items-center gap-2 rounded-xl border border-[oklch(0.78_0.16_82/0.32)] px-3 text-[11px] font-bold uppercase tracking-wide text-[oklch(0.82_0.16_82)] hover:bg-[oklch(0.78_0.16_82/0.08)]"
                        >
                          <X className="h-3.5 w-3.5" />
                          Reset filters
                        </button>
                      )}
                    </div>
                  )
                : visibleAssets.map((asset) => (
                    <AssetCard
                      key={asset.id}
                      asset={asset}
                      quote={quotes[asset.quoteSymbol]}
                      selected={selectedAsset?.id === asset.id}
                      onSelect={() => handleSelectAsset(asset.id)}
                    />
                  ))}
            </div>

            {!loading && filteredAssets.length > 0 && (
              <div className="flex flex-col items-center gap-3 pt-2">
                <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground/65">
                  Showing {visibleAssets.length} of {filteredAssets.length}
                </div>
                {hasMoreAssets && (
                  <button
                    type="button"
                    onClick={() => setVisibleAssetCount((count) => count + STOCK_BATCH_SIZE)}
                    className="inline-flex h-11 items-center gap-2 rounded-xl border border-[oklch(0.22_0.015_255)] bg-[oklch(0.14_0.013_255)] px-5 text-[12px] font-bold uppercase tracking-[0.12em] text-muted-foreground transition-all hover:border-[oklch(0.78_0.16_82/0.45)] hover:text-foreground active:scale-[0.98]"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Show {Math.min(STOCK_BATCH_SIZE, remainingAssetCount)} more
                  </button>
                )}
              </div>
            )}
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
                onTrade={(side) => handleOpenTrade(selectedAsset, side)}
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
                onTrade={(side) => handleOpenTrade(selectedAsset, side)}
              />
            </div>
          </div>
        </div>
      )}

      <RwaTradeModal
        request={tradeRequest}
        wallet={wallet}
        walletAddress={walletAddress}
        authenticated={authenticated}
        onConnect={login}
        onClose={() => setTradeRequest(null)}
      />

      <Footer />
    </div>
  )
}

// ─── Detail panel (shared desktop + mobile sheet) ────────────────────────────
function DetailPanel({ asset, quote, relatedMarkets, relatedLoading, positive, onTrade }: {
  asset: RwaAsset
  quote?: RwaQuote
  relatedMarkets: RelatedMarket[]
  relatedLoading: boolean
  positive: boolean
  onTrade?: (side: "buy" | "sell") => void
}) {
  const route = asset.route
  const routeStatusTone = routeTone(route)
  const canBuy = Boolean(route?.buy.enabled)
  const canSell = Boolean(route?.sell.enabled)
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

        {/* Buy/Sell route health */}
        <div className="mt-3 rounded-xl border border-[oklch(0.22_0.015_255/0.72)] bg-[oklch(0.08_0.01_260/0.54)] p-3.5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">Buy/Sell Route</div>
              <div className="mt-1 text-sm font-bold text-foreground">{route?.copy.primary ?? "Checking route"}</div>
            </div>
            <span
              className={cn(
                "shrink-0 rounded-full px-2 py-1 text-[9px] font-bold uppercase tracking-wide",
                routeStatusTone === "positive"
                  ? "bg-[oklch(0.68_0.18_155/0.12)] text-[oklch(0.68_0.18_155)]"
                  : routeStatusTone === "danger"
                  ? "bg-[oklch(0.60_0.18_25/0.12)] text-[oklch(0.68_0.18_25)]"
                  : "bg-[oklch(0.78_0.16_82/0.12)] text-[oklch(0.82_0.16_82)]"
              )}
            >
              {routeLabel(route)}
            </span>
          </div>

          <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
            {route?.copy.secondary ?? "Rawli checks both entry and exit before enabling stock trades."}
          </p>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-[oklch(0.22_0.015_255/0.5)] bg-[oklch(0.09_0.01_260/0.5)] p-2.5">
              <div className="text-[9px] uppercase tracking-widest text-muted-foreground/50 font-bold">Ondo token</div>
              <div className="mt-1 truncate text-xs font-semibold text-foreground">{route?.token.symbol ?? "Not mapped"}</div>
            </div>
            <div className="rounded-lg border border-[oklch(0.22_0.015_255/0.5)] bg-[oklch(0.09_0.01_260/0.5)] p-2.5">
              <div className="text-[9px] uppercase tracking-widest text-muted-foreground/50 font-bold">Pair asset</div>
              <div className="mt-1 text-xs font-semibold text-foreground">{route?.settlementAsset.symbol ?? "USDon"}</div>
            </div>
          </div>

          {route?.dex ? (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-[oklch(0.22_0.015_255/0.5)] bg-[oklch(0.09_0.01_260/0.5)] p-2.5">
                <div className="text-[9px] uppercase tracking-widest text-muted-foreground/50 font-bold">Venue</div>
                <div className="mt-1 text-xs font-semibold text-foreground">{route.dex.venue}</div>
              </div>
              <div className="rounded-lg border border-[oklch(0.22_0.015_255/0.5)] bg-[oklch(0.09_0.01_260/0.5)] p-2.5">
                <div className="text-[9px] uppercase tracking-widest text-muted-foreground/50 font-bold">Exit test</div>
                <div className="mt-1 text-xs font-semibold text-[oklch(0.68_0.18_155)]">{(route.dex.roundTripBps / 100).toFixed(1)}%</div>
              </div>
            </div>
          ) : null}

          {route?.token.address ? (
            <div className="mt-2 truncate rounded-lg border border-[oklch(0.22_0.015_255/0.42)] bg-[oklch(0.07_0.01_260/0.62)] px-2.5 py-2 font-mono text-[10px] text-muted-foreground">
              {route.token.address}
            </div>
          ) : null}
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
        <div className="mt-4 grid grid-cols-3 gap-2">
          <button
            type="button"
            disabled
            className="flex h-11 items-center justify-center gap-1.5 rounded-xl bg-[oklch(0.78_0.16_82/0.40)] text-[oklch(0.10_0.012_260)] text-xs font-bold opacity-60 cursor-not-allowed"
          >
            <Brain className="h-4 w-4" />
            Analyze
          </button>
          <button
            type="button"
            disabled={!canBuy}
            onClick={() => onTrade?.("buy")}
            className={cn(
              "flex h-11 items-center justify-center gap-1.5 rounded-xl text-xs font-bold transition-all",
              canBuy
                ? "bg-[oklch(0.68_0.18_155)] text-[oklch(0.08_0.01_260)] hover:brightness-110 active:scale-[0.98]"
                : "border border-[oklch(0.22_0.015_255)] bg-[oklch(0.13_0.012_260)] text-muted-foreground opacity-60 cursor-not-allowed"
            )}
          >
            <Wallet className="h-4 w-4" />
            Buy
          </button>
          <button
            type="button"
            disabled={!canSell}
            onClick={() => onTrade?.("sell")}
            className={cn(
              "flex h-11 items-center justify-center gap-1.5 rounded-xl text-xs font-bold transition-all",
              canSell
                ? "border border-[oklch(0.78_0.16_82/0.40)] bg-[oklch(0.78_0.16_82)] text-[oklch(0.08_0.01_260)] hover:brightness-110 active:scale-[0.98]"
                : "border border-[oklch(0.22_0.015_255)] bg-[oklch(0.13_0.012_260)] text-muted-foreground opacity-60 cursor-not-allowed"
            )}
          >
            <ArrowDownUp className="h-4 w-4" />
            Sell
          </button>
        </div>

        {/* Eligibility note */}
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-[oklch(0.78_0.16_82/0.22)] bg-[oklch(0.78_0.16_82/0.06)] p-2.5">
          <Zap className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[oklch(0.82_0.16_82)]" />
          <p className="text-[11px] leading-4 text-[oklch(0.78_0.12_82)]">
            Stock flow is buy and sell through secondary-market liquidity. Rawli unlocks Buy only after the Sell route is verified.
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

function RwaTradeModal({
  request,
  wallet,
  walletAddress,
  authenticated,
  onConnect,
  onClose,
}: {
  request: { asset: RwaAsset; side: "buy" | "sell" } | null
  wallet: ConnectedWallet | null
  walletAddress: string | null
  authenticated: boolean
  onConnect: () => void
  onClose: () => void
}) {
  const [amount, setAmount] = useState("")
  const [quote, setQuote] = useState<RwaSwapQuote | null>(null)
  const [status, setStatus] = useState<"idle" | "quoting" | "approving" | "swapping" | "confirming" | "done" | "error">("idle")
  const [error, setError] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)

  const asset = request?.asset ?? null
  const side = request?.side ?? "buy"
  const busy = ["quoting", "approving", "swapping", "confirming"].includes(status)
  const inputSymbol = side === "buy" ? "USDT" : asset?.route?.token.symbol ?? asset?.displaySymbol ?? "Stock"
  const outputSymbol = side === "buy" ? asset?.route?.token.symbol ?? asset?.displaySymbol ?? "Stock" : "USDT"
  const title = side === "buy" ? `Buy ${asset?.displaySymbol ?? ""}` : `Sell ${asset?.displaySymbol ?? ""}`

  useEffect(() => {
    if (!request) return
    setAmount(request.side === "buy" ? "10" : "0.01")
    setQuote(null)
    setStatus("idle")
    setError(null)
    setTxHash(null)
  }, [request?.asset.id, request?.side])

  if (!request || !asset) return null

  const previewQuote = async () => {
    if (!amount || Number(amount) <= 0) {
      setError("Enter a positive amount first.")
      return
    }

    setStatus("quoting")
    setError(null)
    setTxHash(null)
    try {
      const nextQuote = await fetchRwaSwapQuote({
        symbol: asset.displaySymbol,
        side,
        amount,
        slippageBps: 200,
      })
      setQuote(nextQuote)
      setStatus("idle")
    } catch (err) {
      setQuote(null)
      setStatus("error")
      setError(friendlyErrorMessage(err, "Rawli could not quote this stock route. Try again in a moment.", "trade"))
    }
  }

  const executeTrade = async () => {
    if (!authenticated || !wallet) {
      onConnect()
      return
    }

    const activeQuote = quote ?? await fetchRwaSwapQuote({
      symbol: asset.displaySymbol,
      side,
      amount,
      slippageBps: 200,
    })

    setQuote(activeQuote)
    setStatus("approving")
    setError(null)
    setTxHash(null)

    try {
      const provider = await ensureBscWallet(wallet)
      const ethersProvider = new BrowserProvider(provider as any)
      const signer = await ethersProvider.getSigner()
      const signerAddress = await signer.getAddress()
      const amountInRaw = BigInt(activeQuote.amountInRaw)

      const inputToken = new Contract(activeQuote.tokenIn.address, ERC20_ABI, signer)
      const balance = await inputToken.balanceOf(signerAddress) as bigint
      if (balance < amountInRaw) {
        throw new Error(`Not enough ${activeQuote.tokenIn.symbol} balance for this ${side}.`)
      }

      const allowance = await inputToken.allowance(signerAddress, activeQuote.spender) as bigint
      if (allowance < amountInRaw) {
        const approvalTx = await inputToken.approve(activeQuote.spender, amountInRaw)
        setStatus("approving")
        await approvalTx.wait(1)
      }

      setStatus("swapping")
      const router = new Contract(activeQuote.router, PANCAKE_V3_ROUTER_ABI, signer)
      const deadline = Math.floor(Date.now() / 1000) + 10 * 60
      const swapTx = await router.exactInputSingle({
        tokenIn: activeQuote.tokenIn.address,
        tokenOut: activeQuote.tokenOut.address,
        fee: activeQuote.fee,
        recipient: signerAddress,
        deadline,
        amountIn: amountInRaw,
        amountOutMinimum: BigInt(activeQuote.amountOutMinimumRaw),
        sqrtPriceLimitX96: 0n,
      })

      setStatus("confirming")
      const receipt = await swapTx.wait(1)
      setTxHash(receipt?.hash ?? swapTx.hash)
      setStatus("done")
    } catch (err) {
      setStatus("error")
      setError(friendlyErrorMessage(err, "Stock trade failed. Check balance, approval, and liquidity, then try again.", "trade"))
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center lg:items-center">
      <button
        type="button"
        aria-label="Close trade modal"
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={busy ? undefined : onClose}
      />
      <div className="relative w-full max-w-lg rounded-t-3xl border border-[oklch(0.25_0.016_255/0.78)] bg-[oklch(0.10_0.012_260)] p-4 shadow-[0_-20px_80px_oklch(0_0_0/0.55)] lg:rounded-2xl lg:p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full border border-[oklch(0.68_0.18_155/0.25)] bg-[oklch(0.68_0.18_155/0.08)] px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-[oklch(0.68_0.18_155)]">
              <ShieldCheck className="h-3 w-3" />
              Verified route
            </div>
            <h3 className="mt-2 text-2xl font-bold text-foreground">{title}</h3>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              PancakeSwap V3 · {asset.route?.settlementAsset.symbol ?? "USDT"} pair · {walletAddress ? shortHash(walletAddress) : "Wallet not connected"}
            </p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-[oklch(0.22_0.015_255)] text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 rounded-2xl border border-[oklch(0.22_0.015_255/0.72)] bg-[oklch(0.08_0.01_260/0.72)] p-3.5">
          <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
            You pay
          </label>
          <div className="mt-2 flex items-center gap-2">
            <input
              value={amount}
              onChange={(event) => {
                setAmount(event.target.value)
                setQuote(null)
                if (status === "error") {
                  setStatus("idle")
                  setError(null)
                }
              }}
              inputMode="decimal"
              placeholder="0.00"
              disabled={busy || status === "done"}
              className="h-12 min-w-0 flex-1 rounded-xl border border-[oklch(0.22_0.015_255)] bg-[oklch(0.13_0.012_260)] px-3 font-mono text-lg font-bold text-foreground outline-none focus:border-[oklch(0.78_0.16_82/0.45)] disabled:opacity-60"
            />
            <div className="flex h-12 min-w-[86px] items-center justify-center rounded-xl border border-[oklch(0.22_0.015_255)] bg-[oklch(0.12_0.012_260)] px-3 font-mono text-sm font-bold text-foreground">
              {inputSymbol}
            </div>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-[oklch(0.22_0.015_255/0.72)] bg-[oklch(0.08_0.01_260/0.62)] p-3">
            <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/50">Est. receive</div>
            <div className="mt-1 font-mono text-lg font-bold text-foreground">
              {quote ? rawToHuman(quote.amountOutRaw, quote.tokenOut.decimals) : "--"}
            </div>
            <div className="mt-0.5 text-[10px] text-muted-foreground">{outputSymbol}</div>
          </div>
          <div className="rounded-xl border border-[oklch(0.22_0.015_255/0.72)] bg-[oklch(0.08_0.01_260/0.62)] p-3">
            <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/50">Min receive</div>
            <div className="mt-1 font-mono text-lg font-bold text-foreground">
              {quote ? rawToHuman(quote.amountOutMinimumRaw, quote.tokenOut.decimals) : "--"}
            </div>
            <div className="mt-0.5 text-[10px] text-muted-foreground">2% slippage</div>
          </div>
        </div>

        {quote ? (
          <div className="mt-3 rounded-xl border border-[oklch(0.68_0.18_155/0.20)] bg-[oklch(0.68_0.18_155/0.06)] p-3 text-[11px] leading-5 text-[oklch(0.72_0.16_155)]">
            Fee tier {(quote.fee / 10_000).toFixed(2)}% · exit test {(quote.roundTripBps / 100).toFixed(1)}% · router {shortHash(quote.router)}
          </div>
        ) : null}

        {error ? (
          <div className="mt-3 flex gap-2 rounded-xl border border-[oklch(0.60_0.18_25/0.36)] bg-[oklch(0.60_0.18_25/0.08)] p-3 text-sm text-[oklch(0.72_0.18_25)]">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        {status === "done" ? (
          <div className="mt-3 rounded-xl border border-[oklch(0.68_0.18_155/0.30)] bg-[oklch(0.68_0.18_155/0.09)] p-3 text-sm text-[oklch(0.72_0.16_155)]">
            Trade confirmed{txHash ? (
              <>
                {" · "}
                <a className="font-mono underline" href={`https://bscscan.com/tx/${txHash}`} target="_blank" rel="noreferrer">
                  {shortHash(txHash)}
                </a>
              </>
            ) : null}
          </div>
        ) : null}

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={previewQuote}
            disabled={busy || status === "done"}
            className="flex h-12 items-center justify-center gap-2 rounded-xl border border-[oklch(0.22_0.015_255)] bg-[oklch(0.13_0.012_260)] text-sm font-bold text-foreground disabled:opacity-50"
          >
            {status === "quoting" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Preview
          </button>
          <button
            type="button"
            onClick={executeTrade}
            disabled={busy || status === "done" || !amount}
            className={cn(
              "flex h-12 items-center justify-center gap-2 rounded-xl text-sm font-bold transition-all disabled:opacity-50",
              side === "buy"
                ? "bg-[oklch(0.68_0.18_155)] text-[oklch(0.08_0.01_260)]"
                : "bg-[oklch(0.78_0.16_82)] text-[oklch(0.08_0.01_260)]"
            )}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />}
            {!authenticated || !wallet ? "Connect" : status === "approving" ? "Approve" : status === "swapping" ? "Swap" : side === "buy" ? "Buy" : "Sell"}
          </button>
        </div>
      </div>
    </div>
  )
}
