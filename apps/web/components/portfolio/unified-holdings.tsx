"use client"

/**
 * UnifiedHoldings — one beautiful list showing prediction market positions
 * and stock holdings together, with filter pills and a combined total.
 */

import { useState } from "react"
import { useRouter } from "next/navigation"
import {
  ArrowDownUp, ArrowUpRight, BarChart3, Clock3,
  Loader2, TrendingDown, TrendingUp, Zap,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { StockHolding } from "@/hooks/use-stock-holdings"

// ─── Types ────────────────────────────────────────────────────────────────────

type FilterType = "all" | "predictions" | "stocks"

// Props fed from the parent (portfolio page already computes these)
export interface UnifiedHoldingsProps {
  // Prediction positions
  openPositions: any[]
  // Stock holdings
  stockHoldings: StockHolding[]
  stocksLoading: boolean
  // Helpers from portfolio page
  formatMoney: (v: number) => string
  formatPnl: (v: number) => string
  formatPercent: (v: number | undefined) => string
  formatPrice: (v: any) => string
  formatPortfolioNumber: (v: number) => string
  formatTimeLeft: (d: any) => { label: string; urgency: string }
  positionLabel: (p: any) => string
  positionOutcome: (p: any) => string
  getPositionPnl: (p: any) => any
  getPositionPnlPercent: (p: any) => any
  getPositionValue: (p: any) => any
  getPositionEndTime: (p: any) => any
  // Actions
  onViewPosition: (pos: any, routeId: string | null) => void
  onSellPosition: (pos: any, routeId: string | null) => void
  marketRouteId: (pos: any) => string | null
  walletConnected: boolean
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtShares(n: number) {
  if (!Number.isFinite(n) || n === 0) return "0"
  if (n < 0.001) return n.toExponential(2)
  if (n < 1) return n.toFixed(4)
  return n.toLocaleString("en-US", { maximumFractionDigits: 4 })
}

function fmtPct(v: number) {
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`
}

function fmtUsd(v: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(v)
}

// ─── Stock card ───────────────────────────────────────────────────────────────

function StockCard({ holding, onTrade }: { holding: StockHolding; onTrade: () => void }) {
  const { asset, quote, balance, value, dayPnl, dayPnlPct, isUp } = holding

  const accentColor = isUp ? "oklch(0.68 0.18 155)" : "oklch(0.60 0.18 25)"
  const priceColor = isUp ? "text-[oklch(0.68_0.18_155)]" : "text-[oklch(0.60_0.18_25)]"

  return (
    <article className="group relative rounded-2xl border border-[oklch(0.20_0.015_255)] bg-[oklch(0.115_0.012_260/0.96)] overflow-hidden transition-all hover:border-[oklch(0.28_0.016_255)] hover:shadow-[0_8px_32px_oklch(0_0_0/0.30)]">
      {/* Top accent line */}
      <div
        className="h-[2px] w-full"
        style={{ background: `linear-gradient(90deg, ${accentColor}, transparent 60%)` }}
      />

      <div className="p-4 sm:p-5">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {/* Asset mark */}
            <div
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border text-[12px] font-bold"
              style={{
                background: `${asset.accent ?? "oklch(0.78 0.16 82)"}/0.12`,
                borderColor: `${asset.accent ?? "oklch(0.78 0.16 82)"}/0.28`,
                color: asset.accent ?? "oklch(0.78 0.16 82)",
              }}
            >
              {asset.displaySymbol.slice(0, 3)}
            </div>

            <div className="min-w-0">
              {/* Type badge */}
              <div className="flex items-center gap-1.5 mb-1">
                <span className="inline-flex items-center gap-1 rounded-md border border-[oklch(0.78_0.16_82/0.22)] bg-[oklch(0.78_0.16_82/0.07)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-[oklch(0.84_0.16_82)]">
                  <BarChart3 className="h-2 w-2" />
                  Stock
                </span>
                <span className={cn(
                  "flex items-center gap-0.5 rounded-md border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest",
                  isUp
                    ? "border-[oklch(0.68_0.18_155/0.22)] bg-[oklch(0.68_0.18_155/0.07)] text-[oklch(0.72_0.18_155)]"
                    : "border-[oklch(0.60_0.18_25/0.22)] bg-[oklch(0.60_0.18_25/0.07)] text-[oklch(0.64_0.18_25)]"
                )}>
                  {isUp ? <TrendingUp className="h-2 w-2" /> : <TrendingDown className="h-2 w-2" />}
                  {fmtPct(dayPnlPct)} today
                </span>
              </div>
              <h3 className="text-[14px] font-bold text-foreground leading-tight">{asset.displaySymbol}</h3>
              <p className="text-[11px] text-muted-foreground truncate">{asset.name}</p>
            </div>
          </div>

          {/* Value + day P&L */}
          <div className="text-right shrink-0">
            <div className="text-[18px] sm:text-[20px] font-bold text-foreground tabular-nums leading-none">
              {fmtUsd(value)}
            </div>
            <div className={cn("mt-0.5 text-[11px] font-semibold tabular-nums", priceColor)}>
              {dayPnl >= 0 ? "+" : ""}{fmtUsd(dayPnl)}
            </div>
          </div>
        </div>

        {/* Stats strip */}
        <div className="mt-4 grid grid-cols-3 gap-2">
          <div className="rounded-xl border border-[oklch(0.18_0.014_255)] bg-[oklch(0.09_0.01_260/0.6)] px-3 py-2.5">
            <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60">Price</div>
            <div className="mt-1 font-mono text-[13px] font-bold text-foreground tabular-nums">
              {quote?.price != null ? fmtUsd(quote.price) : "—"}
            </div>
          </div>
          <div className="rounded-xl border border-[oklch(0.18_0.014_255)] bg-[oklch(0.09_0.01_260/0.6)] px-3 py-2.5">
            <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60">Shares</div>
            <div className="mt-1 font-mono text-[13px] font-bold text-foreground tabular-nums">
              {fmtShares(balance)}
            </div>
          </div>
          <div className={cn(
            "rounded-xl border px-3 py-2.5",
            isUp
              ? "border-[oklch(0.68_0.18_155/0.20)] bg-[oklch(0.68_0.18_155/0.06)]"
              : "border-[oklch(0.60_0.18_25/0.20)] bg-[oklch(0.60_0.18_25/0.06)]"
          )}>
            <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60">Day</div>
            <div className={cn("mt-1 font-mono text-[13px] font-bold tabular-nums", priceColor)}>
              {fmtPct(dayPnlPct)}
            </div>
          </div>
        </div>

        {/* Action */}
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={onTrade}
            className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-[oklch(0.78_0.16_82)] text-[12px] font-bold text-[oklch(0.10_0.012_260)] transition-all hover:bg-[oklch(0.83_0.16_82)] hover:shadow-[0_4px_16px_oklch(0.78_0.16_82/0.30)] active:scale-[0.98]"
          >
            Trade
            <ArrowUpRight className="h-3.5 w-3.5" />
          </button>
          <div className="flex h-10 items-center gap-1.5 rounded-xl border border-[oklch(0.20_0.014_255)] px-3 text-[10px] font-semibold text-muted-foreground/60">
            <span className={cn("h-1.5 w-1.5 rounded-full", quote?.delayed ? "bg-[oklch(0.78_0.16_82)]" : "bg-[oklch(0.68_0.18_155)]")} />
            {quote?.delayed ? "Delayed" : "Live"}
          </div>
        </div>
      </div>
    </article>
  )
}

// ─── Prediction card ──────────────────────────────────────────────────────────

function PredictionCard({
  pos,
  onView,
  onSell,
  routeId,
  formatMoney,
  formatPnl,
  formatPercent,
  formatPrice,
  formatPortfolioNumber,
  formatTimeLeft,
  positionLabel,
  positionOutcome,
  getPositionPnl,
  getPositionPnlPercent,
  getPositionValue,
  getPositionEndTime,
}: {
  pos: any
  onView: () => void
  onSell: () => void
  routeId: string | null
} & Pick<UnifiedHoldingsProps,
  "formatMoney" | "formatPnl" | "formatPercent" | "formatPrice" |
  "formatPortfolioNumber" | "formatTimeLeft" | "positionLabel" |
  "positionOutcome" | "getPositionPnl" | "getPositionPnlPercent" |
  "getPositionValue" | "getPositionEndTime"
>) {
  const pnl = getPositionPnl(pos)
  const pnlPct = getPositionPnlPercent(pos)
  const value = getPositionValue(pos)
  const shares = pos?.size ?? pos?.position_size ?? 0
  const outcome = positionOutcome(pos)
  const label = positionLabel(pos)
  const endTime = getPositionEndTime(pos)
  const timeLeft = formatTimeLeft(endTime)
  const avgPrice = pos?.avgPrice ?? pos?.avg_entry_price ?? pos?.entry_price
  const currentPrice = pos?.curPrice ?? pos?.cur_price ?? pos?.current_price ?? pos?.price
  const isYes = outcome.toLowerCase().includes("yes")
  const isNo = outcome.toLowerCase().includes("no")
  const pnlPositive = pnl >= 0

  const avgCents = (() => { const n = Number(avgPrice) || 0; return n <= 1 ? n * 100 : n })()
  const curCents = (() => { const n = Number(currentPrice) || 0; return n <= 1 ? n * 100 : n })()

  const accentColor = pnlPositive ? "oklch(0.68 0.18 155)" : "oklch(0.60 0.18 25)"

  return (
    <article className="group relative rounded-2xl border border-[oklch(0.20_0.015_255)] bg-[oklch(0.115_0.012_260/0.96)] overflow-hidden transition-all hover:border-[oklch(0.28_0.016_255)] hover:shadow-[0_8px_32px_oklch(0_0_0/0.30)]">
      {/* Top accent line */}
      <div
        className="h-[2px] w-full"
        style={{ background: `linear-gradient(90deg, ${accentColor}, transparent 60%)` }}
      />

      <div className="p-4 sm:p-5">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            {/* Type + outcome + time badges */}
            <div className="flex flex-wrap items-center gap-1.5 mb-2">
              <span className="inline-flex items-center gap-1 rounded-md border border-[oklch(0.70_0.11_210/0.25)] bg-[oklch(0.70_0.11_210/0.07)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-[oklch(0.76_0.13_210)]">
                <Zap className="h-2 w-2" />
                Prediction
              </span>
              <span className={cn(
                "rounded-md border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest",
                isYes
                  ? "border-[oklch(0.68_0.18_155/0.25)] bg-[oklch(0.68_0.18_155/0.08)] text-[oklch(0.72_0.18_155)]"
                  : isNo
                  ? "border-[oklch(0.60_0.18_25/0.25)] bg-[oklch(0.60_0.18_25/0.08)] text-[oklch(0.64_0.18_25)]"
                  : "border-[oklch(0.22_0.015_255)] bg-[oklch(0.15_0.014_255)] text-muted-foreground"
              )}>
                {outcome}
              </span>
              {timeLeft.label && (
                <span className={cn(
                  "flex items-center gap-0.5 rounded-md border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest",
                  timeLeft.urgency === "critical"
                    ? "border-[oklch(0.60_0.18_25/0.35)] bg-[oklch(0.60_0.18_25/0.10)] text-[oklch(0.72_0.18_25)]"
                    : timeLeft.urgency === "soon"
                    ? "border-[oklch(0.78_0.16_82/0.30)] bg-[oklch(0.78_0.16_82/0.08)] text-[oklch(0.84_0.16_82)]"
                    : "border-[oklch(0.22_0.015_255)] bg-[oklch(0.15_0.014_255)] text-muted-foreground"
                )}>
                  <Clock3 className="h-2 w-2 mr-0.5" />
                  {timeLeft.label}
                </span>
              )}
            </div>

            <h3 className="text-[14px] font-semibold leading-snug text-foreground line-clamp-2 pr-2">
              {label}
            </h3>
          </div>

          {/* P&L block */}
          <div className="text-right shrink-0">
            <div className={cn(
              "text-[18px] sm:text-[20px] font-bold tabular-nums leading-none",
              pnlPositive ? "text-[oklch(0.68_0.18_155)]" : "text-[oklch(0.60_0.18_25)]"
            )}>
              {formatPnl(pnl)}
            </div>
            <div className={cn(
              "mt-0.5 text-[11px] font-semibold tabular-nums",
              pnlPositive ? "text-[oklch(0.68_0.18_155/0.7)]" : "text-[oklch(0.60_0.18_25/0.7)]"
            )}>
              {formatPercent(pnlPct)}
            </div>
          </div>
        </div>

        {/* Price journey bar */}
        {avgCents > 0 && curCents > 0 && (
          <div className="mt-3.5">
            <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-[oklch(0.16_0.014_255)]">
              <div
                className={cn(
                  "absolute inset-y-0 left-0 rounded-full transition-all duration-700",
                  pnlPositive ? "bg-[oklch(0.68_0.18_155/0.55)]" : "bg-[oklch(0.60_0.18_25/0.55)]"
                )}
                style={{ width: `${Math.max(2, Math.min(98, curCents))}%` }}
              />
              <div
                className="absolute inset-y-0 w-0.5 bg-[oklch(0.45_0.01_255)]"
                style={{ left: `${Math.max(2, Math.min(98, avgCents))}%` }}
              />
            </div>
            <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
              <span>Entry {formatPrice(avgPrice)}</span>
              <span className={cn("font-semibold", pnlPositive ? "text-[oklch(0.68_0.18_155)]" : "text-[oklch(0.60_0.18_25)]")}>
                Now {formatPrice(currentPrice)}
              </span>
            </div>
          </div>
        )}

        {/* Stats strip */}
        <div className="mt-3.5 grid grid-cols-3 gap-2">
          <div className="rounded-xl border border-[oklch(0.18_0.014_255)] bg-[oklch(0.09_0.01_260/0.6)] px-3 py-2.5">
            <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60">Shares</div>
            <div className="mt-1 font-mono text-[13px] font-bold text-foreground tabular-nums">
              {formatPortfolioNumber(Number(shares))}
            </div>
          </div>
          <div className="rounded-xl border border-[oklch(0.18_0.014_255)] bg-[oklch(0.09_0.01_260/0.6)] px-3 py-2.5">
            <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60">Value</div>
            <div className="mt-1 font-mono text-[13px] font-bold text-foreground tabular-nums">
              {formatMoney(value)}
            </div>
          </div>
          <div className="rounded-xl border border-[oklch(0.18_0.014_255)] bg-[oklch(0.09_0.01_260/0.6)] px-3 py-2.5">
            <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60">Payout</div>
            <div className="mt-1 font-mono text-[13px] font-bold text-[oklch(0.72_0.18_155)] tabular-nums">
              {formatMoney(Number(shares))}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={onView}
            disabled={!routeId}
            className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl border border-[oklch(0.24_0.016_255)] text-[12px] font-bold text-muted-foreground transition-all hover:border-[oklch(0.34_0.016_255)] hover:text-foreground disabled:opacity-40 active:scale-[0.98]"
          >
            View <ArrowUpRight className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onSell}
            disabled={!routeId}
            className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-[oklch(0.78_0.16_82)] text-[12px] font-bold text-[oklch(0.10_0.012_260)] transition-all hover:bg-[oklch(0.83_0.16_82)] hover:shadow-[0_4px_16px_oklch(0.78_0.16_82/0.30)] disabled:opacity-40 active:scale-[0.98]"
          >
            <ArrowDownUp className="h-3.5 w-3.5" />
            Sell
          </button>
        </div>
      </div>
    </article>
  )
}

// ─── Filter pill ──────────────────────────────────────────────────────────────

function FilterPill({
  active, count, children, onClick,
}: { active: boolean; count?: number; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-xl px-4 py-2 text-[11px] font-bold transition-all",
        active
          ? "bg-[oklch(0.78_0.16_82)] text-[oklch(0.10_0.012_260)] shadow-[0_4px_12px_oklch(0.78_0.16_82/0.25)]"
          : "border border-[oklch(0.22_0.015_255)] bg-[oklch(0.14_0.013_255)] text-muted-foreground hover:text-foreground hover:border-[oklch(0.30_0.016_255)]"
      )}
    >
      {children}
      {count !== undefined && (
        <span className={cn(
          "rounded-full px-1.5 py-0.5 text-[9px] font-bold tabular-nums min-w-[18px] text-center",
          active
            ? "bg-[oklch(0.10_0.012_260/0.25)] text-[oklch(0.10_0.012_260)]"
            : "bg-[oklch(0.20_0.014_255)] text-muted-foreground"
        )}>
          {count}
        </span>
      )}
    </button>
  )
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyHoldings({ filter }: { filter: FilterType }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-[oklch(0.22_0.015_255)] py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[oklch(0.22_0.015_255)] bg-[oklch(0.14_0.013_255)]">
        {filter === "stocks"
          ? <BarChart3 className="h-6 w-6 text-muted-foreground/40" />
          : <Zap className="h-6 w-6 text-muted-foreground/40" />
        }
      </div>
      <div>
        <p className="font-semibold text-foreground">
          {filter === "stocks" ? "No stock holdings yet" : filter === "predictions" ? "No open positions" : "No holdings yet"}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {filter === "stocks"
            ? "Buy US stocks on the Stocks page — they'll appear here instantly."
            : filter === "predictions"
            ? "Trade on any market to open a position."
            : "Your positions and stock holdings will appear here."
          }
        </p>
      </div>
    </div>
  )
}

// ─── Main exported component ──────────────────────────────────────────────────

export function UnifiedHoldings({
  openPositions,
  stockHoldings,
  stocksLoading,
  onViewPosition,
  onSellPosition,
  marketRouteId,
  walletConnected,
  ...helpers
}: UnifiedHoldingsProps) {
  const router = useRouter()
  const [filter, setFilter] = useState<FilterType>("all")

  const totalPredictionCount = openPositions.length
  const totalStockCount = stockHoldings.length
  const totalCount = totalPredictionCount + totalStockCount

  // Filter the lists
  const showPredictions = filter === "all" || filter === "predictions"
  const showStocks = filter === "all" || filter === "stocks"

  const filteredPredictions = showPredictions ? openPositions : []
  const filteredStocks = showStocks ? stockHoldings : []
  const isEmpty = filteredPredictions.length === 0 && filteredStocks.length === 0

  return (
    <div className="space-y-5 mt-5">

      {/* Filter pills */}
      <div className="flex items-center gap-2 flex-wrap">
        <FilterPill active={filter === "all"} count={totalCount} onClick={() => setFilter("all")}>
          All holdings
        </FilterPill>
        <FilterPill active={filter === "predictions"} count={totalPredictionCount} onClick={() => setFilter("predictions")}>
          <Zap className="h-3 w-3" />
          Predictions
        </FilterPill>
        <FilterPill active={filter === "stocks"} count={totalStockCount} onClick={() => setFilter("stocks")}>
          <BarChart3 className="h-3 w-3" />
          Stocks
        </FilterPill>

        {stocksLoading && (
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground ml-auto">
            <Loader2 className="h-3 w-3 animate-spin" />
            Reading wallet…
          </div>
        )}
      </div>

      {/* Empty */}
      {isEmpty && !stocksLoading && <EmptyHoldings filter={filter} />}

      {/* Unified list — stocks and predictions interleaved, stocks first if sorting by value */}
      {!isEmpty && (
        <div className="space-y-4">

          {/* Stocks section */}
          {filteredStocks.length > 0 && (
            <div className="space-y-4">
              {filter === "all" && (
                <div className="flex items-center gap-2 pt-1">
                  <BarChart3 className="h-3.5 w-3.5 text-[oklch(0.78_0.16_82)]" />
                  <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                    Stock Holdings · BNB Chain
                  </span>
                </div>
              )}
              {filteredStocks.map((h) => (
                <StockCard
                  key={h.asset.id}
                  holding={h}
                  onTrade={() => router.push(`/stocks?trade=${h.asset.displaySymbol}`)}
                />
              ))}
            </div>
          )}

          {/* Divider between sections when showing both */}
          {filteredStocks.length > 0 && filteredPredictions.length > 0 && (
            <div className="flex items-center gap-3 py-2">
              <div className="flex-1 h-px bg-[oklch(0.18_0.014_255)]" />
            </div>
          )}

          {/* Predictions section */}
          {filteredPredictions.length > 0 && (
            <div className="space-y-4">
              {filter === "all" && (
                <div className="flex items-center gap-2">
                  <Zap className="h-3.5 w-3.5 text-[oklch(0.76_0.13_210)]" />
                  <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                    Prediction Positions · Polygon
                  </span>
                </div>
              )}
              {filteredPredictions.map((pos: any, idx: number) => {
                const routeId = marketRouteId(pos)
                return (
                  <PredictionCard
                    key={`pos-${idx}`}
                    pos={pos}
                    routeId={routeId}
                    onView={() => onViewPosition(pos, routeId)}
                    onSell={() => onSellPosition(pos, routeId)}
                    {...helpers}
                  />
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
