"use client"

import { useMemo, useState } from "react"
import {
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  ExternalLink,
  Filter,
  Loader2,
  Lock,
  Send,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  Wallet,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { BridgeTransaction } from "@smartmarket/types"

// ─── Types ────────────────────────────────────────────────────────────────────

export type ActivityEventType =
  | "deposit"
  | "withdrawal"
  | "buy"
  | "sell"
  | "position_open"
  | "position_closed"
  | "order_placed"
  | "order_cancelled"
  | "bridge"
  | "wallet"
  | "system"

export type ActivityStatus = "pending" | "confirmed" | "failed" | "processing"

export interface ActivityEvent {
  id: string
  type: ActivityEventType
  status: ActivityStatus
  title: string
  detail: string
  amount?: string        // "$12.40" or "240 sh"
  market?: string        // market question snippet
  outcome?: string       // "YES" | "NO"
  price?: string         // "0.62¢"
  txHash?: string        // for linking to explorer
  timestamp: number | null  // ms epoch, null = "just now"
  raw?: any
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns "2m ago", "3h ago", "May 24", "Jan 3, 2025" */
export function relativeTime(ts: number | null): string {
  if (!ts) return "Just now"
  const diff = Date.now() - ts
  if (diff < 0) return "Just now"
  const sec  = Math.floor(diff / 1_000)
  const min  = Math.floor(diff / 60_000)
  const hour = Math.floor(diff / 3_600_000)
  const day  = Math.floor(diff / 86_400_000)
  if (sec  < 60)  return `${sec}s ago`
  if (min  < 60)  return `${min}m ago`
  if (hour < 24)  return `${hour}h ago`
  if (day  === 1) return "Yesterday"
  if (day  < 7)   return `${day}d ago`
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

/** Full date+time for tooltip */
function absoluteTime(ts: number | null): string {
  if (!ts) return "—"
  return new Date(ts).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  })
}

function parseTimestamp(value: any): number | null {
  if (value === undefined || value === null || value === "") return null
  const n = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(n) || n <= 0) return null
  // seconds → ms if small number
  return n < 10_000_000_000 ? n * 1000 : n
}

