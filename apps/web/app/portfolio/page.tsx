"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Activity,
  AlertCircle,
  ArrowDownUp,
  ArrowUpRight,
  BarChart3,
  Briefcase,
  Building2,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Layers3,
  Loader2,
  Lock,
  RefreshCw,
  Send,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  Wallet,
  Zap,
} from "lucide-react";
import { usePrivy } from "@privy-io/react-auth";

import { Footer } from "@/components/footer";
import { BnbFundingModal } from "@/components/funding/bnb-funding-modal";
import { ComponentErrorBoundary } from "@/components/ui/error-boundary";
import { Navbar } from "@/components/navbar";
import { ActivityFeed } from "@/components/portfolio/activity-feed";
import { UnifiedHoldings } from "@/components/portfolio/unified-holdings";
import { useStockHoldings } from "@/hooks/use-stock-holdings";
import { Button } from "@/components/ui/button";
import { useFundingStatus } from "@/hooks/use-funding-status";
import { useActivePrivyWallet } from "@/hooks/use-active-privy-wallet";
import {
  formatPortfolioMoney,
  formatPortfolioNumber,
  formatPortfolioPnl,
  getPositionCostBasis,
  getPositionEndTime,
  getPositionPnl,
  getPositionPnlPercent,
  getPositionValue,
  isPortfolioPositionClosed,
  isPositionExpired,
  usePolymarketPortfolio,
} from "@/hooks/use-polymarket-portfolio";
import { useClobSession, type OpenOrderSnapshot } from "@/hooks/use-clob-session";
import { usePolymarketDepositWallet } from "@/hooks/use-polymarket-deposit-wallet";
import {
  groupClaimablePositions,
  type ClaimablePositionGroup,
  useSettledPositionClaims,
} from "@/hooks/use-settled-position-claims";
import { useTradeReadiness } from "@/hooks/use-trade-readiness";
import { shortAddress, useTradingProfile } from "@/hooks/use-trading-profile";
import { addAccountRefreshListener, scheduleAccountRefresh } from "@/lib/account-events";
import { friendlyErrorMessage } from "@/lib/friendly-errors";
import { cachePortfolioPositionForDetail } from "@/lib/market-detail-cache";
import { cn } from "@/lib/utils";

const PRIVY_ENABLED = Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID);

type PortfolioTab = "positions" | "orders" | "closed" | "stocks";

function valueOf(...values: any[]) {
  for (const value of values) {
    if (value === undefined || value === null || value === "") continue;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return 0;
}

function positionLabel(pos: any) {
  return pos?.title ?? pos?.market ?? pos?.question ?? pos?.event ?? pos?.conditionId ?? pos?.condition_id ?? "Position";
}

function formatTimeLeft(endTime: number | null): { label: string; urgency: "critical" | "soon" | "normal" | null } {
  if (!endTime) return { label: "", urgency: null };
  const now = Date.now();
  const diff = endTime - now;
  if (diff <= 0) return { label: "Closed", urgency: "critical" };
  const totalMins = Math.floor(diff / 60_000);
  const totalHours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);
  if (totalMins < 60) return { label: `${totalMins}m left`, urgency: "critical" };
  if (totalHours < 24) {
    const mins = totalMins % 60;
    return { label: `${totalHours}h ${mins}m left`, urgency: "critical" };
  }
  if (days === 1) return { label: "Closes tomorrow", urgency: "soon" };
  if (days <= 7) return { label: `${days}d left`, urgency: "soon" };
  return { label: `${days}d left`, urgency: "normal" };
}

function formatEndDate(endTime: number | null): string {
  if (!endTime) return "";
  return new Date(endTime).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function positionOutcome(pos: any) {
  return pos?.outcome ?? pos?.outcomeName ?? pos?.outcome_name ?? pos?.assetName ?? pos?.asset_name ?? "Outcome";
}

function positionStatus(pos: any) {
  if (isPortfolioPositionClosed(pos)) {
    if (pos?.redeemable) return "Redeemable";
    if (pos?.settled || pos?.resolved || pos?.resolution) return "Settled";
    if (isPositionExpired(pos)) return "Expired";
    return "Closed";
  }
  if (pos?.settled || pos?.resolved) return "Settled";
  if (pos?.status) return String(pos.status);
  if (pos?.resolution) return "Resolved";
  return "Open";
}

function closedPositionStatus(pos: any) {
  if (pos?.redeemable) return "Redeemable";
  if (pos?.settled || pos?.resolved) return "Settled";
  if (pos?.resolution) return "Resolved";
  if (isPositionExpired(pos)) {
    return getPositionValue(pos) > 0 ? "Redeemable" : "Expired";
  }
  if (pos?.status) {
    const status = String(pos.status);
    return status.toLowerCase() === "open" ? "Closed" : status;
  }
  if (getPositionEndTime(pos)) return "Closed";
  return "Closed";
}

function marketRouteId(pos: any) {
  return (
    pos?.marketId ?? pos?.market_id ?? pos?.slug ?? pos?.marketSlug ?? pos?.market_slug ??
    pos?.eventSlug ?? pos?.event_slug ?? pos?.eventId ?? pos?.conditionId ?? pos?.condition_id ??
    pos?.asset ?? pos?.assetId ?? pos?.asset_id ?? pos?.tokenId ?? pos?.token_id ?? pos?.id ?? null
  );
}

function formatPercent(value: any) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "0.00%";
  const prefix = numeric > 0 ? "+" : "";
  return `${prefix}${numeric.toFixed(2)}%`;
}

function formatPrice(value: any) {
  if (value === undefined || value === null || value === "") return "—";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  const cents = numeric <= 1 ? numeric * 100 : numeric;
  return `${cents.toLocaleString("en-US", {
    minimumFractionDigits: cents < 10 ? 2 : 1,
    maximumFractionDigits: cents < 10 ? 2 : 1,
  })}¢`;
}

const PUSD_DECIMALS = 6;

function collateralAmount(raw?: string | null) {
  if (!raw) return 0;
  const trimmed = String(raw).trim();
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return 0;
  if (trimmed.includes(".")) return value;
  return Math.abs(value) >= 1_000 ? value / 10 ** PUSD_DECIMALS : value;
}

