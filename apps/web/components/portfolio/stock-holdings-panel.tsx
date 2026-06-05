"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  TrendingUp, TrendingDown, RefreshCw, ExternalLink,
  Wallet, BarChart3, ArrowUpRight, Clock, Loader2,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { StockHolding, StockHoldingsState } from "@/hooks/use-stock-holdings"

// ─── Formatters ───────────────────────────────────────────────────────────────

function fmt$(value: number, opts?: { compact?: boolean }) {
  if (!Number.isFinite(value)) return "--"
  if (opts?.compact) {
    if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`
    if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(2)}K`
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(value)
}

function fmtPct(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`
}

function fmtShares(n: number) {
  if (!Number.isFinite(n) || n === 0) return "0"
  if (n < 0.001) return n.toExponential(2)
  if (n < 1) return n.toFixed(4)
  return n.toLocaleString("en-US", { maximumFractionDigits: 4 })
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ walletConnected }: { walletConnected: boolean }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-[oklch(0.22_0.015_255)] p-8 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[oklch(0.22_0.015_255)] bg-[oklch(0.14_0.013_255)]">
        <BarChart3 className="h-6 w-6 text-muted-foreground/60" />
      </div>
      {walletConnected ? (
        <>
          <div>
            <p className="font-semibold text-foreground">No stock holdings yet</p>
            <p className="mt-1 text-sm text-muted-foreground max-w-xs">
              Buy US stocks and ETFs on the Stocks page. Your holdings will show up here instantly.
            </p>
          </div>
          <Link
            href="/stocks"
            className="flex items-center gap-2 rounded-xl bg-[oklch(0.78_0.16_82)] px-5 py-2.5 text-sm font-bold text-[oklch(0.10_0.012_260)] hover:bg-[oklch(0.83_0.16_82)] transition-colors"
          >
            Browse stocks
            <ArrowUpRight className="h-4 w-4" />
          </Link>
        </>
      ) : (
        <>
          <div>
            <p className="font-semibold text-foreground">Connect your wallet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Connect to see your stock holdings and track P&amp;L.
            </p>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Single holding row ───────────────────────────────────────────────────────

function HoldingCard({ holding, onTrade }: { holding: StockHolding; onTrade: (symbol: string) => void }) {
  const { asset, quote, balance, value, dayPnl, dayPnlPct, isUp } = holding

  const priceColor = isUp
    ? "text-[oklch(0.68_0.18_155)]"
    : "text-[oklch(0.62_0.18_25)]"
  const pnlBg = isUp
    ? "bg-[oklch(0.68_0.18_155/0.08)] border-[oklch(0.68_0.18_155/0.20)]"
    : "bg-[oklch(0.62_0.18_25/0.08)] border-[oklch(0.62_0.18_25/0.20)]"

  // Asset initials for fallback icon
  const initials = asset.displaySymbol.slice(0, 3)

  return (
    <div className="group rounded-2xl border border-[oklch(0.20_0.014_255/0.8)] bg-[oklch(0.115_0.012_260/0.95)] p-4 transition-all hover:border-[oklch(0.28_0.016_255)]">
      {/* Top row: symbol + value */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          {/* Asset mark */}
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border text-[11px] font-bold"
            style={{
              background: `${asset.accent ?? "oklch(0.78 0.16 82)"}/0.12`,
              borderColor: `${asset.accent ?? "oklch(0.78 0.16 82)"}/0.30`,
              color: asset.accent ?? "oklch(0.78 0.16 82)",
            }}
          >
            {initials}
          </div>
          <div className="min-w-0">
            <div className="font-bold text-foreground leading-tight">{asset.displaySymbol}</div>
            <div className="text-[11px] text-muted-foreground truncate max-w-[120px] sm:max-w-none">{asset.name}</div>
          </div>
        </div>

        {/* Current value */}
        <div className="text-right shrink-0">
          <div className="font-bold text-foreground tabular-nums">{fmt$(value)}</div>
          <div className={cn("text-[11px] font-semibold tabular-nums", priceColor)}>
            {dayPnl >= 0 ? "+" : ""}{fmt$(dayPnl)} today
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="mt-3 grid grid-cols-3 gap-2">
        <div className="rounded-xl border border-[oklch(0.20_0.014_255)] bg-[oklch(0.09_0.01_260/0.5)] p-2">
          <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60 mb-0.5">Price</div>
          <div className="font-mono text-[13px] font-bold text-foreground tabular-nums">
            {quote?.price != null ? fmt$(quote.price) : "--"}
          </div>
        </div>
        <div className="rounded-xl border border-[oklch(0.20_0.014_255)] bg-[oklch(0.09_0.01_260/0.5)] p-2">
          <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60 mb-0.5">Shares</div>
          <div className="font-mono text-[13px] font-bold text-foreground tabular-nums">{fmtShares(balance)}</div>
        </div>
        <div className={cn("rounded-xl border p-2", pnlBg)}>
          <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60 mb-0.5">Day</div>
          <div className={cn("font-mono text-[13px] font-bold tabular-nums flex items-center gap-0.5", priceColor)}>
            {isUp
              ? <TrendingUp className="h-3 w-3 shrink-0" />
              : <TrendingDown className="h-3 w-3 shrink-0" />
            }
            {fmtPct(dayPnlPct)}
          </div>
        </div>
      </div>

      {/* Action row */}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => onTrade(asset.displaySymbol)}
          className="flex-1 flex items-center justify-center gap-1.5 h-9 rounded-xl bg-[oklch(0.78_0.16_82)] text-[oklch(0.10_0.012_260)] text-[12px] font-bold hover:bg-[oklch(0.83_0.16_82)] transition-colors active:scale-[0.98]"
        >
          Trade
          <ArrowUpRight className="h-3.5 w-3.5" />
        </button>
        {quote?.source && (
          <div className="flex items-center gap-1 rounded-xl border border-[oklch(0.20_0.014_255)] px-3 text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60">
            {quote.delayed ? <Clock className="h-2.5 w-2.5" /> : <span className="h-1.5 w-1.5 rounded-full bg-[oklch(0.68_0.18_155)] inline-block" />}
            {quote.delayed ? "Delayed" : "Live"}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Summary banner ───────────────────────────────────────────────────────────

function SummaryBanner({
  totalValue, totalDayPnl, totalDayPnlPct, count
}: {
  totalValue: number; totalDayPnl: number; totalDayPnlPct: number; count: number
}) {
  const isUp = totalDayPnl >= 0

  return (
    <div className="rounded-2xl border border-[oklch(0.22_0.015_255)] bg-[oklch(0.115_0.012_260/0.95)] p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
            Stock portfolio · {count} holding{count !== 1 ? "s" : ""}
          </div>
          <div className="mt-1.5 text-3xl font-bold text-foreground tabular-nums leading-none">
            {fmt$(totalValue, { compact: true })}
          </div>
        </div>
        <div className={cn(
          "flex flex-col items-end shrink-0 rounded-2xl border px-4 py-2.5",
          isUp
            ? "border-[oklch(0.68_0.18_155/0.25)] bg-[oklch(0.68_0.18_155/0.07)]"
            : "border-[oklch(0.62_0.18_25/0.25)] bg-[oklch(0.62_0.18_25/0.07)]"
        )}>
          <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60">Today</div>
          <div className={cn(
            "mt-0.5 font-mono text-lg font-bold tabular-nums",
            isUp ? "text-[oklch(0.68_0.18_155)]" : "text-[oklch(0.62_0.18_25)]"
          )}>
            {isUp ? "+" : ""}{fmt$(totalDayPnl)}
          </div>
          <div className={cn(
            "font-mono text-[11px] font-semibold",
            isUp ? "text-[oklch(0.68_0.18_155)]" : "text-[oklch(0.62_0.18_25)]"
          )}>
            {fmtPct(totalDayPnlPct)}
          </div>
        </div>
      </div>

      {/* P&L note */}
      <p className="mt-3 text-[10px] text-muted-foreground/60">
        Day P&amp;L based on today's price change vs previous close.
      </p>
    </div>
  )
}

// ─── Main exported panel ──────────────────────────────────────────────────────

interface StockHoldingsPanelProps extends StockHoldingsState {
  walletAddress: string | null
}

export function StockHoldingsPanel({
  holdings,
  totalValue,
  totalDayPnl,
  totalDayPnlPct,
  loading,
  error,
  refresh,
  lastUpdated,
  walletAddress,
}: StockHoldingsPanelProps) {
  const router = useRouter()

  const goToTrade = (symbol: string) => {
    router.push(`/stocks?trade=${symbol}`)
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-[oklch(0.78_0.16_82)]" />
          <span className="text-sm font-bold text-foreground">Stock Holdings</span>
        </div>
        <div className="flex items-center gap-2">
          {lastUpdated && (
            <span className="hidden sm:block text-[10px] text-muted-foreground/60">
              Updated {lastUpdated.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="flex h-8 items-center gap-1.5 rounded-xl border border-[oklch(0.22_0.015_255)] bg-[oklch(0.14_0.013_255)] px-2.5 text-[11px] font-semibold text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
            Refresh
          </button>
        </div>
      </div>

      {/* Loading */}
      {loading && holdings.length === 0 && (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Reading your holdings…
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div className="rounded-xl border border-[oklch(0.58_0.2_25/0.30)] bg-[oklch(0.58_0.2_25/0.07)] p-4 text-sm text-[oklch(0.72_0.18_25)]">
          {error}
        </div>
      )}

      {/* No wallet */}
      {!walletAddress && !loading && (
        <EmptyState walletConnected={false} />
      )}

      {/* Loaded — has holdings */}
      {!loading && !error && walletAddress && holdings.length > 0 && (
        <>
          <SummaryBanner
            totalValue={totalValue}
            totalDayPnl={totalDayPnl}
            totalDayPnlPct={totalDayPnlPct}
            count={holdings.length}
          />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {holdings.map((h) => (
              <HoldingCard key={h.asset.id} holding={h} onTrade={goToTrade} />
            ))}
          </div>
        </>
      )}

      {/* Loaded — empty */}
      {!loading && !error && walletAddress && holdings.length === 0 && (
        <EmptyState walletConnected={true} />
      )}

      {/* Wallet info footer */}
      {walletAddress && (
        <div className="flex items-center gap-2 rounded-xl border border-[oklch(0.20_0.014_255)] bg-[oklch(0.11_0.012_260/0.5)] px-4 py-2.5">
          <Wallet className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
          <span className="text-[11px] text-muted-foreground/70 font-mono">
            {walletAddress.slice(0, 8)}…{walletAddress.slice(-6)}
          </span>
          <a
            href={`https://bscscan.com/address/${walletAddress}`}
            target="_blank"
            rel="noreferrer"
            className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
          >
            View on BscScan
            <ExternalLink className="h-2.5 w-2.5" />
          </a>
        </div>
      )}
    </div>
  )
}