function shortAddr(addr?: string | null) {
  if (!addr) return ""
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}
function shortHash(hash?: string | null) {
  if (!hash) return ""
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`
}
function formatMoney(v: any) {
  const n = Number(v)
  if (!Number.isFinite(n)) return ""
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 })
}
function formatShares(v: any) {
  const n = Number(v)
  if (!Number.isFinite(n)) return ""
  return `${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} sh`
}
function formatPrice(v: any) {
  const n = Number(v)
  if (!Number.isFinite(n)) return ""
  const p = n > 1 ? n / 100 : n
  return `${(p * 100).toFixed(0)}¢`
}
function trimQuestion(q?: string | null, max = 56) {
  if (!q) return "Polymarket"
  return q.length > max ? q.slice(0, max) + "…" : q
}

// ─── Event builders ───────────────────────────────────────────────────────────

/** Build activity events from raw trade history */
export function tradesAsEvents(trades: any[]): ActivityEvent[] {
  return trades.map((t, i): ActivityEvent => {
    const side = String(t?.side ?? "").toUpperCase()
    const isBuy = side === "BUY"
    const price = formatPrice(t?.price)
    const shares = formatShares(t?.size ?? t?.amount)
    const notional = Number(t?.price) * Number(t?.size ?? t?.amount)
    const amount = Number.isFinite(notional) && notional > 0
      ? formatMoney(notional > 1 ? notional / 100 : notional)
      : shares || undefined

    return {
      id: `trade-${t?.transactionHash ?? t?.id ?? i}`,
      type: isBuy ? "buy" : "sell",
      status: "confirmed",
      title: isBuy ? "Bought position" : "Sold position",
      market: trimQuestion(t?.market ?? t?.title ?? t?.question ?? t?.condition_id),
      outcome: t?.outcome ?? t?.side ?? undefined,
      price: price || undefined,
      amount,
      txHash: t?.transactionHash ?? t?.tx_hash ?? undefined,
      timestamp: parseTimestamp(t?.timestamp ?? t?.createdAt ?? t?.created_at),
      detail: [
        trimQuestion(t?.market ?? t?.title ?? t?.question ?? t?.condition_id),
        price && `at ${price}`,
        shares && `${shares}`,
      ].filter(Boolean).join(" · "),
      raw: t,
    }
  })
}

/** Build activity events from bridge/funding transactions */
export function bridgeTxAsEvents(txs: BridgeTransaction[], phase?: string): ActivityEvent[] {
  return txs.map((tx, i): ActivityEvent => {
    const isComplete = phase === "completed" || tx.status?.toLowerCase().includes("complet")
    const isFailed   = phase === "failed"    || tx.status?.toLowerCase().includes("fail")
    const isPending  = !isComplete && !isFailed

    return {
      id: `bridge-${tx.txHash ?? tx.createdTimeMs ?? i}`,
      type: "deposit",
      status: isComplete ? "confirmed" : isFailed ? "failed" : "processing",
      title: isComplete ? "Deposit confirmed" : isFailed ? "Deposit failed" : "Deposit processing",
      detail: tx.txHash ? `Tx ${shortHash(tx.txHash)}` : "Bridge transaction in progress",
      amount: tx.fromAmountBaseUnit ? `${(Number(tx.fromAmountBaseUnit) / 1e18).toFixed(4)} BNB` : undefined,
      txHash: tx.txHash ?? undefined,
      timestamp: parseTimestamp(tx.createdTimeMs),
      raw: tx,
    }
  })
}

/** Build activity events from open positions */
export function openPositionsAsEvents(positions: any[]): ActivityEvent[] {
  return positions.map((p, i): ActivityEvent => ({
    id: `pos-open-${p?.conditionId ?? p?.condition_id ?? p?.asset ?? i}`,
    type: "position_open",
    status: "confirmed",
    title: "Position open",
    market: trimQuestion(p?.title ?? p?.market ?? p?.question ?? p?.event),
    outcome: p?.outcome ?? p?.outcomeName ?? p?.outcome_name ?? undefined,
    amount: p?.currentValue != null
      ? formatMoney(Number(p.currentValue) > 1 ? Number(p.currentValue) / 100 : Number(p.currentValue))
      : (p?.size ? formatShares(p.size) : undefined),
    timestamp: parseTimestamp(p?.createdAt ?? p?.created_at ?? p?.entryTime ?? p?.entry_time),
    detail: [
      trimQuestion(p?.title ?? p?.market ?? p?.question ?? p?.event),
      (p?.outcome ?? p?.outcomeName) && `Outcome: ${p?.outcome ?? p?.outcomeName}`,
    ].filter(Boolean).join(" · "),
    raw: p,
  }))
}

/** Build activity events from closed positions */
export function closedPositionsAsEvents(positions: any[]): ActivityEvent[] {
  return positions.map((p, i): ActivityEvent => {
    const realizedRaw = Number(p?.profit ?? p?.pnl ?? p?.realized ?? p?.realizedPnl ?? p?.realized_pnl ?? 0)
    const realized = Number.isFinite(realizedRaw) ? realizedRaw : 0
    const won = realized > 0

    return {
      id: `pos-closed-${p?.conditionId ?? p?.condition_id ?? p?.asset ?? i}`,
      type: "position_closed",
      status: "confirmed",
      title: won ? "Position won" : realized < 0 ? "Position lost" : "Position settled",
      market: trimQuestion(p?.title ?? p?.market ?? p?.question ?? p?.event),
      outcome: p?.outcome ?? p?.outcomeName ?? undefined,
      amount: realized !== 0 ? formatMoney(Math.abs(realized) > 1 ? Math.abs(realized) / 100 : Math.abs(realized)) : undefined,
      timestamp: parseTimestamp(
        p?.resolvedAt ?? p?.resolved_at ?? p?.closedAt ?? p?.closed_at ??
        p?.settledAt ?? p?.settled_at ?? p?.endDate ?? p?.end_date
      ),
      detail: [
        trimQuestion(p?.title ?? p?.market ?? p?.question ?? p?.event),
        won ? `+${formatMoney(Math.abs(realized) > 1 ? Math.abs(realized) / 100 : Math.abs(realized))}` : realized < 0 ? `-${formatMoney(Math.abs(realized) > 1 ? Math.abs(realized) / 100 : Math.abs(realized))}` : "Settled",
      ].filter(Boolean).join(" · "),
      raw: p,
    }
  })
}

/** Build events from open CLOB orders */
export function openOrdersAsEvents(orders: any[]): ActivityEvent[] {
  return orders.map((o, i): ActivityEvent => {
    const isBuy = String(o?.side ?? "").toUpperCase() === "BUY"
    const remaining = Math.max(0, Number(o?.originalSize ?? 0) - Number(o?.sizeMatched ?? 0))
    const price = formatPrice(o?.price)

    return {
      id: `order-${o?.id ?? o?.orderId ?? i}`,
      type: "order_placed",
      status: "pending",
      title: `Resting ${isBuy ? "buy" : "sell"} order`,
      market: trimQuestion(o?.market ?? o?.title ?? o?.question),
      outcome: o?.outcome ?? undefined,
      price: price || undefined,
      amount: remaining > 0 ? formatShares(remaining) : undefined,
      timestamp: parseTimestamp(o?.createdAt ?? o?.created_at ?? o?.timestamp),
      detail: [
        trimQuestion(o?.market ?? o?.title ?? o?.question),
        price && `at ${price}`,
        remaining > 0 && `${formatShares(remaining)} remaining`,
      ].filter(Boolean).join(" · "),
      raw: o,
    }
  })
}

// ─── Type config ──────────────────────────────────────────────────────────────

const TYPE_CONFIG: Record<ActivityEventType, {
  label: string
  icon: React.ElementType
  iconColor: string
  bgColor: string
  borderColor: string
  badgeColor: string
}> = {
  deposit: {
    label: "Deposit",
    icon: ArrowDownLeft,
    iconColor: "text-[oklch(0.68_0.18_155)]",
    bgColor: "bg-[oklch(0.68_0.18_155/0.08)]",
    borderColor: "border-[oklch(0.68_0.18_155/0.20)]",
    badgeColor: "bg-[oklch(0.68_0.18_155/0.12)] text-[oklch(0.72_0.18_155)] border-[oklch(0.68_0.18_155/0.25)]",
  },
  withdrawal: {
    label: "Withdrawal",
    icon: ArrowUpRight,
    iconColor: "text-[oklch(0.72_0.22_45)]",
    bgColor: "bg-[oklch(0.72_0.22_45/0.08)]",
    borderColor: "border-[oklch(0.72_0.22_45/0.20)]",
    badgeColor: "bg-[oklch(0.72_0.22_45/0.12)] text-[oklch(0.76_0.20_45)] border-[oklch(0.72_0.22_45/0.25)]",
  },
  buy: {
    label: "Buy",
    icon: TrendingUp,
    iconColor: "text-[oklch(0.68_0.18_155)]",
    bgColor: "bg-[oklch(0.68_0.18_155/0.08)]",
    borderColor: "border-[oklch(0.68_0.18_155/0.20)]",
    badgeColor: "bg-[oklch(0.68_0.18_155/0.12)] text-[oklch(0.72_0.18_155)] border-[oklch(0.68_0.18_155/0.25)]",
  },
  sell: {
    label: "Sell",
    icon: TrendingDown,
    iconColor: "text-[oklch(0.72_0.22_45)]",
    bgColor: "bg-[oklch(0.72_0.22_45/0.08)]",
    borderColor: "border-[oklch(0.72_0.22_45/0.20)]",
    badgeColor: "bg-[oklch(0.72_0.22_45/0.12)] text-[oklch(0.76_0.20_45)] border-[oklch(0.72_0.22_45/0.25)]",
  },
  position_open: {
    label: "Open",
    icon: TrendingUp,
    iconColor: "text-[oklch(0.78_0.16_82)]",
    bgColor: "bg-[oklch(0.78_0.16_82/0.08)]",
    borderColor: "border-[oklch(0.78_0.16_82/0.20)]",
    badgeColor: "bg-[oklch(0.78_0.16_82/0.12)] text-[oklch(0.82_0.16_82)] border-[oklch(0.78_0.16_82/0.25)]",
  },
  position_closed: {
    label: "Closed",
    icon: CheckCircle2,
    iconColor: "text-[oklch(0.55_0.02_255)]",
    bgColor: "bg-[oklch(0.55_0.02_255/0.08)]",
    borderColor: "border-[oklch(0.55_0.02_255/0.20)]",
    badgeColor: "bg-[oklch(0.55_0.02_255/0.12)] text-[oklch(0.60_0.02_255)] border-[oklch(0.55_0.02_255/0.25)]",
  },
  order_placed: {
    label: "Order",
    icon: Lock,
    iconColor: "text-[oklch(0.78_0.16_82)]",
    bgColor: "bg-[oklch(0.78_0.16_82/0.06)]",
    borderColor: "border-[oklch(0.78_0.16_82/0.15)]",
    badgeColor: "bg-[oklch(0.78_0.16_82/0.10)] text-[oklch(0.82_0.16_82)] border-[oklch(0.78_0.16_82/0.20)]",
  },
  order_cancelled: {
    label: "Cancelled",
    icon: X,
    iconColor: "text-[oklch(0.60_0.18_25)]",
    bgColor: "bg-[oklch(0.60_0.18_25/0.08)]",
    borderColor: "border-[oklch(0.60_0.18_25/0.20)]",
    badgeColor: "bg-[oklch(0.60_0.18_25/0.12)] text-[oklch(0.64_0.18_25)] border-[oklch(0.60_0.18_25/0.25)]",
  },
  bridge: {
    label: "Bridge",
    icon: Send,
    iconColor: "text-[oklch(0.68_0.18_155)]",
    bgColor: "bg-[oklch(0.68_0.18_155/0.08)]",
    borderColor: "border-[oklch(0.68_0.18_155/0.20)]",
    badgeColor: "bg-[oklch(0.68_0.18_155/0.12)] text-[oklch(0.72_0.18_155)] border-[oklch(0.68_0.18_155/0.25)]",
  },
  wallet: {
    label: "Wallet",
    icon: Wallet,
    iconColor: "text-[oklch(0.55_0.02_255)]",
    bgColor: "bg-[oklch(0.14_0.012_260)]",
    borderColor: "border-[oklch(0.22_0.015_255)]",
    badgeColor: "bg-[oklch(0.16_0.014_255)] text-muted-foreground border-[oklch(0.22_0.015_255)]",
  },
  system: {
    label: "System",
    icon: ShieldCheck,
    iconColor: "text-[oklch(0.55_0.02_255)]",
    bgColor: "bg-[oklch(0.14_0.012_260)]",
    borderColor: "border-[oklch(0.22_0.015_255)]",
    badgeColor: "bg-[oklch(0.16_0.014_255)] text-muted-foreground border-[oklch(0.22_0.015_255)]",
  },
}

const STATUS_CONFIG: Record<ActivityStatus, { dot: string; label: string }> = {
  confirmed:  { dot: "bg-[oklch(0.68_0.18_155)]",    label: "Confirmed" },
  pending:    { dot: "bg-[oklch(0.78_0.16_82)] animate-pulse", label: "Pending" },
  processing: { dot: "bg-[oklch(0.78_0.16_82)] animate-pulse", label: "Processing" },
  failed:     { dot: "bg-[oklch(0.60_0.18_25)]",    label: "Failed" },
}

// ─── Filter tabs ──────────────────────────────────────────────────────────────

type FilterType = "all" | "trades" | "funding" | "positions" | "orders"

const FILTERS: { key: FilterType; label: string; types: ActivityEventType[] }[] = [
  { key: "all",       label: "All",       types: [] },
  { key: "trades",    label: "Trades",    types: ["buy", "sell"] },
  { key: "funding",   label: "Funding",   types: ["deposit", "withdrawal", "bridge"] },
  { key: "positions", label: "Positions", types: ["position_open", "position_closed"] },
  { key: "orders",    label: "Orders",    types: ["order_placed", "order_cancelled"] },
]

// ─── Single event card ────────────────────────────────────────────────────────

function ActivityCard({ event }: { event: ActivityEvent }) {
  const cfg = TYPE_CONFIG[event.type]
  const statusCfg = STATUS_CONFIG[event.status]
  const Icon = cfg.icon
  const bscExplorerBase = "https://bscscan.com/tx/"
  const polyExplorerBase = "https://polygonscan.com/tx/"

  return (
    <div className={cn(
      "group flex items-start gap-3 rounded-xl border p-3 transition-colors hover:bg-[oklch(0.14_0.012_260/0.6)]",
      cfg.borderColor,
    )}>
      {/* Icon pill */}
      <div className={cn(
        "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border",
        cfg.bgColor, cfg.borderColor,
      )}>
        <Icon className={cn("h-3.5 w-3.5", cfg.iconColor)} />
      </div>

      {/* Body */}
      <div className="min-w-0 flex-1">
        {/* Row 1: title + amount */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
            {/* Type badge */}
            <span className={cn(
              "inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest",
              cfg.badgeColor,
            )}>
              {cfg.label}
            </span>
            <span className="text-[12px] font-semibold text-foreground leading-snug">
              {event.title}
            </span>
          </div>
          {event.amount && (
            <span className={cn(
              "shrink-0 font-mono text-[11px] font-bold",
              event.type === "buy" || event.type === "deposit" || (event.type === "position_closed" && event.raw?.profit > 0)
                ? "text-[oklch(0.68_0.18_155)]"
                : event.type === "sell" || event.type === "withdrawal"
                  ? "text-[oklch(0.72_0.22_45)]"
                  : "text-foreground",
            )}>
              {event.amount}
            </span>
          )}
        </div>

        {/* Row 2: market + outcome */}
        {(event.market || event.outcome) && (
          <div className="mt-0.5 flex items-center gap-1.5 flex-wrap">
            {event.market && (
              <span className="text-[11px] text-muted-foreground leading-snug truncate max-w-[280px]">
                {event.market}
              </span>
            )}
            {event.outcome && (
              <span className={cn(
                "inline-flex shrink-0 items-center rounded border px-1.5 py-0 text-[9px] font-bold uppercase tracking-wide",
                event.outcome?.toUpperCase() === "YES"
                  ? "border-[oklch(0.68_0.18_155/0.3)] bg-[oklch(0.68_0.18_155/0.08)] text-[oklch(0.72_0.18_155)]"
                  : event.outcome?.toUpperCase() === "NO"
                    ? "border-[oklch(0.60_0.18_25/0.3)] bg-[oklch(0.60_0.18_25/0.08)] text-[oklch(0.64_0.18_25)]"
                    : "border-[oklch(0.22_0.015_255)] bg-[oklch(0.14_0.012_260)] text-muted-foreground",
              )}>
                {event.outcome}
              </span>
            )}
          </div>
        )}

        {/* Row 3: status · price · time */}
        <div className="mt-1 flex items-center gap-2 flex-wrap">
          {/* Status dot */}
          <span className="flex items-center gap-1">
            <span className={cn("h-1.5 w-1.5 rounded-full", statusCfg.dot)} />
            <span className="text-[10px] text-muted-foreground">{statusCfg.label}</span>
          </span>

          {event.price && (
            <>
              <span className="text-[oklch(0.20_0.014_255)]">·</span>
              <span className="font-mono text-[10px] text-muted-foreground">{event.price}</span>
            </>
          )}

          <span className="text-[oklch(0.20_0.014_255)]">·</span>

          {/* Timestamp with absolute on hover */}
          <span
            className="text-[10px] text-muted-foreground cursor-default"
            title={absoluteTime(event.timestamp)}
          >
            {event.timestamp ? (
              <>
                <Clock className="inline h-2.5 w-2.5 mr-0.5 mb-0.5 opacity-50" />
                {relativeTime(event.timestamp)}
              </>
            ) : (
              <span className="inline-flex items-center gap-0.5">
                <Loader2 className="h-2.5 w-2.5 animate-spin opacity-40" />
                Just now
              </span>
            )}
          </span>

          {/* Tx link */}
          {event.txHash && (
            <>
              <span className="text-[oklch(0.20_0.014_255)]">·</span>
              <a
                href={`${event.type === "deposit" || event.type === "bridge" ? bscExplorerBase : polyExplorerBase}${event.txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-0.5 text-[10px] text-[oklch(0.78_0.16_82/0.7)] hover:text-[oklch(0.78_0.16_82)] transition-colors"
              >
                {shortHash(event.txHash)}
                <ExternalLink className="h-2.5 w-2.5" />
              </a>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

interface ActivityFeedProps {
  trades?: any[]
  bridgeTxs?: BridgeTransaction[]
  bridgePhase?: string
  openPositions?: any[]
  closedPositions?: any[]
  openOrders?: any[]
  loading?: boolean
  walletAddress?: string | null
}

export function ActivityFeed({
  trades = [],
  bridgeTxs = [],
  bridgePhase,
  openPositions = [],
  closedPositions = [],
  openOrders = [],
  loading = false,
  walletAddress,
}: ActivityFeedProps) {
  const [filter, setFilter] = useState<FilterType>("all")
  const [showAll, setShowAll] = useState(false)

  // Merge + sort all events by timestamp descending (null = newest)
  const allEvents = useMemo<ActivityEvent[]>(() => {
    const events: ActivityEvent[] = [
      ...tradesAsEvents(trades),
      ...bridgeTxAsEvents(bridgeTxs, bridgePhase),
      ...openPositionsAsEvents(openPositions),
      ...closedPositionsAsEvents(closedPositions),
      ...openOrdersAsEvents(openOrders),
    ]
    return events.sort((a, b) => {
      if (a.timestamp === null && b.timestamp === null) return 0
      if (a.timestamp === null) return -1   // nulls (just now) → top
      if (b.timestamp === null) return 1
      return b.timestamp - a.timestamp      // newest first
    })
  }, [trades, bridgeTxs, bridgePhase, openPositions, closedPositions, openOrders])

  const filtered = useMemo(() => {
    const cfg = FILTERS.find((f) => f.key === filter)!
    if (!cfg.types.length) return allEvents
    return allEvents.filter((e) => cfg.types.includes(e.type))
  }, [allEvents, filter])

  const visible = showAll ? filtered : filtered.slice(0, 8)

  // Count per filter
  const counts = useMemo(() => {
    const result: Partial<Record<FilterType, number>> = { all: allEvents.length }
    for (const f of FILTERS.slice(1)) {
      result[f.key] = allEvents.filter((e) => f.types.includes(e.type)).length
    }
    return result
  }, [allEvents])

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-[oklch(0.16_0.014_255)] px-4 sm:px-5 py-3 sm:py-4">
        <div className="flex items-center gap-2">
          <Filter className="h-3.5 w-3.5 text-[oklch(0.78_0.16_82)]" />
          <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
            Activity feed
          </span>
          {allEvents.length > 0 && (
            <span className="rounded bg-[oklch(0.18_0.015_255)] px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-muted-foreground">
              {allEvents.length}
            </span>
          )}
        </div>
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </div>

      {/* Filter pills — horizontally scrollable on mobile */}
      <div className="flex items-center gap-1.5 overflow-x-auto [-webkit-overflow-scrolling:touch] no-scrollbar px-4 sm:px-5 py-2.5 sm:py-3 border-b border-[oklch(0.14_0.012_260)]">
        {FILTERS.map((f) => {
          const count = counts[f.key] ?? 0
          const active = filter === f.key
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 sm:py-1.5 text-[11px] sm:text-[10px] font-bold uppercase tracking-[0.12em] transition-all duration-150",
                active
                  ? "bg-[oklch(0.78_0.16_82)] text-[oklch(0.10_0.012_260)] shadow-[0_4px_12px_oklch(0.78_0.16_82/0.25)]"
                  : "text-muted-foreground hover:bg-[oklch(0.16_0.014_255)] hover:text-foreground",
              )}
            >
              {f.label}
              {count > 0 && (
                <span className={cn(
                  "rounded px-1 py-0 text-[9px] font-bold tabular-nums",
                  active ? "bg-black/20 text-inherit" : "bg-[oklch(0.18_0.015_255)] text-muted-foreground",
                )}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Event list */}
      <div className="flex-1 overflow-y-auto px-3 sm:px-4 py-2.5 sm:py-3 space-y-2">
        {visible.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-[oklch(0.22_0.015_255)] bg-[oklch(0.14_0.012_260)] mb-3">
              <Filter className="h-4 w-4 text-muted-foreground/40" />
            </div>
            <p className="text-[12px] font-semibold text-foreground">
              {!walletAddress ? "Wallet not connected" : "No activity yet"}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {!walletAddress
                ? "Connect your wallet to see your activity."
                : filter === "all"
                  ? "Deposits, trades, and position changes will appear here."
                  : `No ${filter} events found.`}
            </p>
          </div>
        )}

        {visible.map((event) => (
          <ActivityCard key={event.id} event={event} />
        ))}

        {/* Show more / less */}
        {filtered.length > 8 && (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="w-full rounded-xl border border-dashed border-[oklch(0.22_0.015_255)] py-2.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:border-[oklch(0.28_0.018_255)] hover:text-foreground"
          >
            {showAll
              ? `Show less`
              : `Show ${filtered.length - 8} more events`}
          </button>
        )}
      </div>
    </div>
  )
}