function formatPusd(value?: number | null) {
  if (value === undefined || value === null || !Number.isFinite(value)) return "—";
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: value >= 100 ? 2 : 4,
    maximumFractionDigits: value >= 100 ? 2 : 4,
  })}`;
}

function formatTime(value?: number | string | null) {
  if (!value) return "Just now";
  const raw = typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value)) ? Number(value) : value;
  const millis = typeof raw === "number" && raw > 0 && raw < 10_000_000_000 ? raw * 1000 : raw;
  const date = typeof millis === "number" ? new Date(millis) : new Date(millis);
  if (Number.isNaN(date.getTime())) return "Just now";
  return date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function shortHash(value?: string | null) {
  if (!value) return "—";
  return value.length > 14 ? `${value.slice(0, 8)}...${value.slice(-6)}` : value;
}

function orderRemainingSize(order: OpenOrderSnapshot) {
  return Math.max(0, valueOf(order.originalSize) - valueOf(order.sizeMatched));
}

function orderPrice(order: OpenOrderSnapshot) {
  const price = valueOf(order.price);
  return price > 1 ? price / 100 : price;
}

function orderNotional(order: OpenOrderSnapshot) {
  return orderRemainingSize(order) * orderPrice(order);
}

function summarizeOpenOrders(orders: OpenOrderSnapshot[]) {
  return orders.reduce(
    (summary, order) => {
      const notional = orderNotional(order);
      const remaining = orderRemainingSize(order);
      if (String(order.side ?? "").toUpperCase() === "BUY") summary.buyCollateral += notional;
      else if (String(order.side ?? "").toUpperCase() === "SELL") {
        summary.sellValue += notional;
        summary.sellShares += remaining;
      }
      summary.totalValue += notional;
      return summary;
    },
    { buyCollateral: 0, sellValue: 0, sellShares: 0, totalValue: 0 }
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function TabButton({ active, children, count, onClick }: {
  active: boolean; children: React.ReactNode; count?: number; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative flex h-8 sm:h-9 items-center gap-1.5 sm:gap-2 rounded-lg sm:rounded-full px-3.5 sm:px-5 text-[11px] font-bold uppercase tracking-[0.10em] sm:tracking-[0.12em] transition-all duration-200 active:scale-95",
        active
          ? "bg-[oklch(0.78_0.16_82)] text-[oklch(0.10_0.012_260)] shadow-[0_4px_16px_oklch(0.78_0.16_82/0.30)]"
          : "text-muted-foreground hover:bg-[oklch(0.16_0.014_255/0.7)] hover:text-foreground"
      )}
    >
      <span>{children}</span>
      {typeof count === "number" && (
        <span className={cn(
          "rounded px-1 sm:px-1.5 py-0.5 text-[9px] sm:text-[10px] font-bold tabular-nums",
          active ? "bg-black/20 text-inherit" : "bg-[oklch(0.18_0.015_255)] text-muted-foreground"
        )}>
          {count}
        </span>
      )}
    </button>
  );
}

function StatPill({ label, value, tone = "neutral" }: {
  label: string; value: string; tone?: "positive" | "negative" | "gold" | "neutral";
}) {
  return (
    <div className={cn(
      "flex items-center gap-2 rounded-xl border px-3 py-2",
      tone === "positive" && "border-[oklch(0.68_0.18_155/0.22)] bg-[oklch(0.68_0.18_155/0.06)]",
      tone === "negative" && "border-[oklch(0.60_0.18_25/0.22)] bg-[oklch(0.60_0.18_25/0.06)]",
      tone === "gold" && "border-[oklch(0.78_0.16_82/0.22)] bg-[oklch(0.78_0.16_82/0.06)]",
      tone === "neutral" && "border-[oklch(0.22_0.015_255)] bg-[oklch(0.14_0.012_260/0.60)]",
    )}>
      <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{label}</span>
      <span className={cn(
        "font-mono text-sm font-bold",
        tone === "positive" && "text-[oklch(0.72_0.18_155)]",
        tone === "negative" && "text-[oklch(0.64_0.18_25)]",
        tone === "gold" && "text-[oklch(0.82_0.16_82)]",
        tone === "neutral" && "text-foreground",
      )}>{value}</span>
    </div>
  );
}

function EmptyState({ title, description, action }: {
  title: string; description: string; action?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-[oklch(0.24_0.016_255)] bg-[oklch(0.11_0.012_260/0.5)] p-10 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-[oklch(0.22_0.015_255)] bg-[oklch(0.14_0.012_260)]">
        <Briefcase className="h-5 w-5 text-[oklch(0.78_0.16_82)]" />
      </div>
      <h3 className="mt-4 text-base font-semibold text-foreground">{title}</h3>
      <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-muted-foreground">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

function BalanceBar({ liquid, inPositions, claimable, locked, total }: {
  liquid: number; inPositions: number; claimable: number; locked: number; total: number;
}) {
  if (total <= 0) return null;
  const liquidPct = Math.max(0, (liquid / total) * 100);
  const posPct = Math.max(0, (inPositions / total) * 100);
  const claimPct = Math.max(0, (claimable / total) * 100);
  const lockPct = Math.max(0, (locked / total) * 100);
  return (
    <div className="mt-4">
      <div className="flex h-2 overflow-hidden rounded-full bg-[oklch(0.14_0.012_260)]">
        <div className="h-full rounded-l-full bg-[oklch(0.68_0.18_155/0.75)]" style={{ width: `${liquidPct}%` }} />
        <div className="h-full bg-[oklch(0.78_0.16_82/0.70)]" style={{ width: `${posPct}%` }} />
        <div className="h-full bg-[oklch(0.70_0.11_210/0.70)]" style={{ width: `${claimPct}%` }} />
        <div className="h-full rounded-r-full bg-[oklch(0.55_0.10_260/0.50)]" style={{ width: `${lockPct}%` }} />
      </div>
      <div className="mt-2.5 flex items-center gap-4 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="h-1.5 w-3 rounded-full bg-[oklch(0.68_0.18_155/0.75)]" />Available</span>
        <span className="flex items-center gap-1.5"><span className="h-1.5 w-3 rounded-full bg-[oklch(0.78_0.16_82/0.70)]" />In positions</span>
        <span className="flex items-center gap-1.5"><span className="h-1.5 w-3 rounded-full bg-[oklch(0.70_0.11_210/0.70)]" />Claimable</span>
        <span className="flex items-center gap-1.5"><span className="h-1.5 w-3 rounded-full bg-[oklch(0.55_0.10_260/0.50)]" />Reserved</span>
      </div>
    </div>
  );
}

function BalanceLedgerCard({
  pUsdBalance, pUsdAllowance, spendablePusd, liquidPusd, inPositions, claimableValue,
  lockedOrdersValue, lockedBuyCollateral, lockedSellValue, lockedSellShares,
  openOrdersCount, accountValue, collateralLoading, collateralError,
  clobReady, openOrdersLoading, onPrepareSession, onRefreshOrders, tradingWalletAddress,
  stockValue, stocksLoading,
}: {
  pUsdBalance: number | null; pUsdAllowance: number | null; spendablePusd: number | null;
  liquidPusd: number | null; inPositions: number; claimableValue: number; lockedOrdersValue: number;
  lockedBuyCollateral: number; lockedSellValue: number; lockedSellShares: number;
  openOrdersCount: number; accountValue: number; collateralLoading: boolean;
  collateralError: string | null; clobReady: boolean; openOrdersLoading: boolean;
  onPrepareSession: () => void; onRefreshOrders: () => void; tradingWalletAddress?: string | null;
  stockValue: number; stocksLoading: boolean;
}) {
  const allowanceNeedsApproval = pUsdBalance !== null && pUsdBalance > 0 && (pUsdAllowance ?? 0) <= 0;
  const missingTradingWallet = !tradingWalletAddress;
  const awaitingBalance = !missingTradingWallet && !collateralLoading && pUsdBalance === null && !collateralError;
  const healthyBalanceRoute = !missingTradingWallet && !awaitingBalance && !allowanceNeedsApproval && !collateralError;

  const statusTone = allowanceNeedsApproval ? "gold" : collateralError ? "red" : healthyBalanceRoute ? "green" : "muted";
  const statusMessage = missingTradingWallet
    ? "Connect your wallet to see your balance."
    : allowanceNeedsApproval ? "Funds loaded — enable trading to place your next order."
    : collateralError ? collateralError
    : awaitingBalance ? "Sync your account to see your balance."
    : "All good — your account is up to date.";

  return (
    <div className="surface-card rounded-2xl p-5 sm:p-6">
      <div className="flex items-center justify-between gap-4">
        <span className="text-sm font-semibold text-foreground">Funds</span>
        <Button
          type="button"
          variant="secondary"
          onClick={clobReady ? onRefreshOrders : onPrepareSession}
          disabled={missingTradingWallet || openOrdersLoading}
          className="h-8 rounded-xl border border-[oklch(0.22_0.015_255)] bg-transparent px-3 text-[10px] font-semibold text-muted-foreground hover:bg-[oklch(0.16_0.014_255)] hover:text-foreground disabled:opacity-40"
        >
          {openOrdersLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          {clobReady ? "Sync" : "Activate"}
        </Button>
      </div>

      <div className="mt-5 space-y-3">
        {/* Primary balance row */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-[oklch(0.20_0.014_255)] bg-[oklch(0.12_0.012_260/0.65)] p-4">
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Balance</div>
            <div className="mt-2 font-mono text-2xl font-bold text-foreground">{collateralLoading ? "…" : formatPusd(pUsdBalance)}</div>
            <div className="mt-1 text-[11px] text-muted-foreground">Ready to trade</div>
          </div>
          <div className="rounded-2xl border border-[oklch(0.78_0.16_82/0.18)] bg-[oklch(0.78_0.16_82/0.05)] p-4">
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Stocks</div>
            <div className="mt-2 font-mono text-2xl font-bold text-foreground">{stocksLoading && stockValue === 0 ? "…" : formatPortfolioMoney(stockValue)}</div>
            <div className="mt-1 text-[11px] text-muted-foreground">{stockValue > 0 ? "Current value" : "No holdings"}</div>
          </div>
        </div>
        {/* Secondary row — smaller details */}
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl border border-[oklch(0.20_0.014_255)] bg-[oklch(0.10_0.010_260/0.5)] px-3 py-2.5">
            <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/70">In positions</div>
            <div className="mt-1.5 font-mono text-[13px] font-bold text-foreground">{formatPortfolioMoney(inPositions)}</div>
          </div>
          <div className="rounded-xl border border-[oklch(0.70_0.11_210/0.20)] bg-[oklch(0.70_0.11_210/0.05)] px-3 py-2.5">
            <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/70">Claimable</div>
            <div className="mt-1.5 font-mono text-[13px] font-bold text-[oklch(0.76_0.13_210)]">{formatPortfolioMoney(claimableValue)}</div>
          </div>
          <div className="rounded-xl border border-[oklch(0.20_0.014_255)] bg-[oklch(0.10_0.010_260/0.5)] px-3 py-2.5">
            <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/70">In orders</div>
            <div className="mt-1.5 font-mono text-[13px] font-bold text-foreground">{formatPortfolioMoney(lockedOrdersValue)}</div>
          </div>
        </div>
      </div>

      <BalanceBar
        liquid={liquidPusd ?? 0}
        inPositions={inPositions}
        claimable={claimableValue}
        locked={lockedOrdersValue}
        total={(liquidPusd ?? 0) + inPositions + claimableValue + lockedOrdersValue}
      />

      {/* Status indicator — compact, no technical plumbing */}
      <div
        className={cn(
          "mt-4 rounded-2xl border px-4 py-3 text-[11px] leading-snug",
          statusTone === "gold" && "border-[oklch(0.78_0.16_82/0.25)] bg-[oklch(0.78_0.16_82/0.07)] text-[oklch(0.82_0.16_82)]",
          statusTone === "red" && "border-[oklch(0.58_0.2_25/0.30)] bg-[oklch(0.58_0.2_25/0.07)] text-[oklch(0.68_0.2_25)]",
          statusTone === "green" && "border-[oklch(0.68_0.18_155/0.22)] bg-[oklch(0.68_0.18_155/0.07)] text-[oklch(0.68_0.18_155)]",
          statusTone === "muted" && "border-[oklch(0.20_0.014_255)] bg-[oklch(0.12_0.012_260/0.50)] text-muted-foreground",
        )}
      >
        {statusMessage}
      </div>
    </div>
  );
}

function claimActionLabel(status: string, active: boolean) {
  if (!active) return "Claim";
  if (status === "preparing") return "Preparing";
  if (status === "signing") return "Sign claim";
  if (status === "approving") return "Approving";
  if (status === "claiming") return "Claiming";
  if (status === "confirming") return "Confirming";
  if (status === "claimed") return "Claimed";
  return "Claim";
}

function ClaimableSettlementsCard({
  groups,
  total,
  status,
  claimingKey,
  busy,
  relayedMode,
  onClaim,
  onClaimAll,
}: {
  groups: ClaimablePositionGroup[];
  total: number;
  status: string;
  claimingKey: string | null;
  busy: boolean;
  relayedMode: boolean;
  onClaim: (group: ClaimablePositionGroup) => void;
  onClaimAll: () => void;
}) {
  if (!groups.length) return null;

  return (
    <div className="surface-card rounded-2xl border border-[oklch(0.70_0.11_210/0.25)] bg-[oklch(0.70_0.11_210/0.05)] p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[oklch(0.70_0.11_210/0.28)] bg-[oklch(0.70_0.11_210/0.10)]">
            <CircleDollarSign className="h-5 w-5 text-[oklch(0.76_0.13_210)]" />
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[oklch(0.76_0.13_210)]">Winnings to Claim</div>
            <div className="mt-1 text-xl font-bold tracking-tight text-foreground sm:text-2xl">{formatPortfolioMoney(total)}</div>
            <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted-foreground">
              Your settled positions have won. Click Claim to convert them to your trading balance.
            </p>
          </div>
        </div>

        {groups.length > 1 && (
          <Button
            type="button"
            onClick={onClaimAll}
            disabled={busy}
            className="h-11 rounded-xl bg-[oklch(0.78_0.16_82)] px-4 text-sm font-bold text-[oklch(0.10_0.012_260)] hover:bg-[oklch(0.83_0.16_82)] disabled:opacity-50 sm:h-9 sm:text-xs"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin sm:h-3.5 sm:w-3.5" /> : <CheckCircle2 className="h-4 w-4 sm:h-3.5 sm:w-3.5" />}
            Claim all
          </Button>
        )}
      </div>

      <div className="mt-4 grid gap-2">
        {groups.map((group) => {
          const active = claimingKey === group.key;
          return (
            <div
              key={group.key}
              className="flex flex-col gap-3 rounded-xl border border-[oklch(0.20_0.014_255)] bg-[oklch(0.10_0.012_260/0.65)] p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-foreground">{group.title}</div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  <span>{group.outcome}</span>
                  <span className="h-1 w-1 rounded-full bg-muted-foreground/40" />
                  <span>{formatPortfolioNumber(group.size)} shares</span>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 sm:justify-end">
                <div className="font-mono text-base font-bold text-[oklch(0.76_0.13_210)]">{formatPortfolioMoney(group.value)}</div>
                <Button
                  type="button"
                  onClick={() => onClaim(group)}
                  disabled={busy}
                  className="h-10 min-w-[104px] rounded-xl bg-[oklch(0.78_0.16_82)] px-4 text-sm font-bold text-[oklch(0.10_0.012_260)] hover:bg-[oklch(0.83_0.16_82)] disabled:opacity-50 sm:h-9 sm:text-xs"
                >
                  {active && busy ? <Loader2 className="h-4 w-4 animate-spin sm:h-3.5 sm:w-3.5" /> : <CheckCircle2 className="h-4 w-4 sm:h-3.5 sm:w-3.5" />}
                  {claimActionLabel(status, active)}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

type TimelineItemData = {
  id: string; title: string; detail: string; meta: string;
  tone: "green" | "gold" | "red" | "muted";
  icon: React.ComponentType<{ className?: string }>;
};

function TimelineItem({ item }: { item: TimelineItemData }) {
  return (
    <div className="flex gap-3 py-3 border-b border-[oklch(0.14_0.012_260)] last:border-0">
      <div className={cn(
        "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border",
        item.tone === "green" && "border-[oklch(0.68_0.18_155/0.22)] bg-[oklch(0.68_0.18_155/0.08)] text-[oklch(0.68_0.18_155)]",
        item.tone === "gold" && "border-[oklch(0.78_0.16_82/0.22)] bg-[oklch(0.78_0.16_82/0.08)] text-[oklch(0.78_0.16_82)]",
        item.tone === "red" && "border-[oklch(0.60_0.18_25/0.22)] bg-[oklch(0.60_0.18_25/0.08)] text-[oklch(0.60_0.18_25)]",
        item.tone === "muted" && "border-[oklch(0.20_0.014_255)] bg-[oklch(0.12_0.012_260)] text-muted-foreground"
      )}>
        <item.icon className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[13px] font-semibold text-foreground">{item.title}</span>
          <span className="shrink-0 text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{item.meta}</span>
        </div>
        <p className="mt-0.5 text-[11px] leading-5 text-muted-foreground">{item.detail}</p>
      </div>
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

function PortfolioContent() {
  const router = useRouter();
  const { ready, authenticated, login } = usePrivy();
  const activePrivyWallet = useActivePrivyWallet();
  const walletAddress = activePrivyWallet.walletAddress;
  const connectedWallet = activePrivyWallet.wallet;
  const polymarketDepositWallet = usePolymarketDepositWallet(connectedWallet);
  const profileConnectedWalletAddress = walletAddress ?? null;
  const tradingProfile = useTradingProfile(
    profileConnectedWalletAddress,
    polymarketDepositWallet.address,
    polymarketDepositWallet.address ? "deposit" : undefined
  );
  const tradingWalletAddress = tradingProfile.profile?.tradingWalletAddress ?? null;
  const depositAddress = tradingProfile.profile?.depositAddress?.evm ?? null;
  const portfolio = usePolymarketPortfolio(tradingWalletAddress, 30_000);
  const fundingStatus = useFundingStatus(depositAddress, { active: Boolean(depositAddress), intervalMs: 15_000 });
  const clobSession = useClobSession(connectedWallet, tradingProfile.profile);
  const readiness = useTradeReadiness({ connectedWalletAddress: walletAddress, profile: tradingProfile.profile });
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<PortfolioTab>("positions");
  const [cancelingOrderId, setCancelingOrderId] = useState<string | null>(null);
  const [fundingOpen, setFundingOpen] = useState(false);

  // Stock holdings — reads BNB chain token balances + live quotes
  const stockHoldings = useStockHoldings(connectedWallet, walletAddress);

  const data = portfolio.data;
  const openPositions = data?.positions ?? [];
  const closedPositions = data?.closedPositions ?? [];
  const trades = data?.trades ?? [];
  const portfolioWarning = portfolio.error && portfolio.data ? portfolio.error : null;
  const allErrorsRaw = error ?? tradingProfile.error ?? (portfolio.data ? null : portfolio.error) ?? fundingStatus.error ?? clobSession.error;
  const allErrors = allErrorsRaw ? friendlyErrorMessage(allErrorsRaw, "Portfolio action failed. Please try again.", "portfolio") : null;
  const claimableGroups = useMemo(() => groupClaimablePositions(closedPositions), [closedPositions]);
  const claimableValue = useMemo(
    () => claimableGroups.reduce((total, group) => total + group.value, 0),
    [claimableGroups]
  );

  const refreshAfterClaim = useCallback(async () => {
    await Promise.allSettled([
      portfolio.refresh(),
      fundingStatus.refresh(),
      readiness.refresh(),
      clobSession.refreshBalanceAllowance(),
    ]);
    scheduleAccountRefresh({ reason: "settled_position_claimed", address: tradingWalletAddress });
  }, [clobSession, fundingStatus, portfolio, readiness, tradingWalletAddress]);

  const settledClaims = useSettledPositionClaims({
    wallet: connectedWallet,
    ownerAddress: walletAddress,
    tradingWalletAddress,
    tradingWalletKind: tradingProfile.profile?.tradingWalletKind ?? null,
    onClaimed: refreshAfterClaim,
  });

  const stats = useMemo(() => {
    const openValue = openPositions.reduce((t: number, p: any) => t + getPositionValue(p), 0);
    const shares = openPositions.reduce((t: number, p: any) => t + valueOf(p?.size, p?.position_size), 0);
    const openPnl = openPositions.reduce((t: number, p: any) => t + getPositionPnl(p), 0);
    const costBasis = openPositions.reduce((t: number, p: any) => t + getPositionCostBasis(p), 0);
    const avgPnlPercent = costBasis
      ? (openPnl / costBasis) * 100
      : openPositions.length
      ? openPositions.reduce((t: number, p: any) => t + getPositionPnlPercent(p), 0) / openPositions.length
      : 0;
    return {
      openValue, shares, openPnl, costBasis, avgPnlPercent,
      unrealizedPositive: portfolio.summary.unrealizedRaw >= 0,
      realizedPositive: portfolio.summary.realizedRaw >= 0,
    };
  }, [openPositions, portfolio.summary.realizedRaw, portfolio.summary.unrealizedRaw]);

  const collateral = readiness.readiness?.collateral ?? null;
  const pUsdBalance = collateral ? collateralAmount(collateral.balance) : null;
  const pUsdAllowance = collateral ? collateralAmount(collateral.allowance) : null;
  const spendablePusd = pUsdBalance === null || pUsdAllowance === null ? null : Math.min(pUsdBalance, pUsdAllowance);
  const openOrderSummary = useMemo(() => summarizeOpenOrders(clobSession.openOrders), [clobSession.openOrders]);
  const liquidPusd = spendablePusd === null ? null : Math.max(0, spendablePusd - openOrderSummary.buyCollateral);
  // Total account value = prediction balance + open positions + claimable + stock holdings
  const accountValue = (pUsdBalance ?? 0) + stats.openValue + claimableValue + stockHoldings.totalValue;

  const accountRefreshRef = useRef({
    portfolioRefresh: portfolio.refresh, fundingRefresh: fundingStatus.refresh,
    readinessRefresh: readiness.refresh, openOrdersRefresh: clobSession.refreshOpenOrders,
    clobStatus: clobSession.status, tradingWalletAddress,
  });

  useEffect(() => {
    accountRefreshRef.current = {
      portfolioRefresh: portfolio.refresh, fundingRefresh: fundingStatus.refresh,
      readinessRefresh: readiness.refresh, openOrdersRefresh: clobSession.refreshOpenOrders,
      clobStatus: clobSession.status, tradingWalletAddress,
    };
  });

  useEffect(() => {
    return addAccountRefreshListener((detail) => {
      const current = accountRefreshRef.current;
      if (detail.address && current.tradingWalletAddress &&
        detail.address.toLowerCase() !== current.tradingWalletAddress.toLowerCase()) return;
      void current.portfolioRefresh();
      void current.fundingRefresh();
      void current.readinessRefresh();
      if (current.clobStatus === "ready") void current.openOrdersRefresh();
    });
  }, []);

  useEffect(() => {
    if (clobSession.status === "ready") void clobSession.refreshOpenOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clobSession.status]);

  const timelineItems = useMemo<TimelineItemData[]>(() => {
    const items: TimelineItemData[] = [];
    if (tradingWalletAddress) {
      items.push({ id: "trading-wallet", title: "Wallet connected",
        detail: `Trading account ${shortAddress(tradingWalletAddress)} is active.`,
        meta: "Wallet", tone: "green", icon: ShieldCheck });
    } else {
      items.push({ id: "trading-wallet-pending", title: "Wallet not connected",
        detail: "Connect your wallet to load your portfolio and start trading.",
        meta: "Wallet", tone: "gold", icon: Wallet });
    }
    if (collateral) {
      items.push({ id: "collateral", title: "Balance synced",
        detail: `${formatPusd(pUsdBalance)} available in your trading account.`,
        meta: "Funds", tone: spendablePusd && spendablePusd > 0 ? "green" : "gold", icon: CircleDollarSign });
    } else if (walletAddress) {
      items.push({ id: "collateral-pending", title: "Balance not loaded",
        detail: readiness.loading ? "Loading your balance…" : readiness.error ?? "Sync your account to load your balance.",
        meta: "Funds", tone: readiness.error ? "red" : "gold", icon: CircleDollarSign });
    }
    if (fundingStatus.latest) {
      items.push({ id: `bridge-${fundingStatus.latest.txHash ?? fundingStatus.latest.createdTimeMs ?? "latest"}`,
        title: `Deposit ${fundingStatus.label.toLowerCase()}`,
        detail: `${fundingStatus.message}${fundingStatus.latest.txHash ? ` · ${shortHash(fundingStatus.latest.txHash)}` : ""}`,
        meta: formatTime(fundingStatus.latest.createdTimeMs),
        tone: fundingStatus.phase === "failed" ? "red" : fundingStatus.phase === "completed" ? "green" : "gold",
        icon: fundingStatus.phase === "completed" ? CheckCircle2 : Send });
    } else if (depositAddress) {
      items.push({ id: "bridge-waiting", title: "Ready to receive funds",
        detail: `Your deposit address is set up and ready to receive.`,
        meta: "Funding", tone: "muted", icon: Send });
    }
    if (clobSession.status === "ready") {
      items.push({ id: "open-orders",
        title: clobSession.openOrders.length ? "Open orders loaded" : "No open orders",
        detail: clobSession.openOrders.length
          ? `${clobSession.openOrders.length} active order${clobSession.openOrders.length !== 1 ? "s" : ""}. ${formatPortfolioMoney(openOrderSummary.totalValue)} reserved.`
          : "Session active — no orders pending.",
        meta: "Orders", tone: clobSession.openOrders.length ? "gold" : "green", icon: Lock });
    }
    trades.slice(0, 6).forEach((trade: any, i: number) => {
      const side = String(trade?.side ?? "TRADE").toUpperCase();
      items.push({ id: `trade-${trade?.transactionHash ?? trade?.id ?? i}`,
        title: side === "BUY" ? "Bought" : side === "SELL" ? "Sold" : "Trade executed",
        detail: `${trade?.market ?? trade?.condition_id ?? "Polymarket"}${trade?.price ? ` at ${formatPrice(trade.price)}` : ""}${trade?.size ? ` · ${formatPortfolioNumber(trade.size)} sh` : ""}.`,
        meta: formatTime(trade?.timestamp ?? trade?.createdAt ?? trade?.created_at),
        tone: side === "BUY" ? "green" : side === "SELL" ? "gold" : "muted",
        icon: side === "BUY" ? TrendingUp : ArrowDownUp });
    });
    if (items.length === 0) {
      items.push({ id: "empty", title: "No activity yet",
        detail: "Funding, trades, and withdrawals will appear here.",
        meta: "Timeline", tone: "muted", icon: Activity });
    }
    return items.slice(0, 10);
  }, [
    collateral, depositAddress, fundingStatus.label, fundingStatus.latest, fundingStatus.message, fundingStatus.phase,
    clobSession.openOrders, clobSession.status, openOrderSummary.totalValue, pUsdBalance, readiness.error,
    readiness.loading, spendablePusd, trades, tradingProfile.profile?.tradingWalletKind, tradingWalletAddress, walletAddress,
  ]);

  const handleConnectWallet = async () => {
    try {
      if (!process.env.NEXT_PUBLIC_PRIVY_APP_ID) throw new Error("Privy app ID missing.");
      await login();
      setError(null);
    } catch (err: any) {
      setError(err?.message ?? "Wallet connection failed");
    }
  };

  const handleCancelOpenOrder = async (orderId: string) => {
    setCancelingOrderId(orderId);
    const canceled = await clobSession.cancelOpenOrder(orderId);
    setCancelingOrderId(null);
    if (canceled) {
      toast.success("Order cancelled", { description: `Order ${shortHash(orderId)} removed.` });
      await clobSession.refreshBalanceAllowance();
      await readiness.refresh();
      scheduleAccountRefresh({ reason: "order_cancelled", address: tradingWalletAddress });
    } else {
      toast.error("Cancel failed", {
        description: friendlyErrorMessage(clobSession.error, "Order may have filled or expired.", "trade"),
      });
    }
  };

  const openPositionMarket = (position: any, routeId: unknown, query?: URLSearchParams) => {
    if (!routeId) return;
    const identifier = String(routeId);
    cachePortfolioPositionForDetail(position, identifier);
    router.push(`/markets/${encodeURIComponent(identifier)}${query ? `?${query.toString()}` : ""}`);
  };

  const handleRefreshAll = () => {
    portfolio.refresh();
    fundingStatus.refresh();
    readiness.refresh();
    if (clobSession.status === "ready") void clobSession.refreshOpenOrders();
  };

  const handleFundingSent = () => {
    void tradingProfile.refresh();
    void fundingStatus.refresh();
    void readiness.refresh();
    void portfolio.refresh();
  };

  useEffect(() => {
    if (!settledClaims.error) return;
    toast.error("Claim failed", { description: settledClaims.error });
  }, [settledClaims.error]);

  const handleClaimGroup = async (group: ClaimablePositionGroup) => {
    const result = await settledClaims.claim(group);
    if (!result) return;
    toast.success("Claim submitted", {
      description: result.relayed
        ? "Your winnings are being converted. Your balance will update shortly."
        : result.txHash
        ? `Transaction ${shortHash(result.txHash)} confirmed.`
        : "Your winnings are being converted to your balance.",
    });
  };

  const handleClaimAll = async () => {
    for (const group of claimableGroups) {
      const result = await settledClaims.claim(group);
      if (!result) return;
    }
    toast.success("Claims submitted", {
      description: "Claimable settled positions were sent for redemption.",
    });
  };

  return (
    <div className="terminal-grid-bg ambient-glow flex min-h-screen flex-col bg-background">
      <Navbar />
      <main className="relative z-10 mx-auto flex w-full max-w-7xl flex-1 flex-col px-4 rawli-page-bottom rawli-page-top sm:px-6 lg:px-8">

        {/* ── Header ─────────────────────────────────────── */}

        {/* ─ Mobile header ─ */}
        <div className="sm:hidden pt-3">
          {/* Title row */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-foreground">Portfolio</span>
              {portfolio.loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
              {!portfolio.loading && portfolio.lastUpdated && (
                <span className="h-1.5 w-1.5 rounded-full bg-[oklch(0.68_0.18_155)] pulse-dot" />
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={handleRefreshAll}
                disabled={portfolio.loading || !tradingWalletAddress}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-[oklch(0.22_0.015_255)] text-muted-foreground disabled:opacity-40 active:scale-95"
                aria-label="Refresh"
              >
                <RefreshCw className={cn("h-3.5 w-3.5", portfolio.loading && "animate-spin")} />
              </button>
              <button
                type="button"
                onClick={() => setFundingOpen(true)}
                disabled={!walletAddress || tradingProfile.loading || !tradingProfile.profile}
                className="flex h-8 items-center gap-1.5 rounded-lg bg-[oklch(0.78_0.16_82)] px-3 text-[11px] font-bold text-[oklch(0.10_0.012_260)] disabled:opacity-40 active:scale-95"
              >
                <Wallet className="h-3.5 w-3.5" />
                Fund
              </button>
            </div>
          </div>

          {/* Account value — large, centered */}
          <div className="mt-5 text-center">
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground/60 mb-3">Total balance</p>
            <h1 className="text-[48px] font-bold tracking-tight text-foreground leading-none">
              {data || pUsdBalance !== null || stockHoldings.totalValue > 0 ? formatPortfolioMoney(accountValue) : "$0.00"}
            </h1>

            {/* Single clean P&L row */}
            <div className="mt-4 flex items-center justify-center gap-3">
              {/* Unrealized gains */}
              {/* Unrealized — open prediction positions */}
              <div className={cn(
                "flex items-center gap-1.5 rounded-2xl px-4 py-2 text-[12px] font-semibold",
                stats.unrealizedPositive
                  ? "bg-[oklch(0.68_0.18_155/0.10)] text-[oklch(0.72_0.18_155)]"
                  : "bg-[oklch(0.60_0.18_25/0.10)] text-[oklch(0.64_0.18_25)]"
              )}>
                {stats.unrealizedPositive ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                <span>{data ? portfolio.summary.unrealized : "—"}</span>
                <span className="text-[10px] opacity-60">predictions</span>
              </div>

              {/* Stocks day P&L */}
              {stockHoldings.totalValue > 0 && (
                <div className={cn(
                  "flex items-center gap-1.5 rounded-2xl px-4 py-2 text-[12px] font-semibold",
                  stockHoldings.totalDayPnl >= 0
                    ? "bg-[oklch(0.68_0.18_155/0.07)] text-[oklch(0.72_0.18_155)]"
                    : "bg-[oklch(0.60_0.18_25/0.07)] text-[oklch(0.64_0.18_25)]"
                )}>
                  {stockHoldings.totalDayPnl >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                  <span>{stockHoldings.totalDayPnl >= 0 ? "+" : ""}{new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(stockHoldings.totalDayPnl)}</span>
                  <span className="text-[10px] opacity-60">stocks today</span>
                </div>
              )}
            </div>

            {/* Claimable + stocks secondary line */}
            {(claimableValue > 0 || stockHoldings.totalValue > 0) && (
              <div className="mt-2 flex items-center justify-center gap-2">
                {claimableValue > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-[oklch(0.70_0.11_210/0.28)] bg-[oklch(0.70_0.11_210/0.08)] px-3 py-1 text-[11px] font-semibold text-[oklch(0.76_0.13_210)]">
                    <CircleDollarSign className="h-3 w-3" />
                    {formatPortfolioMoney(claimableValue)} claimable
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ─ Desktop header ─ */}
        <div className="hidden sm:flex items-start justify-between gap-4 pt-6">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-bold uppercase tracking-[0.22em] text-muted-foreground">My Portfolio</span>
              {walletAddress && (
                <span className="rounded-full border border-[oklch(0.22_0.015_255)] bg-[oklch(0.14_0.012_260)] px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                  {shortAddress(walletAddress)}
                </span>
              )}
            </div>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              {data || pUsdBalance !== null || stockHoldings.totalValue > 0 ? formatPortfolioMoney(accountValue) : "—"}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-semibold",
                stats.unrealizedPositive
                  ? "border-[oklch(0.68_0.18_155/0.30)] bg-[oklch(0.68_0.18_155/0.08)] text-[oklch(0.72_0.18_155)]"
                  : "border-[oklch(0.60_0.18_25/0.30)] bg-[oklch(0.60_0.18_25/0.08)] text-[oklch(0.64_0.18_25)]"
              )}>
                {stats.unrealizedPositive ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
                Unrealized {data ? portfolio.summary.unrealized : "—"}
              </span>
              <span className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-semibold",
                stats.realizedPositive
                  ? "border-[oklch(0.68_0.18_155/0.20)] bg-[oklch(0.68_0.18_155/0.05)] text-[oklch(0.72_0.18_155)]"
                  : "border-[oklch(0.60_0.18_25/0.20)] bg-[oklch(0.60_0.18_25/0.05)] text-[oklch(0.64_0.18_25)]"
              )}>
                Realized {data ? portfolio.summary.realized : "—"}
              </span>
              {claimableValue > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full border border-[oklch(0.70_0.11_210/0.28)] bg-[oklch(0.70_0.11_210/0.08)] px-2.5 py-1 text-[10px] font-semibold text-[oklch(0.76_0.13_210)]">
                  <CircleDollarSign className="h-2.5 w-2.5" />
                  Claimable {formatPortfolioMoney(claimableValue)}
                </span>
              )}
              {portfolio.loading ? (
                <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> Syncing
                </span>
              ) : portfolio.lastUpdated ? (
                <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <span className="h-1.5 w-1.5 rounded-full bg-[oklch(0.68_0.18_155)] pulse-dot" />
                  Live · updated {portfolio.lastUpdated.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </span>
              ) : null}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setFundingOpen(true)}
              disabled={!walletAddress || tradingProfile.loading || !tradingProfile.profile}
              className="flex h-9 items-center gap-2 rounded-xl border border-[oklch(0.78_0.16_82/0.30)] bg-[oklch(0.78_0.16_82/0.08)] px-3 text-[11px] font-bold uppercase tracking-[0.10em] text-[oklch(0.82_0.16_82)] transition-colors hover:bg-[oklch(0.78_0.16_82/0.14)] disabled:opacity-40"
            >
              <Wallet className="h-3.5 w-3.5" />
              Fund account
            </button>
            <button
              onClick={handleRefreshAll}
              disabled={portfolio.loading || !tradingWalletAddress}
              className="flex h-9 items-center gap-2 rounded-xl border border-[oklch(0.22_0.015_255)] bg-transparent px-3 text-[11px] font-bold uppercase tracking-[0.10em] text-muted-foreground transition-colors hover:border-[oklch(0.78_0.16_82/0.35)] hover:text-foreground disabled:opacity-40"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", portfolio.loading && "animate-spin")} />
              Refresh
            </button>
            <Link
              href="/"
              className="flex h-9 items-center gap-2 rounded-xl bg-[oklch(0.78_0.16_82)] px-4 text-[11px] font-bold uppercase tracking-[0.10em] text-[oklch(0.10_0.012_260)] transition-colors hover:bg-[oklch(0.83_0.16_82)]"
            >
              <Zap className="h-3.5 w-3.5" />
              Markets
            </Link>
          </div>
        </div>

        {/* ── Error banner ────────────────────────────────── */}
        {allErrors && (
          <div className="mt-5 flex items-start gap-3 rounded-xl border border-[oklch(0.58_0.2_25/0.30)] bg-[oklch(0.58_0.2_25/0.07)] px-4 py-3 text-[12px] text-[oklch(0.68_0.2_25)]">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{allErrors}</span>
          </div>
        )}

        {portfolioWarning && !allErrors && (
          <div className="mt-5 flex items-start gap-3 rounded-xl border border-[oklch(0.74_0.16_85/0.30)] bg-[oklch(0.74_0.16_85/0.07)] px-4 py-3 text-[12px] text-[oklch(0.78_0.16_85)]">
            <RefreshCw className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{portfolioWarning}</span>
          </div>
        )}

        {/* ── Connect wallet prompt ───────────────────────── */}
        {!walletAddress && (
          <div className="mt-5 rounded-2xl border border-[oklch(0.22_0.015_255)] bg-[oklch(0.12_0.012_260/0.6)] px-4 py-4 sm:px-5">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[oklch(0.22_0.015_255)] bg-[oklch(0.15_0.014_255)]">
                  <Wallet className="h-4 w-4 text-[oklch(0.78_0.16_82)]" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-foreground">Connect your wallet to see your portfolio</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">View your open positions, track P&L, and manage trades from one place.</div>
                </div>
              </div>
              <Button
                onClick={handleConnectWallet}
                disabled={!ready}
                className="h-11 sm:h-9 w-full sm:w-auto shrink-0 rounded-xl bg-[oklch(0.78_0.16_82)] px-4 text-sm sm:text-xs font-bold text-[oklch(0.10_0.012_260)] hover:bg-[oklch(0.83_0.16_82)]"
              >
                {ready ? "Connect Wallet" : <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              </Button>
            </div>
          </div>
        )}

        {/* ── Top stats strip ─────────────────────────────── */}
        <div className="mt-5 grid grid-cols-3 gap-2.5">
          {/* Positions */}
          <div className="surface-card rounded-2xl p-4 flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/70">Open</span>
              <Layers3 className="h-3.5 w-3.5 text-[oklch(0.78_0.16_82)]" />
            </div>
            <div className="font-bold text-2xl text-foreground tabular-nums leading-none">
              {data ? openPositions.length + stockHoldings.holdings.length : "—"}
            </div>
            <div className="mt-1.5 text-[10px] text-muted-foreground">positions</div>
          </div>

          {/* Realized P&L */}
          <div className="surface-card rounded-2xl p-4 flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/70">P&amp;L</span>
              {stats.realizedPositive
                ? <TrendingUp className="h-3.5 w-3.5 text-[oklch(0.68_0.18_155)]" />
                : <TrendingDown className="h-3.5 w-3.5 text-[oklch(0.60_0.18_25)]" />}
            </div>
            <div className={cn("font-bold text-2xl tabular-nums leading-none",
              stats.realizedPositive ? "text-[oklch(0.68_0.18_155)]" : data ? "text-[oklch(0.60_0.18_25)]" : "text-foreground"
            )}>
              {data ? portfolio.summary.realized : "—"}
            </div>
            <div className="mt-1.5 text-[10px] text-muted-foreground">closed predictions</div>
          </div>

          {/* Claimable */}
          <div className={cn("rounded-2xl p-4 flex flex-col border",
            claimableValue > 0
              ? "bg-[oklch(0.70_0.11_210/0.07)] border-[oklch(0.70_0.11_210/0.22)]"
              : "surface-card border-transparent"
          )}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/70">Claim</span>
              <CircleDollarSign className={cn("h-3.5 w-3.5",
                claimableValue > 0 ? "text-[oklch(0.76_0.13_210)]" : "text-[oklch(0.78_0.16_82)]"
              )} />
            </div>
            <div className={cn("font-bold text-2xl tabular-nums leading-none",
              claimableValue > 0 ? "text-[oklch(0.76_0.13_210)]" : "text-foreground"
            )}>
              {data ? formatPortfolioMoney(claimableValue) : "—"}
            </div>
            <div className="mt-1.5 text-[10px] text-muted-foreground">
              {claimableValue > 0 ? "available" : "nothing yet"}
            </div>
          </div>
        </div>

        {/* ── Balance ledger ──────────────────────────────── */}
        <div className="mt-4">
          <BalanceLedgerCard
            pUsdBalance={pUsdBalance} pUsdAllowance={pUsdAllowance} spendablePusd={spendablePusd}
            liquidPusd={liquidPusd} inPositions={stats.openValue} claimableValue={claimableValue} lockedOrdersValue={openOrderSummary.totalValue}
            lockedBuyCollateral={openOrderSummary.buyCollateral} lockedSellValue={openOrderSummary.sellValue}
            lockedSellShares={openOrderSummary.sellShares} openOrdersCount={clobSession.openOrders.length}
            accountValue={accountValue} collateralLoading={readiness.loading} collateralError={readiness.error}
            clobReady={clobSession.status === "ready"}
            openOrdersLoading={clobSession.openOrdersStatus === "loading" || clobSession.status === "preparing"}
            onPrepareSession={() => void clobSession.prepareSession()}
            onRefreshOrders={() => void clobSession.refreshOpenOrders()}
            stockValue={stockHoldings.totalValue}
            stocksLoading={stockHoldings.loading}
            tradingWalletAddress={tradingWalletAddress}
          />
        </div>

        {claimableGroups.length > 0 && (
          <div className="mt-4">
            <ClaimableSettlementsCard
              groups={claimableGroups}
              total={claimableValue}
              status={settledClaims.status}
              claimingKey={settledClaims.claimingKey}
              busy={settledClaims.busy}
              relayedMode={settledClaims.relayedMode}
              onClaim={handleClaimGroup}
              onClaimAll={handleClaimAll}
            />
          </div>
        )}

        {/* ── Tabs — Orders & Closed only (Holdings unified below) ── */}
        <div className="mt-5 sm:mt-8 flex flex-col gap-2 sm:gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="grid grid-cols-3 gap-0.5 sm:gap-1 rounded-xl sm:rounded-2xl border border-[oklch(0.20_0.015_255)] bg-[oklch(0.10_0.012_260/0.65)] p-0.5 sm:p-1 w-full sm:w-auto">
            <TabButton active={activeTab === "positions"} count={openPositions.length + stockHoldings.holdings.length} onClick={() => setActiveTab("positions")}>
              Holdings
            </TabButton>
            <TabButton active={activeTab === "orders"} count={clobSession.openOrders.length} onClick={() => setActiveTab("orders")}>
              Orders
            </TabButton>
            <TabButton active={activeTab === "closed"} count={closedPositions.length} onClick={() => setActiveTab("closed")}>
              Closed
            </TabButton>
          </div>
          <div className="hidden sm:flex shrink-0 items-center gap-1.5 text-[10px] text-muted-foreground">
            <Clock3 className="h-3 w-3" />
            {portfolio.loading ? "Syncing…" : "Live data"}
          </div>
        </div>

        {/* ── Holdings tab — unified predictions + stocks ── */}
        {activeTab === "positions" && (
          <ComponentErrorBoundary>
            <UnifiedHoldings
              openPositions={openPositions}
              stockHoldings={stockHoldings.holdings}
              stocksLoading={stockHoldings.loading}
              walletConnected={Boolean(walletAddress)}
              formatMoney={formatPortfolioMoney}
              formatPnl={formatPortfolioPnl}
              formatPercent={formatPercent}
              formatPrice={formatPrice}
              formatPortfolioNumber={formatPortfolioNumber}
              formatTimeLeft={formatTimeLeft}
              positionLabel={positionLabel}
              positionOutcome={positionOutcome}
              getPositionPnl={getPositionPnl}
              getPositionPnlPercent={getPositionPnlPercent}
              getPositionValue={getPositionValue}
              getPositionEndTime={getPositionEndTime}
              marketRouteId={marketRouteId}
              onViewPosition={(pos, routeId) => openPositionMarket(pos, routeId)}
              onSellPosition={(pos, routeId) => {
                const outcome = positionOutcome(pos);
                const shares = valueOf(pos?.size, pos?.position_size);
                openPositionMarket(pos, routeId, new URLSearchParams({ side: "sell", outcome, shares: shares.toFixed(4) }));
              }}
            />
          </ComponentErrorBoundary>
        )}

                {/* ── Orders tab ──────────────────────────────────── */}
        {activeTab === "orders" && (
          <div className="mt-4">
            {clobSession.status !== "ready" ? (
              <EmptyState
                title="Load your session to see orders"
                description="Connect your trading session to view and manage your open orders."
                action={
                  <Button
                    onClick={() => void clobSession.prepareSession()}
                    disabled={!walletAddress || clobSession.status === "preparing"}
                    className="rounded-xl bg-[oklch(0.78_0.16_82)] text-[oklch(0.10_0.012_260)] hover:bg-[oklch(0.83_0.16_82)]"
                  >
                    {clobSession.status === "preparing" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
                    Load Orders
                  </Button>
                }
              />
            ) : clobSession.openOrdersStatus === "loading" ? (
              <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin text-[oklch(0.78_0.16_82)]" />
                <span className="text-sm">Loading orders…</span>
              </div>
            ) : clobSession.openOrders.length ? (
              <div className="surface-card overflow-hidden rounded-2xl">
                <div className="flex items-center justify-between border-b border-[oklch(0.18_0.014_255)] px-5 py-4">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Open Orders</span>
                    <div className="mt-1 text-base font-semibold text-foreground">
                      {clobSession.openOrders.length} active order{clobSession.openOrders.length !== 1 ? "s" : ""}
                    </div>
                  </div>
                  <button
                    onClick={() => void clobSession.refreshOpenOrders()}
                    className="flex h-8 items-center gap-1.5 rounded-lg border border-[oklch(0.22_0.015_255)] bg-transparent px-3 text-[11px] font-bold text-muted-foreground hover:text-foreground"
                  >
                    <RefreshCw className="h-3 w-3" /> Refresh
                  </button>
                </div>

                <div className="divide-y divide-[oklch(0.14_0.012_260)]">
                  {clobSession.openOrders.map((order) => {
                    const side = String(order.side ?? "ORDER").toUpperCase();
                    const remaining = orderRemainingSize(order);
                    const price = orderPrice(order);
                    const notional = orderNotional(order);
                    const marketHref = order.market ? `/markets/${encodeURIComponent(order.market)}` : null;
                    return (
                      <div key={order.id} className="px-5 py-4 transition-colors hover:bg-[oklch(0.12_0.012_260/0.5)]">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5 mb-2">
                              <span className={cn(
                                "rounded px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest",
                                side === "BUY" ? "bg-[oklch(0.68_0.18_155/0.12)] text-[oklch(0.68_0.18_155)]"
                                : "bg-[oklch(0.60_0.18_25/0.12)] text-[oklch(0.64_0.18_25)]"
                              )}>
                                {side}
                              </span>
                              <span className="rounded border border-[oklch(0.78_0.16_82/0.20)] bg-[oklch(0.78_0.16_82/0.07)] px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-[oklch(0.78_0.16_82)]">
                                {order.orderType ?? "GTC"}
                              </span>
                              <span className="font-mono text-[10px] text-muted-foreground">{shortHash(order.id)}</span>
                            </div>
                            <div className="text-[13px] font-semibold text-foreground">
                              {order.outcome ?? "Outcome"}
                            </div>
                            {order.expiration && (
                              <div className="mt-0.5 text-[10px] text-muted-foreground">Expires {formatTime(Number(order.expiration) * 1000)}</div>
                            )}
                          </div>

                          <div className="flex shrink-0 flex-col items-end gap-1">
                            <div className="font-mono text-base font-bold text-foreground">{formatPortfolioMoney(notional)}</div>
                            <div className="text-[10px] text-muted-foreground">{side === "BUY" ? "reserved" : "shares on offer"}</div>
                          </div>
                        </div>

                        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                          <div className="flex gap-4">
                            <StatPill label="Remaining" value={`${formatPortfolioNumber(remaining)} sh`} />
                            <StatPill label="Limit" value={price ? `${(price * 100).toFixed(1)}¢` : "—"} />
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => marketHref && router.push(marketHref)}
                              disabled={!marketHref}
                              className="flex h-7 items-center gap-1 rounded-lg border border-[oklch(0.22_0.015_255)] bg-transparent px-2.5 text-[10px] font-bold text-muted-foreground hover:text-foreground disabled:opacity-40"
                            >
                              View <ChevronRight className="h-3 w-3" />
                            </button>
                            <button
                              onClick={() => void handleCancelOpenOrder(order.id)}
                              disabled={cancelingOrderId === order.id}
                              className="flex h-7 items-center gap-1 rounded-lg border border-[oklch(0.60_0.18_25/0.30)] bg-transparent px-2.5 text-[10px] font-bold text-[oklch(0.64_0.18_25)] hover:bg-[oklch(0.60_0.18_25/0.10)] disabled:opacity-40"
                            >
                              {cancelingOrderId === order.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Cancel"}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <EmptyState
                title="No open orders"
                description="You don't have any active orders right now."
                action={
                  <button
                    onClick={() => void clobSession.refreshOpenOrders()}
                    className="flex items-center gap-2 rounded-xl border border-[oklch(0.22_0.015_255)] bg-transparent px-4 py-2 text-sm font-semibold text-muted-foreground hover:text-foreground"
                  >
                    <RefreshCw className="h-4 w-4" /> Refresh
                  </button>
                }
              />
            )}
          </div>
        )}

        {/* ── Closed tab ──────────────────────────────────── */}
        {activeTab === "closed" && (
          <div className="mt-4">
            {closedPositions.length ? (
              <div className="surface-card overflow-hidden rounded-2xl">
                <div className="border-b border-[oklch(0.18_0.014_255)] px-5 py-4">
                  <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Closed positions</span>
                  <div className="mt-1 text-base font-semibold text-foreground">{closedPositions.length} resolved</div>
                </div>
                <div className="overflow-x-auto">
                  <div className="min-w-[760px]">
                    <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-4 border-b border-[oklch(0.16_0.014_255)] px-5 py-2.5 text-[9px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                      <span>Market</span><span>Size</span><span>Value</span><span>Status</span><span className="text-right">Action</span>
                    </div>
                    {closedPositions.map((pos: any, idx: number) => {
                      const claimGroup = groupClaimablePositions([pos])[0];
                      const claimingThis = claimGroup ? settledClaims.claimingKey === claimGroup.key : false;
                      return (
                        <div
                          key={`closed-${idx}`}
                          className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-4 border-b border-[oklch(0.13_0.012_260)] px-5 py-3.5 last:border-0 transition-colors hover:bg-[oklch(0.12_0.012_260/0.5)]"
                        >
                          <span className="truncate text-[13px] font-medium text-foreground">{positionLabel(pos)}</span>
                          <span className="font-mono text-[12px] text-muted-foreground tabular-nums">{formatPortfolioNumber(pos?.size ?? pos?.position_size)}</span>
                          <span className="font-mono text-[12px] text-muted-foreground tabular-nums">{formatPortfolioMoney(getPositionValue(pos))}</span>
                          <span className="text-[11px] font-semibold text-muted-foreground">{closedPositionStatus(pos)}</span>
                          <span className="flex justify-end">
                            {claimGroup ? (
                              <button
                                type="button"
                                onClick={() => handleClaimGroup(claimGroup)}
                                disabled={settledClaims.busy}
                                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[oklch(0.78_0.16_82)] px-3 text-[11px] font-bold text-[oklch(0.10_0.012_260)] disabled:opacity-50"
                              >
                                {claimingThis && settledClaims.busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                                {claimActionLabel(settledClaims.status, claimingThis)}
                              </button>
                            ) : (
                              <span className="text-[11px] text-muted-foreground">—</span>
                            )}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <EmptyState
                title="No closed positions"
                description="Resolved markets and completed position history will appear here once trades settle."
              />
            )}
          </div>
        )}

        {/* ── Stocks tab ──────────────────────────────────── */}

                {/* ── Activity feed — full width ─────────────────────── */}
        <div className="mt-6 sm:mt-8">
          <div className="surface-card rounded-2xl flex flex-col min-h-[280px]">
            <ActivityFeed
              trades={trades}
              bridgeTxs={fundingStatus.transactions}
              bridgePhase={fundingStatus.phase}
              openPositions={openPositions}
              closedPositions={closedPositions}
              openOrders={clobSession.openOrders}
              loading={portfolio.loading || fundingStatus.loading}
              walletAddress={walletAddress}
            />
          </div>
        </div>

      </main>
      <ComponentErrorBoundary onReset={() => setFundingOpen(false)}>
        <BnbFundingModal
          open={fundingOpen}
          onOpenChange={setFundingOpen}
          initialTab="deposit"
          profile={tradingProfile.profile}
          depositAddress={depositAddress}
          loadingDeposit={tradingProfile.depositLoading}
          onCreateDepositAddress={tradingProfile.createDepositAddress}
          wallet={connectedWallet}
          collateralBalance={collateral?.balance ?? null}
          collateralAllowance={collateral?.allowance ?? null}
          collateralSessionReady={Boolean(collateral)}
          onRefreshCollateralBalance={readiness.refresh}
          onFundingSent={handleFundingSent}
        />
      </ComponentErrorBoundary>
      <Footer />
    </div>
  );
}

function MissingPrivyPortfolio() {
  return (
    <div className="terminal-grid-bg ambient-glow flex min-h-screen flex-col bg-background">
      <Navbar />
      <main className="relative z-10 mx-auto flex w-full max-w-7xl flex-1 px-4 rawli-page-bottom rawli-page-top sm:px-6 lg:px-8">
        <div className="surface-card mt-10 h-fit w-full rounded-2xl p-6 sm:p-8">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-[oklch(0.24_0.016_255)] bg-[oklch(0.15_0.014_255)]">
              <Wallet className="h-5 w-5 text-[oklch(0.78_0.16_82)]" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-foreground">Privy app ID required</h1>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Set NEXT_PUBLIC_PRIVY_APP_ID in apps/web/.env to enable wallet login and portfolio loading.
              </p>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}

export default function PortfolioPage() {
  return PRIVY_ENABLED ? <PortfolioContent /> : <MissingPrivyPortfolio />;
}
