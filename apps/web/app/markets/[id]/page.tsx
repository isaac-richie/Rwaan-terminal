"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowDownUp,
  Calculator,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Clock,
  Copy,
  Droplets,
  Loader2,
  Lock,
  RefreshCw,
  Send,
  ShieldAlert,
  TrendingUp,
  Unlock,
  Wallet,
} from "lucide-react";
import { usePrivy } from "@privy-io/react-auth";
import type { TradePreviewResponse } from "@smartmarket/types";

import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { BnbFundingModal } from "@/components/funding/bnb-funding-modal";
import { useActivePrivyWallet } from "@/hooks/use-active-privy-wallet";
import { GasAssistButton } from "@/components/funding/gas-assist-button";
import { useClobSession } from "@/hooks/use-clob-session";
import { useDepositWalletApproval } from "@/hooks/use-deposit-wallet-approval";
import { useDepositWalletStatus } from "@/hooks/use-deposit-wallet-status";
import { fundingStatusTone, useFundingStatus } from "@/hooks/use-funding-status";
import { useLiveOrderbooks } from "@/hooks/use-live-orderbook";
import { usePolymarketDepositWallet } from "@/hooks/use-polymarket-deposit-wallet";
import { useTradeReadiness } from "@/hooks/use-trade-readiness";
import { shortAddress, useTradingProfile } from "@/hooks/use-trading-profile";
import { scheduleAccountRefresh } from "@/lib/account-events";
import { readCachedMarketDetail, type CachedMarketDetail } from "@/lib/market-detail-cache";
import { cn } from "@/lib/utils";
import { CryptoAssetChart, detectCryptoAsset } from "@/components/charts/CryptoAssetChart";
import { PremiumAnalysisCard } from "@/components/market/premium-analysis-card";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

interface MarketDetail {
  id: string;
  title: string;
  category: string;
  outcomes: string[];
  prices: number[];
  tokenIds: string[];
  image?: string;
  endsAt?: string;
  volume24h?: string;
  liquidity?: string;
  description?: string;
}

const PERCENT_PRESETS = [
  { label: "25%", value: 0.25 },
  { label: "50%", value: 0.5 },
  { label: "75%", value: 0.75 },
  { label: "100%", value: 1 },
];

function parseStringArray(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  if (typeof raw !== "string") return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function parseNumberArray(raw: unknown): number[] {
  return parseStringArray(raw)
    .map(Number)
    .filter((value) => Number.isFinite(value));
}

function formatCents(price?: number | null) {
  if (price === null || price === undefined || !Number.isFinite(price)) return "--";
  return `${(price * 100).toFixed(1)}¢`;
}

function formatCompactUsd(raw?: string | null): string {
  if (!raw) return "$--";
  const text = String(raw).trim();
  const normalized = text.replace(/[$,\s]/g, "").toUpperCase();
  const suffix = normalized.match(/[KMB]$/)?.[0];
  const valueText = suffix ? normalized.slice(0, -1) : normalized;
  const parsed = Number(valueText.replace(/[^0-9.]/g, ""));
  const multiplier = suffix === "B" ? 1_000_000_000 : suffix === "M" ? 1_000_000 : suffix === "K" ? 1_000 : 1;
  const num = parsed * multiplier;
  if (!Number.isFinite(num) || num === 0) return "$--";
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `$${(num / 1_000).toFixed(1)}K`;
  return `$${num.toFixed(0)}`;
}

function previewErrorLabel(error: string) {
  const labels: Record<string, string> = {
    invalid_preview_payload: "Preview request is incomplete.",
    market_lookup_failed: "Market lookup failed. Try again in a moment.",
    market_not_found: "Market not found.",
    market_closed: "This market is closed.",
    token_not_in_market: "Selected outcome is not tradable on this market.",
    orderbook_unavailable: "This market has no active order book. It may be closed, resolved, or waiting for settlement.",
    orderbook_lookup_failed: "Order book lookup failed. Try again in a moment.",
  };
  return labels[error] ?? error;
}

function friendlyTradeError(error?: string | null) {
  const raw = String(error ?? "").toLowerCase();

  if (raw.includes("duplicat")) {
    return "This order was already submitted. Sign a fresh order and try again.";
  }

  if (
    raw.includes("transfer amount exceeds balance") ||
    raw.includes("insufficient funds") ||
    raw.includes("insufficient balance")
  ) {
    return "Your wallet does not have enough spendable funds for this order. Add funds or lower the amount, then try again.";
  }

  if (raw.includes("allowance") || raw.includes("approval")) {
    return "This order needs a fresh trading approval before it can be submitted.";
  }

  if (raw.includes("market") && raw.includes("closed")) {
    return "This market is closed, so new orders cannot be submitted.";
  }

  if (raw.includes("liquidity") || raw.includes("orderbook")) {
    return "There is not enough liquidity at that price right now. Try a smaller order or a limit order.";
  }

  if (raw.includes("region") || raw.includes("restricted")) {
    return "Trading is not available for this wallet or region right now.";
  }

  if (raw.includes("invalid") || raw.includes("bad request") || raw.includes("400")) {
    return "The order was rejected by the exchange. Please sign a new order and try again.";
  }

  return "We could not submit that order. Please check the amount and try again in a moment.";
}

function resolvesWithinHours(endDate: string | undefined, hours: number) {
  if (!endDate) return false;
  const endMs = new Date(endDate).getTime();
  if (!Number.isFinite(endMs)) return false;
  const diff = endMs - Date.now();
  return diff >= 0 && diff <= hours * 60 * 60 * 1000;
}

function hasPremiumAnalysisCached(marketId: string | null | undefined): boolean {
  if (!marketId || typeof window === "undefined") return false;
  try {
    return Boolean(localStorage.getItem(`smartmarket:premium:${marketId}`));
  } catch {
    return false;
  }
}

async function recordTradeRewardEvent(input: {
  wallet: string | null;
  tradingWalletAddress?: string | null;
  orderId?: string | null;
  marketId?: string | null;
  tokenId?: string | null;
  amountUsd: number;
  quickSettle: boolean;
  crypto: boolean;
  premium?: boolean;
  headers?: Record<string, string> | null;
}) {
  if (!input.wallet || !input.tradingWalletAddress || !input.marketId || !input.tokenId || !input.orderId || input.amountUsd <= 0 || !input.headers) return;
  try {
    await fetch(`${API_BASE}/points/events/trade`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...input.headers },
      body: JSON.stringify({
        wallet: input.wallet,
        tradingWalletAddress: input.tradingWalletAddress,
        orderId: input.orderId,
        marketId: String(input.marketId),
        tokenId: input.tokenId,
        amountUsd: input.amountUsd,
        quickSettle: input.quickSettle,
        crypto: input.crypto,
        premium: input.premium ?? false,
      }),
    });
  } catch {
    // Rewards are tracked opportunistically; trade execution should never depend on them.
  }
}

type TradeRewardCandidate = Omit<Parameters<typeof recordTradeRewardEvent>[0], "orderId" | "headers">;

async function fetchGammaMarketByQuery(query: Record<string, string>, matches?: (market: any) => boolean) {
  const params = new URLSearchParams(query);
  const res = await fetch(`${API_BASE}/gamma/markets?${params.toString()}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Market lookup failed.");
  const data = await res.json();
  const markets = Array.isArray(data) ? data : data ? [data] : [];
  const market = matches ? markets.find(matches) : markets[0];
  if (!market?.id) return null;
  return market;
}

function parseGammaTokenIds(market: any): string[] {
  const raw = market?.clobTokenIds ?? market?.clob_token_ids;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String);
  try {
    const parsed = JSON.parse(String(raw));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

async function fetchGammaEventPrimaryMarketByQuery(query: Record<string, string>) {
  const params = new URLSearchParams(query);
  const res = await fetch(`${API_BASE}/gamma/events?${params.toString()}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const data = await res.json();
  const event = Array.isArray(data) ? data[0] : data;
  if (!event || typeof event !== "object") return null;
  const markets = Array.isArray(event.markets) ? event.markets : [];
  return markets.find((m: any) => (m.active ?? true) && !m.closed) ?? markets[0] ?? null;
}

async function resolveGammaMarket(identifier: string) {
  const normalized = decodeURIComponent(identifier).trim();
  if (!normalized) return null;

  const attempts: Array<() => Promise<any>> = [];
  const numericIdentifier = /^\d+$/.test(normalized);
  if (numericIdentifier) {
    const tokenAttempts = [
      () => fetchGammaMarketByQuery({ clob_token_ids: normalized }, (market) => parseGammaTokenIds(market).includes(normalized)),
      () => fetchGammaMarketByQuery({ clobTokenIds: normalized }, (market) => parseGammaTokenIds(market).includes(normalized)),
      () => fetchGammaMarketByQuery({ token_id: normalized }, (market) => parseGammaTokenIds(market).includes(normalized)),
    ];
    const idAttempt = () => fetchGammaMarketByQuery({ id: normalized }, (market) => String(market.id) === normalized);

    if (normalized.length > 18) attempts.push(...tokenAttempts, idAttempt);
    else attempts.push(idAttempt, ...tokenAttempts);
  }

  const normalizedLower = normalized.toLowerCase();
  attempts.push(
    () => fetchGammaMarketByQuery({ slug: normalized }, (market) => String(market.slug ?? "").toLowerCase() === normalizedLower),
    () => fetchGammaMarketByQuery({ condition_id: normalized }, (market) => String(market.conditionId ?? market.condition_id ?? "").toLowerCase() === normalizedLower),
    () => fetchGammaMarketByQuery({ conditionId: normalized }, (market) => String(market.conditionId ?? market.condition_id ?? "").toLowerCase() === normalizedLower),
    () => fetchGammaEventPrimaryMarketByQuery({ slug: normalized }),
    () => fetchGammaEventPrimaryMarketByQuery({ id: normalized })
  );

  for (const attempt of attempts) {
    try {
      const market = await attempt();
      if (market?.id) return market;
    } catch {
      // Try the next identifier shape. Polymarket portfolio rows can expose
      // market id, market slug, event slug, or condition id depending on source.
    }
  }

  return null;
}

function marketDetailFromGamma(m: any): MarketDetail {
  const outcomes = parseStringArray(m.outcomes);
  const prices = parseNumberArray(m.outcomePrices ?? m.outcome_prices);
  const tokenIds = parseStringArray(m.clobTokenIds ?? m.clob_token_ids);

  return {
    id: String(m.id),
    title: String(m.question ?? "Untitled market"),
    description: m.description,
    category: m.category || "Events",
    outcomes: outcomes.length ? outcomes : ["Yes", "No"],
    prices,
    tokenIds,
    image: m.image || m.icon,
    endsAt: m.endDate ? new Date(m.endDate).toLocaleDateString() : "",
    volume24h: String(m.volume24hr ?? m.volume24h ?? m.volume_24h ?? m.volume_24hr ?? m.volume ?? ""),
    liquidity: String(m.liquidity ?? m.liquidityClob ?? ""),
  };
}

function marketDetailFromCache(cached: CachedMarketDetail): MarketDetail {
  return {
    id: cached.id,
    title: cached.title,
    description: cached.description,
    category: cached.category || "Events",
    outcomes: cached.outcomes.length ? cached.outcomes : ["Yes", "No"],
    prices: cached.prices.map((price) => (price > 1 ? price / 100 : price)),
    tokenIds: cached.tokenIds,
    image: cached.image || cached.icon,
    endsAt: cached.endsAt ? new Date(cached.endsAt).toLocaleDateString() : "",
    volume24h: cached.volume24h ?? "",
    liquidity: cached.liquidity ?? "",
  };
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

function formatPusd(raw?: string | null) {
  const value = collateralAmount(raw);
  if (!Number.isFinite(value)) return "$--";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value > 0 && value < 10 ? 2 : 0,
    maximumFractionDigits: 6,
  });
}

function formatShareInput(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "";
  return value.toFixed(4).replace(/\.?0+$/, "");
}

function collateralGate(balanceAllowance: { balance: string; allowance: string } | null, amountUsd: number) {
  if (!balanceAllowance) {
    return {
      ready: false,
      needsApproval: false,
      needsFunding: false,
      message: "Prepare the CLOB session so Rawli can check pUSD balance and allowance.",
    };
  }

  const balance = collateralAmount(balanceAllowance.balance);
  const allowance = collateralAmount(balanceAllowance.allowance);
  const required = Number(amountUsd);

  if (!Number.isFinite(balance) || !Number.isFinite(allowance)) {
    return { ready: false, needsApproval: false, needsFunding: false, message: "pUSD balance or allowance returned in an unsupported format." };
  }

  if (Number.isFinite(required) && required > 0) {
    if (balance < required && allowance < required) {
      return { ready: false, needsApproval: true, needsFunding: true, message: `pUSD balance ($${balance.toFixed(2)}) and allowance ($${allowance.toFixed(2)}) are below the $${required.toFixed(2)} order amount.` };
    }
    if (balance < required) return { ready: false, needsApproval: false, needsFunding: true, message: `pUSD balance ($${balance.toFixed(2)}) is below the $${required.toFixed(2)} order amount. Fund more pUSD via the bridge.` };
    if (allowance < required) return { ready: false, needsApproval: true, needsFunding: false, message: `pUSD allowance ($${allowance.toFixed(2)}) is below the $${required.toFixed(2)} order amount. Approve the exchange contract to spend your pUSD.` };
  }

  return { ready: true, needsApproval: false, needsFunding: false, message: "pUSD balance and allowance cover this order amount." };
}

function positionTokenGate(balanceAllowance: { balance: string; allowance: string } | null, shares: number) {
  if (!balanceAllowance) {
    return {
      ready: false,
      needsApproval: false,
      needsFunding: false,
      message: "Prepare the CLOB session so Rawli can check your position balance and sell allowance.",
    };
  }

  const balance = collateralAmount(balanceAllowance.balance);
  const allowance = collateralAmount(balanceAllowance.allowance);
  const required = Number(shares);

  if (!Number.isFinite(balance) || !Number.isFinite(allowance)) {
    return { ready: false, needsApproval: false, needsFunding: false, message: "Position balance or allowance returned in an unsupported format." };
  }

  if (Number.isFinite(required) && required > 0) {
    if (balance < required && allowance < required) {
      return { ready: false, needsApproval: true, needsFunding: true, message: `Position balance (${balance.toFixed(4)} shares) and sell allowance (${allowance.toFixed(4)} shares) are below the ${required.toFixed(4)} shares you are trying to sell.` };
    }
    if (balance < required) return { ready: false, needsApproval: false, needsFunding: true, message: `Position balance (${balance.toFixed(4)} shares) is below the ${required.toFixed(4)} shares you are trying to sell.` };
    if (allowance < required) return { ready: false, needsApproval: true, needsFunding: false, message: `Sell allowance (${allowance.toFixed(4)} shares) is below the ${required.toFixed(4)} shares you are trying to sell. Approve trading permissions before selling.` };
  }

  return { ready: true, needsApproval: false, needsFunding: false, message: "Position balance and sell allowance cover this order." };
}

// Ordered execution stages for the trade flow. Each completed stage unlocks the next.
const TRADE_STEPS = ["Preview", "Approve", "Sign", "Submit"] as const;

function TradeStepTracker({ stageIndex }: { stageIndex: number }) {
  return (
    <div className="grid grid-cols-4 gap-1">
      {TRADE_STEPS.map((label, i) => {
        const done = i < stageIndex;
        const active = i === stageIndex;
        return (
          <div key={label} className="flex flex-col items-center gap-1">
            <div className="flex w-full items-center">
              <div
                className={cn(
                  "h-0.5 flex-1 rounded-full transition-colors",
                  i === 0 ? "opacity-0" : done || active ? "bg-[oklch(0.78_0.16_82/0.5)]" : "bg-[oklch(0.20_0.015_255)]"
                )}
              />
              <span
                className={cn(
                  "mx-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold transition-all",
                  done
                    ? "bg-[oklch(0.68_0.18_155/0.2)] text-[oklch(0.68_0.18_155)]"
                    : active
                    ? "bg-[oklch(0.78_0.16_82)] text-[oklch(0.10_0.012_260)] shadow-[0_0_10px_oklch(0.78_0.16_82/0.4)]"
                    : "bg-[oklch(0.16_0.014_255)] text-muted-foreground/70"
                )}
              >
                {done ? "✓" : i + 1}
              </span>
              <div
                className={cn(
                  "h-0.5 flex-1 rounded-full transition-colors",
                  i === TRADE_STEPS.length - 1 ? "opacity-0" : done ? "bg-[oklch(0.78_0.16_82/0.5)]" : "bg-[oklch(0.20_0.015_255)]"
                )}
              />
            </div>
            <span
              className={cn(
                "text-[9px] font-bold uppercase tracking-wide",
                active ? "text-foreground" : done ? "text-[oklch(0.68_0.18_155)]" : "text-muted-foreground/50"
              )}
            >
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

const DESC_TRUNCATE_LEN = 280;

function DescriptionCard({ description }: { description: string }) {
  const [expanded, setExpanded] = useState(false);
  const needsTruncation = description.length > DESC_TRUNCATE_LEN;
  const displayText = needsTruncation && !expanded ? description.slice(0, DESC_TRUNCATE_LEN) + "..." : description;

  return (
    <div className="surface-card rounded-2xl p-4 sm:p-5">
      <h3 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
        About this market
      </h3>
      <p className="text-sm text-muted-foreground leading-relaxed">{displayText}</p>
      {needsTruncation && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-2 text-xs font-medium text-[oklch(0.78_0.16_82)] hover:underline"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

export default function MarketDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { ready, authenticated, login } = usePrivy();
  const activePrivyWallet = useActivePrivyWallet();
  const marketId = Array.isArray(params?.id) ? params?.id[0] : params?.id;

  const [market, setMarket] = useState<MarketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [marketError, setMarketError] = useState<string | null>(null);
  const [selectedOutcomeIdx, setSelectedOutcomeIdx] = useState(0);
  const [tradeSide, setTradeSide] = useState<"buy" | "sell">("buy");
  const [orderType, setOrderType] = useState<"market" | "limit" | "gtd">("market");
  const [limitPrice, setLimitPrice] = useState("");
  const [gtdExpiry, setGtdExpiry] = useState(""); // ISO date string
  const [orderAmount, setOrderAmount] = useState("");
  const [walletNotice, setWalletNotice] = useState<string | null>(null);
  const [fundingOpen, setFundingOpen] = useState(false);
  const [fundingInitialTab, setFundingInitialTab] = useState<"deposit" | "withdraw">("deposit");
  const [walletExpanded, setWalletExpanded] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [signingOrder, setSigningOrder] = useState(false);
  const [submitConfirmOpen, setSubmitConfirmOpen] = useState(false);
  const [submitDialogError, setSubmitDialogError] = useState<string | null>(null);
  const [cancelOrderId, setCancelOrderId] = useState<string | null>(null);
  const [cancelingOrderId, setCancelingOrderId] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [tradePreview, setTradePreview] = useState<TradePreviewResponse | null>(null);

  const connectedWalletAddress = activePrivyWallet.walletAddress;
  const connectedWallet = activePrivyWallet.wallet;
  const polymarketDepositWallet = usePolymarketDepositWallet(connectedWallet);
  const profileConnectedWalletAddress = connectedWalletAddress ?? null;
  const tradingProfile = useTradingProfile(
    profileConnectedWalletAddress,
    polymarketDepositWallet.address,
    polymarketDepositWallet.address ? "deposit" : undefined
  );

  useEffect(() => {
    const load = async () => {
      if (!marketId) {
        setMarket(null);
        setMarketError("Market not found.");
        setLoading(false);
        return;
      }

      const cached = readCachedMarketDetail(String(marketId));
      if (cached) {
        setMarket(marketDetailFromCache(cached));
        setMarketError(null);
        setLoading(false);
      }

      try {
        if (!cached) setLoading(true);
        setMarketError(null);
        const m = await resolveGammaMarket(marketId);
        if (!m) {
          if (!cached) {
            setMarket(null);
            setMarketError("Market not found.");
          }
          return;
        }

        setMarket(marketDetailFromGamma(m));
      } catch (err) {
        if (!cached) {
          setMarket(null);
          setMarketError("Unable to load this market.");
        }
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [marketId]);

  const sideParam = searchParams?.get("side") ?? "";
  const outcomeParam = searchParams?.get("outcome") ?? "";
  const sharesParam = searchParams?.get("shares") ?? "";
  const linkedSellShares = Number(sharesParam);

  // Pre-populate trade side, outcome, and share amount from portfolio sell link.
  // Outcome can be an index or an outcome label, depending on the portfolio row.
  useEffect(() => {
    if (sideParam === "sell") {
      setTradeSide("sell");
    }
    if (outcomeParam) {
      const parsed = Number(outcomeParam);
      if (Number.isFinite(parsed) && parsed >= 0) {
        setSelectedOutcomeIdx(parsed);
      } else if (market?.outcomes?.length) {
        const normalizedOutcome = outcomeParam.trim().toLowerCase();
        const matchedIndex = market.outcomes.findIndex((outcome) => outcome.trim().toLowerCase() === normalizedOutcome);
        if (matchedIndex >= 0) setSelectedOutcomeIdx(matchedIndex);
      }
    }
    if (sharesParam) {
      const parsed = Number(sharesParam);
      if (Number.isFinite(parsed) && parsed > 0) {
        setOrderAmount(formatShareInput(parsed));
      }
    }
  }, [market?.outcomes, outcomeParam, sharesParam, sideParam]);

  const normalizedPrices = useMemo(
    () => ((market?.prices?.length ?? 0) >= 2 ? market!.prices : [0.5, 0.5]),
    [market]
  );
  const liveOrderbooks = useLiveOrderbooks(market?.tokenIds);
  const baseYesPrice = normalizedPrices[0] <= 1 ? normalizedPrices[0] * 100 : normalizedPrices[0];
  const baseNoPrice = normalizedPrices[1] <= 1 ? normalizedPrices[1] * 100 : normalizedPrices[1];
  const yesBook = market?.tokenIds?.[0] ? liveOrderbooks.books[market.tokenIds[0]] : undefined;
  const noBook = market?.tokenIds?.[1] ? liveOrderbooks.books[market.tokenIds[1]] : undefined;
  const yesAskPrice = yesBook?.bestAsk ? yesBook.bestAsk * 100 : null;
  const yesBidPrice = yesBook?.bestBid ? yesBook.bestBid * 100 : null;
  const noAskPrice = noBook?.bestAsk ? noBook.bestAsk * 100 : null;
  const noBidPrice = noBook?.bestBid ? noBook.bestBid * 100 : null;
  const yesPrice = (tradeSide === "sell" ? yesBidPrice ?? yesAskPrice : yesAskPrice ?? yesBidPrice) ?? baseYesPrice;
  const noPrice = (tradeSide === "sell" ? noBidPrice ?? noAskPrice : noAskPrice ?? noBidPrice) ?? baseNoPrice;
  // Active outcome — works for any number of outcomes
  const activeBook = market?.tokenIds?.[selectedOutcomeIdx]
    ? liveOrderbooks.books[market.tokenIds[selectedOutcomeIdx]]
    : undefined;
  const activeAskPrice = activeBook?.bestAsk ? activeBook.bestAsk * 100 : null;
  const activeBidPrice = activeBook?.bestBid ? activeBook.bestBid * 100 : null;
  const baseActivePrice = (() => {
    const p = market?.prices?.[selectedOutcomeIdx] ?? 0.5;
    return p <= 1 ? p * 100 : p;
  })();
  const activePrice =
    (tradeSide === "sell"
      ? activeBidPrice ?? activeAskPrice
      : activeAskPrice ?? activeBidPrice) ?? baseActivePrice;
  const sellOrderbookUnavailable =
    tradeSide === "sell" &&
    (activePrice <= 0.05 || activePrice >= 99.95) &&
    !activeBook?.bestBid;

  useEffect(() => {
    setTradePreview(null);
    setPreviewError(null);
  }, [marketId, orderAmount, selectedOutcomeIdx, tradeSide, orderType, limitPrice]);
  const amountNumber = Number(orderAmount) || 0;
  const previewShares = tradePreview?.estimatedShares ?? null;
  const previewFilledAmount = tradePreview?.filledAmountUsd ?? amountNumber;
  const estimatedShares = tradeSide === "sell" ? amountNumber : previewShares ?? (activePrice > 0 ? amountNumber / (activePrice / 100) : 0);
  const buyMaxProfit = estimatedShares > 0 ? estimatedShares - previewFilledAmount : 0;
  const sellProceeds = tradePreview?.filledAmountUsd ?? (activePrice > 0 ? amountNumber * (activePrice / 100) : 0);
  const avgEntryPriceCents = (() => {
    if (tradePreview?.avgPrice !== undefined && Number.isFinite(tradePreview.avgPrice)) {
      return tradePreview.avgPrice * 100;
    }
    if ((orderType === "limit" || orderType === "gtd") && Number(limitPrice) > 0) {
      return Number(limitPrice);
    }
    return activePrice;
  })();
  const platformFeeAmount = tradePreview?.platformFee?.amount ?? 0;
  const buyTotalCost = tradeSide === "buy" ? previewFilledAmount + platformFeeAmount : 0;
  const buyPotentialReturn = tradeSide === "buy" ? estimatedShares : 0;
  const buyPotentialProfit = tradeSide === "buy" ? buyPotentialReturn - buyTotalCost : 0;
  const buyPotentialRoi = buyTotalCost > 0 ? (buyPotentialProfit / buyTotalCost) * 100 : 0;
  const sellPayoutForgone = tradeSide === "sell" ? Math.max(0, amountNumber - sellProceeds) : 0;
  const sellCaptureRate = amountNumber > 0 ? (sellProceeds / amountNumber) * 100 : 0;
  const previewSlippageCents =
    tradePreview?.avgPrice !== undefined
      ? tradeSide === "buy"
        ? avgEntryPriceCents - activePrice
        : activePrice - avgEntryPriceCents
      : 0;
  const activeTokenId = market?.tokenIds?.[selectedOutcomeIdx];
  const activeOutcomeName = market?.outcomes?.[selectedOutcomeIdx] ?? "Yes";
  const cryptoAsset = useMemo(
    () =>
      detectCryptoAsset({
        title: market?.title,
        category: market?.category,
        description: market?.description,
      }),
    [market?.category, market?.description, market?.title],
  );
  const tradingWalletAddress = tradingProfile.profile?.tradingWalletAddress ?? null;
  const depositAddress = tradingProfile.profile?.depositAddress?.evm ?? null;
  const yesWidth = `${Math.max(4, Math.min(96, baseYesPrice))}%`;
  const depositWalletStatus = useDepositWalletStatus(
    connectedWalletAddress,
    Boolean(connectedWalletAddress && tradingProfile.profile?.tradingWalletKind === "deposit")
  );
  const clobSession = useClobSession(connectedWallet, tradingProfile.profile);
  const emittedTerminalOrderRef = useRef<string | null>(null);
  const rewardCandidateRef = useRef<TradeRewardCandidate | null>(null);
  const depositWalletApproval = useDepositWalletApproval(
    connectedWalletAddress,
    tradingProfile.profile?.tradingWalletKind === "deposit" ? tradingWalletAddress : null,
    connectedWallet,
    async () => {
      setPreviewError(null);
      setSubmitDialogError(null);
      await clobSession.refreshBalanceAllowance();
      if (activeTokenId) {
        for (let attempt = 0; attempt < 5; attempt += 1) {
          const refreshed = await clobSession.refreshConditionalBalanceAllowance(activeTokenId);
          const refreshedAllowance = refreshed ? collateralAmount(refreshed.allowance) : 0;
          if (refreshedAllowance >= amountNumber) break;
          await new Promise((resolve) => setTimeout(resolve, 900));
        }
      }
      await readiness.refresh();
    }
  );
  const readiness = useTradeReadiness({
    connectedWalletAddress,
    profile: tradingProfile.profile,
    marketId: market?.id,
    tokenId: activeTokenId,
    amountUsd: amountNumber,
    clobSessionStatus: clobSession.status,
    createClobSessionHeaders: clobSession.createReadinessHeaders,
  });
  const effectiveBalanceAllowance = useMemo(() => {
    const readinessCollateral = readiness.readiness?.collateral;
    if (!readinessCollateral) return clobSession.balanceAllowance;
    if (!clobSession.balanceAllowance) return readinessCollateral;

    const clobGate = collateralGate(clobSession.balanceAllowance, amountNumber);
    const readinessGate = collateralGate(readinessCollateral, amountNumber);
    return !clobGate.ready && readinessGate.ready ? readinessCollateral : clobSession.balanceAllowance;
  }, [clobSession.balanceAllowance, readiness.readiness?.collateral, amountNumber]);
  const fundingStatus = useFundingStatus(depositAddress, { active: Boolean(depositAddress), intervalMs: 15_000 });

  const openFundingModal = (tab: "deposit" | "withdraw" = "deposit") => {
    setFundingInitialTab(tab);
    setFundingOpen(true);
  };

  useEffect(() => {
    if (fundingStatus.phase === "completed" && clobSession.status === "ready") {
      clobSession.refreshBalanceAllowance()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fundingStatus.phase])

  const tradeCollateralGate = useMemo(
    () => collateralGate(effectiveBalanceAllowance, amountNumber),
    [effectiveBalanceAllowance, amountNumber]
  );
  const tradePositionGate = useMemo(
    () => positionTokenGate(clobSession.conditionalBalanceAllowance, amountNumber),
    [clobSession.conditionalBalanceAllowance, amountNumber]
  );
  const availablePusd = effectiveBalanceAllowance ? collateralAmount(effectiveBalanceAllowance.balance) : null;
  const spendablePusd = effectiveBalanceAllowance
    ? Math.min(collateralAmount(effectiveBalanceAllowance.balance), collateralAmount(effectiveBalanceAllowance.allowance))
    : null;
  const remainingPusd = availablePusd === null ? null : Math.max(0, availablePusd - (tradeSide === "buy" ? amountNumber : 0));
  const positionShares = clobSession.conditionalBalanceAllowance ? collateralAmount(clobSession.conditionalBalanceAllowance.balance) : null;
  const sellableShares = clobSession.conditionalBalanceAllowance
    ? Math.min(collateralAmount(clobSession.conditionalBalanceAllowance.balance), collateralAmount(clobSession.conditionalBalanceAllowance.allowance))
    : null;
  const remainingShares = positionShares === null ? null : Math.max(0, positionShares - (tradeSide === "sell" ? amountNumber : 0));
  const sellReferenceShares =
    positionShares && positionShares > 0
      ? positionShares
      : Number.isFinite(linkedSellShares) && linkedSellShares > 0
      ? linkedSellShares
      : 0;
  const hasSellReferenceShares = sellReferenceShares > 0;
  const requiresCollateral = tradeSide === "buy";
  const requiresPositionApproval = tradeSide === "sell";
  const setSellPercentAmount = (percent: number) => {
    const availableShares = sellReferenceShares;
    if (availableShares <= 0) return;
    setOrderAmount(formatShareInput(availableShares * percent));
  };
  const setBuyPercentAmount = (percent: number) => {
    // Use actual balance for percent calculation — allowance gates are handled separately
    const available = availablePusd ?? spendablePusd;
    if (!available || available <= 0) return;
    const value = Math.floor(available * percent * 100) / 100; // floor to 2 decimals
    setOrderAmount(value.toFixed(2));
  };
  // Enable presets based on balance (not spendable) — user may need to approve first
  const hasBuyReferenceBalance = (availablePusd ?? 0) > 0;
  const signOrderPreviewDisabled =
    signingOrder ||
    (requiresCollateral && !tradeCollateralGate.ready) ||
    (requiresPositionApproval && !tradePositionGate.ready);
  const tradeActionBusy =
    previewLoading ||
    signingOrder ||
    clobSession.status === "preparing" ||
    clobSession.submitStatus === "submitting";
  // Current position in the linear execution flow: Preview(0) → Approve(1) → Sign(2) → Submit(3) → done(4).
  // Drives the step tracker and gates which action button is unlocked.
  const tradeStageIndex = useMemo(() => {
    if (!tradePreview) return 0; // Preview
    const needsApproval =
      clobSession.status !== "ready" ||
      (requiresCollateral && !tradeCollateralGate.ready) ||
      (requiresPositionApproval && !tradePositionGate.ready);
    if (needsApproval) return 1; // Approve / activate session
    if (!clobSession.signedOrderPreview) return 2; // Sign
    if (clobSession.orderSubmission?.success) return 4; // Done
    return 3; // Submit
  }, [
    tradePreview,
    clobSession.status,
    clobSession.signedOrderPreview,
    clobSession.orderSubmission?.success,
    requiresCollateral,
    requiresPositionApproval,
    tradeCollateralGate.ready,
    tradePositionGate.ready,
  ]);
  const cancelTargetOrder = useMemo(
    () => clobSession.openOrders.find((order) => order.id === cancelOrderId) ?? null,
    [clobSession.openOrders, cancelOrderId]
  );

  useEffect(() => {
    clobSession.clearSignedOrderPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marketId, activeTokenId, orderAmount, selectedOutcomeIdx, tradeSide]);

  useEffect(() => {
    if (clobSession.status === "ready") {
      void clobSession.refreshOpenOrders();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clobSession.status]);

  useEffect(() => {
    if (tradeSide === "sell" && clobSession.status === "ready" && activeTokenId) {
      void clobSession.refreshConditionalBalanceAllowance(activeTokenId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tradeSide, clobSession.status, activeTokenId]);

  // Auto-poll submitted order status every 10 s until terminal state
  useEffect(() => {
    const orderId = clobSession.orderSubmission?.orderId;
    if (!orderId) return;
    const terminal = new Set(["MATCHED", "CANCELED", "EXPIRED", "RESOLVED"]);
    if (terminal.has(clobSession.orderStatus?.status ?? "")) return;
    const timerId = setInterval(() => void clobSession.refreshSubmittedOrder(), 10_000);
    return () => clearInterval(timerId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clobSession.orderSubmission?.orderId, clobSession.orderStatus?.status]);

  useEffect(() => {
    const orderId = clobSession.orderSubmission?.orderId;
    const status = clobSession.orderStatus?.status?.toUpperCase();
    if (!orderId || !status) return;

    const terminal = new Set(["MATCHED", "CANCELED", "EXPIRED", "RESOLVED"]);
    if (!terminal.has(status)) return;

    const refreshKey = `${orderId}:${status}`;
    if (emittedTerminalOrderRef.current === refreshKey) return;
    emittedTerminalOrderRef.current = refreshKey;

    if (status === "MATCHED") {
      const orderSide = clobSession.signedOrderPreview?.side ?? "BUY";
      // Derive the outcome name from the order's token ID (handles orders signed for the non-active outcome)
      const previewTokenId = clobSession.signedOrderPreview?.tokenId;
      const outcomeIdx = previewTokenId ? (market?.tokenIds?.indexOf(previewTokenId) ?? -1) : -1;
      const outcome = outcomeIdx >= 0 ? (market?.outcomes?.[outcomeIdx] ?? activeOutcomeName) : activeOutcomeName;
      void (async () => {
        const rewardCandidate = rewardCandidateRef.current;
        if (!rewardCandidate) return;
        const rewardHeaders = await clobSession.createOrderLookupHeaders(orderId);
        await recordTradeRewardEvent({ ...rewardCandidate, orderId, headers: rewardHeaders });
      })();
      toast.success(`${orderSide === "BUY" ? "Buy" : "Sell"} order filled!`, {
        description: `Your ${outcome} position was matched on the CLOB · ${orderId.slice(0, 8)}…`,
        duration: 8000,
      });
    } else if (status === "CANCELED") {
      toast.info("Order cancelled", { description: `Order ${orderId.slice(0, 8)}… removed from the book.`, duration: 4000 });
    } else if (status === "EXPIRED") {
      toast.warning("GTD order expired", { description: `Order ${orderId.slice(0, 8)}… reached its expiry without being filled.`, duration: 5000 });
    }

    void clobSession.refreshBalanceAllowance();
    if (activeTokenId) void clobSession.refreshConditionalBalanceAllowance(activeTokenId);
    void readiness.refresh();
    scheduleAccountRefresh({
      reason: `order_${status.toLowerCase()}`,
      address: tradingWalletAddress,
    });

    // Delayed re-refresh: CLOB balance lags behind order matching
    setTimeout(() => {
      void clobSession.refreshBalanceAllowance();
      if (activeTokenId) void clobSession.refreshConditionalBalanceAllowance(activeTokenId);
    }, 3000);
    setTimeout(() => {
      void clobSession.refreshBalanceAllowance();
      if (activeTokenId) void clobSession.refreshConditionalBalanceAllowance(activeTokenId);
    }, 8000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clobSession.orderSubmission?.orderId, clobSession.orderStatus?.status, activeTokenId, tradingWalletAddress]);

  const handleConnectWallet = async () => {
    setWalletNotice(null);
    try {
      await login();
    } catch (err: any) {
      setWalletNotice(err?.message ?? "Wallet connection failed");
    }
  };

  const copyToClipboard = async (text: string, label: string) => {
    await navigator.clipboard?.writeText(text);
    setWalletNotice(`${label} copied`);
    setTimeout(() => setWalletNotice(null), 2000);
  };

  const handlePreviewTrade = async () => {
    setPreviewError(null);

    if (!activeTokenId) {
      setPreviewError("Selected outcome is missing a CLOB token.");
      return;
    }

    if (!amountNumber || amountNumber <= 0) {
      setPreviewError("Enter an amount above zero.");
      return;
    }

    if (amountNumber < 1) {
      setPreviewError("Minimum order size is $1.00.");
      return;
    }

    if (!tradingWalletAddress) {
      setPreviewError("Connect a wallet before previewing a trade.");
      return;
    }

    if (sellOrderbookUnavailable) {
      setPreviewError("This outcome is already at settlement price and has no active sell book. Wait for settlement or redemption.");
      return;
    }

    setPreviewLoading(true);
    const MAX_RETRIES = 2;
    let lastError: string | null = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 800 * attempt));
        const res = await fetch(`${API_BASE}/trade/preview`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            marketId: market!.id,
            tokenId: activeTokenId,
            outcome: activeOutcomeName,
            side: tradeSide.toUpperCase(),
            amountUsd: amountNumber,
            tradingWalletAddress,
          }),
        });
        const body: TradePreviewResponse = await res.json();
        if (!res.ok || !body.ok) {
          const isRetryable = body.error === "orderbook_lookup_failed" || body.error === "market_lookup_failed";
          if (isRetryable && attempt < MAX_RETRIES) {
            lastError = body.error ? previewErrorLabel(body.error) : "Preview failed.";
            continue;
          }
          throw new Error(body.error ? previewErrorLabel(body.error) : "Preview failed.");
        }
        setTradePreview(body);
        lastError = null;
        break;
      } catch (err: any) {
        lastError = err?.message ?? "Preview failed.";
        if (attempt >= MAX_RETRIES) {
          setPreviewError(lastError);
        }
      }
    }
    setPreviewLoading(false);
  };

  const handleCreateSignedOrder = async () => {
    setPreviewError(null);

    if (!activeTokenId) {
      setPreviewError("Selected outcome is missing a CLOB token.");
      return;
    }

    if (!tradePreview?.maxPrice) {
      setPreviewError(`Preview this ${tradeSide} before signing the order.`);
      return;
    }

    if (clobSession.status !== "ready") {
      setPreviewError("Prepare the CLOB session before signing an order.");
      return;
    }

    if (tradeSide === "buy" && !tradeCollateralGate.ready) {
      setPreviewError(tradeCollateralGate.message);
      return;
    }

    if (tradeSide === "sell" && !tradePositionGate.ready) {
      setPreviewError(tradePositionGate.message);
      return;
    }

    setSigningOrder(true);
    try {
      const negRisk = tradePreview.warnings?.some((warning) => warning.code === "neg_risk_market");

      if (orderType === "limit" || orderType === "gtd") {
        const limitPriceCents = Number(limitPrice);
        if (!limitPriceCents || limitPriceCents <= 0 || limitPriceCents >= 100) {
          setPreviewError("Set a valid limit price between 1¢ and 99¢.");
          return;
        }
        let expiresAt: number | undefined;
        if (orderType === "gtd") {
          expiresAt = gtdExpiry ? Math.floor(new Date(gtdExpiry).getTime() / 1000) : undefined;
          if (!expiresAt || expiresAt <= Date.now() / 1000) {
            setPreviewError("Set a future expiry date for the GTD order.");
            return;
          }
        }
        const limitSize = tradeSide === "buy"
          ? amountNumber / (limitPriceCents / 100)
          : amountNumber;

        await clobSession.createSignedLimitOrder({
          tokenId: activeTokenId,
          side: tradeSide.toUpperCase() as "BUY" | "SELL",
          amount: limitSize,
          limitPriceCents,
          orderType: orderType === "gtd" ? "GTD" : "GTC",
          expiresAt,
          tickSize: tradePreview.tickSize,
          negRisk,
        });
      } else if (tradeSide === "sell") {
        await clobSession.createSignedSellOrder({
          tokenId: activeTokenId,
          amountShares: amountNumber,
          price: tradePreview.maxPrice,
          tickSize: tradePreview.tickSize,
          negRisk,
        });
      } else {
        await clobSession.createSignedBuyOrder({
          tokenId: activeTokenId,
          amountUsd: amountNumber,
          price: tradePreview.maxPrice,
          tickSize: tradePreview.tickSize,
          negRisk,
        });
      }
    } finally {
      setSigningOrder(false);
    }
  };

  const handleSubmitSignedOrder = async () => {
    // Guard: prevent double-submission if already in flight
    if (clobSession.submitStatus === "submitting") return;
    setSubmitDialogError(null);

    const submittingBuy = clobSession.signedOrderPreview?.side === "BUY";
    const submittingSell = clobSession.signedOrderPreview?.side === "SELL";
    if (submittingBuy && !tradeCollateralGate.ready) {
      setSubmitDialogError(tradeCollateralGate.message);
      return;
    }
    if (submittingSell && !tradePositionGate.ready) {
      setSubmitDialogError(tradePositionGate.message);
      return;
    }

    const submission = await clobSession.submitSignedOrder();
    if (submission?.success) {
      setSubmitConfirmOpen(false);
      setSubmitDialogError(null);
      const side = clobSession.signedOrderPreview?.side ?? "BUY";

      // Immediately clear all trade state so the UI resets — don't wait for refreshes
      clobSession.clearSignedOrderPreview();
      setOrderAmount("");
      setTradePreview(null);
      setPreviewError(null);

      // Refresh balances in the background — CLOB may take a moment to reflect
      void clobSession.refreshBalanceAllowance();
      if (activeTokenId) {
        void clobSession.refreshConditionalBalanceAllowance(activeTokenId);
      }
      void readiness.refresh();
      scheduleAccountRefresh({
        reason: "order_submitted",
        address: tradingWalletAddress,
      });

      // Delayed re-refresh: CLOB balance endpoint lags behind order matching
      // by 2-5s. A second refresh catches the updated position.
      setTimeout(async () => {
        await clobSession.refreshBalanceAllowance();
        if (activeTokenId) {
          await clobSession.refreshConditionalBalanceAllowance(activeTokenId);
        }
      }, 3000);
      // Third sweep at 8s for orders that take longer to settle
      setTimeout(async () => {
        await clobSession.refreshBalanceAllowance();
        if (activeTokenId) {
          await clobSession.refreshConditionalBalanceAllowance(activeTokenId);
        }
      }, 8000);

      if (side === "SELL" && marketId) {
        router.replace(`/markets/${encodeURIComponent(String(marketId))}`, { scroll: false });
      }
      const orderId = submission.orderId ? ` · ${submission.orderId.slice(0, 8)}…` : "";
      const rewardHeaders = submission.orderId ? await clobSession.createOrderLookupHeaders(submission.orderId) : null;
      const rewardCandidate: TradeRewardCandidate = {
        wallet: connectedWalletAddress,
        tradingWalletAddress,
        marketId: market?.id ?? marketId ?? null,
        tokenId: activeTokenId,
        amountUsd: amountNumber,
        quickSettle: resolvesWithinHours(market?.endsAt, 24),
        crypto: Boolean(cryptoAsset),
        premium: hasPremiumAnalysisCached(market?.id ?? marketId),
      };
      rewardCandidateRef.current = rewardCandidate;
      void recordTradeRewardEvent({ ...rewardCandidate, orderId: submission.orderId, headers: rewardHeaders });
      toast.success(`${side === "BUY" ? "Buy" : "Sell"} order submitted${orderId}`, {
        description: submission.takingAmount
          ? `Filled ${submission.takingAmount} shares`
          : "Order is live on the CLOB",
        duration: 6000,
      });
    } else if (submission && !submission.success) {
      const friendlyError = friendlyTradeError(submission.errorMsg);
      // Surface the failure inside the dialog so the user sees it before closing
      setSubmitDialogError(friendlyError);
      toast.error("Order submission failed", {
        description: friendlyError,
        duration: 8000,
      });
    }
  };

  const handleCancelOpenOrder = async () => {
    if (!cancelOrderId) return;
    setCancelingOrderId(cancelOrderId);
    const canceled = await clobSession.cancelOpenOrder(cancelOrderId);
    setCancelingOrderId(null);
    if (canceled) {
      setCancelOrderId(null);
      scheduleAccountRefresh({ reason: "order_cancelled", address: tradingWalletAddress });
      toast.success("Order cancelled", {
        description: `Order ${cancelOrderId.slice(0, 8)}… removed from the book`,
        duration: 4000,
      });
    } else {
      toast.error("Cancel failed", {
        description: "The order may have already been filled.",
        duration: 5000,
      });
    }
  };

  /* ---------- Loading / empty state ---------- */
  if (loading) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <Navbar />
        <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 rawli-page-top rawli-page-bottom">
          <div className="flex items-center justify-center min-h-[50vh]">
            <div className="flex flex-col items-center gap-3">
              <div className="w-10 h-10 border-3 border-[oklch(0.78_0.16_82)] border-t-transparent rounded-full animate-spin" />
              <span className="text-xs text-muted-foreground">Loading market...</span>
            </div>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  if (!market) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <Navbar />
        <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 rawli-page-top rawli-page-bottom">
          <div className="flex min-h-[50vh] items-center justify-center">
            <div className="surface-card max-w-md rounded-2xl p-6 text-center">
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl border border-[oklch(0.58_0.2_25/0.3)] bg-[oklch(0.58_0.2_25/0.08)]">
                <AlertTriangle className="h-5 w-5 text-[oklch(0.64_0.18_25)]" />
              </div>
              <h1 className="mt-4 text-lg font-semibold text-foreground">Market unavailable</h1>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {marketError ?? "This market could not be found or is no longer available from the upstream feed."}
              </p>
              <Button type="button" onClick={() => router.push("/")} className="mt-5 h-9 text-xs">
                Back to markets
              </Button>
            </div>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 rawli-page-top rawli-page-bottom pb-20 lg:pb-0">
        {/* Header — compact on mobile */}
        <div className="pt-4 sm:pt-6 pb-4 sm:pb-5">
          <button
            onClick={() => router.back()}
            className="flex items-center gap-1 text-[11px] sm:text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors mb-3 sm:mb-4 active:scale-95"
          >
            <ArrowLeft size={14} /> Back
          </button>

          <div className="flex items-start gap-3">
            {market.image ? (
              <div className="w-10 h-10 sm:w-14 sm:h-14 rounded-xl overflow-hidden bg-[oklch(0.16_0.014_255)] border border-[oklch(0.22_0.015_255)] shrink-0">
                <img src={market.image} alt="" className="w-full h-full object-cover" />
              </div>
            ) : (
              <div className="w-10 h-10 sm:w-14 sm:h-14 rounded-xl bg-[oklch(0.16_0.014_255)] border border-[oklch(0.22_0.015_255)] shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-1">
                <span className="px-1.5 py-0.5 rounded-md bg-[oklch(0.18_0.014_255)] border border-[oklch(0.24_0.016_255)] text-[8px] sm:text-[9px] font-bold text-muted-foreground uppercase tracking-widest">
                  {market.category}
                </span>
                <span className="px-1.5 py-0.5 rounded-md bg-[oklch(0.78_0.16_82/0.08)] border border-[oklch(0.78_0.16_82/0.15)] text-[7px] sm:text-[8px] font-bold text-[oklch(0.78_0.16_82)] uppercase tracking-widest">
                  Polymarket
                </span>
              </div>
              <h1 className="text-base sm:text-2xl font-bold text-foreground leading-snug">{market.title}</h1>
            </div>
          </div>

          {/* Probability bar + inline stats */}
          <div className="mt-3">
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-1.5">
                <span className="text-xs sm:text-sm font-bold text-[oklch(0.74_0.20_155)]">Yes {yesPrice.toFixed(1)}¢</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs sm:text-sm font-bold text-[oklch(0.65_0.20_25)]">No {noPrice.toFixed(1)}¢</span>
              </div>
            </div>
            <div className="h-2 sm:h-2.5 overflow-hidden rounded-full bg-[oklch(0.18_0.014_255)]">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: yesWidth,
                  background: "linear-gradient(90deg, oklch(0.68 0.18 155), oklch(0.60 0.16 155))",
                }}
              />
            </div>
          </div>

          {/* Stats strip */}
          <div className="mt-2.5 flex items-center gap-2 sm:gap-3 text-[10px] sm:text-xs text-muted-foreground overflow-x-auto no-scrollbar">
            <span className="flex items-center gap-1 font-medium whitespace-nowrap">
              <TrendingUp className="w-3 h-3 text-[oklch(0.78_0.16_82)]" />
              {formatCompactUsd(market.volume24h)}
            </span>
            <span className="text-[oklch(0.22_0.015_255)]">·</span>
            <span className="flex items-center gap-1 font-medium whitespace-nowrap">
              <Droplets className="w-3 h-3 text-[oklch(0.68_0.18_155)]" />
              {formatCompactUsd(market.liquidity)}
            </span>
            <span className="text-[oklch(0.22_0.015_255)]">·</span>
            <span className="flex items-center gap-1 font-medium whitespace-nowrap">
              <Clock className="w-3 h-3" />
              {market.endsAt || "Open"}
            </span>
          </div>
        </div>

        {/* Main 2-col layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-5">
          {/* Left: Analysis + Info */}
          <div className="lg:col-span-8 space-y-4 sm:space-y-5">
            {cryptoAsset && (
              <CryptoAssetChart asset={cryptoAsset} marketTitle={market.title} />
            )}

            <PremiumAnalysisCard market={{
              id: market.id,
              question: market.title,
              category: market.category,
              description: market.description,
              volume: market.volume24h,
              liquidity: market.liquidity,
              endDate: market.endsAt,
              outcomes: market.outcomes.map((name, i) => ({
                name,
                price: (market.prices[i] ?? 0) * 100,
              })),
            }} />

            {market.description && (
              <DescriptionCard description={market.description} />
            )}
          </div>

          {/* Right: Trade Panel */}
          <div className="lg:col-span-4" id="trade-panel">
            <div
              className="surface-card rounded-2xl sm:rounded-3xl p-3.5 sm:p-5 lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto lg:overscroll-contain space-y-3 sm:space-y-4"
              style={{ overflowAnchor: "none" }}
            >
              {/* Header + Buy/Sell toggle */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex rounded-full border border-[oklch(0.22_0.015_255)] bg-[oklch(0.13_0.012_255)] p-0.5">
                    <button
                      onClick={() => setTradeSide("buy")}
                      disabled={tradeActionBusy}
                      className={cn(
                        "px-3.5 sm:px-4 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-wide transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-60",
                        tradeSide === "buy"
                          ? "bg-[oklch(0.28_0.12_155)] border border-[oklch(0.68_0.18_155/0.45)] text-[oklch(0.78_0.20_155)] shadow-[0_2px_8px_oklch(0.68_0.18_155/0.20)]"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      Buy
                    </button>
                    <button
                      onClick={() => setTradeSide("sell")}
                      disabled={tradeActionBusy}
                      className={cn(
                        "px-3.5 sm:px-4 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-wide transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-60",
                        tradeSide === "sell"
                          ? "bg-[oklch(0.24_0.12_25)] border border-[oklch(0.58_0.2_25/0.40)] text-[oklch(0.72_0.20_25)] shadow-[0_2px_8px_oklch(0.58_0.2_25/0.15)]"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      Sell
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 text-[10px] font-semibold text-muted-foreground">
                  <span className={cn(
                    "w-1.5 h-1.5 rounded-full",
                    liveOrderbooks.status === "live" ? "bg-[oklch(0.68_0.18_155)] pulse-dot" : "bg-[oklch(0.44_0.02_255)]"
                  )} />
                  {liveOrderbooks.status === "live" ? "Live" : "Syncing"}
                </div>
              </div>

              {/* Onboarding stepper — cold-start checklist. Hidden once a preview exists,
                  because the linear action flow below then owns activation/approval. */}
              {!tradePreview && (!authenticated || clobSession.status !== "ready") && (
                <div className="rounded-xl border border-[oklch(0.22_0.015_255)] bg-[oklch(0.12_0.012_260/0.7)] p-3">
                  <div className="mb-2 text-[9px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Getting started</div>
                  <div className="space-y-2">
                    {[
                      {
                        n: 1,
                        label: "Connect wallet",
                        done: authenticated,
                        active: !authenticated,
                        action: !authenticated ? handleConnectWallet : undefined,
                        actionLabel: "Connect",
                      },
                      {
                        n: 2,
                        label: "Fund your account",
                        done: authenticated && (effectiveBalanceAllowance ? Number(effectiveBalanceAllowance.balance) > 0 : false),
                        active: authenticated && !clobSession.balanceAllowance,
                        action: authenticated ? () => openFundingModal("deposit") : undefined,
                        actionLabel: "Deposit",
                      },
                      {
                        n: 3,
                        label: "Activate trading session",
                        done: clobSession.status === "ready",
                        active: authenticated && clobSession.status !== "ready" && clobSession.status !== "preparing",
                        action: authenticated && clobSession.status === "idle" ? clobSession.prepareSession : undefined,
                        actionLabel: clobSession.status === "preparing" ? "Activating…" : "Activate",
                      },
                    ].map((step) => (
                      <div key={step.n} className={cn(
                        "flex items-center gap-3 rounded-lg px-2.5 py-2 transition-all",
                        step.active ? "bg-[oklch(0.78_0.16_82/0.08)] border border-[oklch(0.78_0.16_82/0.2)]" : "opacity-60"
                      )}>
                        <div className={cn(
                          "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
                          step.done
                            ? "bg-[oklch(0.68_0.18_155/0.2)] text-[oklch(0.68_0.18_155)]"
                            : step.active
                            ? "bg-[oklch(0.78_0.16_82/0.2)] text-[oklch(0.78_0.16_82)]"
                            : "bg-[oklch(0.18_0.014_255)] text-muted-foreground"
                        )}>
                          {step.done ? "✓" : step.n}
                        </div>
                        <span className={cn(
                          "flex-1 text-[11px] font-medium",
                          step.done ? "text-[oklch(0.68_0.18_155)] line-through decoration-[oklch(0.68_0.18_155/0.5)]" : step.active ? "text-foreground" : "text-muted-foreground"
                        )}>
                          {step.label}
                        </span>
                        {step.action && !step.done && (
                          <button
                            type="button"
                            onClick={step.action}
                            disabled={clobSession.status === "preparing"}
                            className="rounded-md bg-[oklch(0.78_0.16_82)] px-2.5 py-1 text-[10px] font-bold text-[oklch(0.10_0.012_260)] transition-colors hover:bg-[oklch(0.83_0.16_82)] disabled:opacity-50"
                          >
                            {step.actionLabel}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Outcome selector — dynamic, works for 2 or more outcomes */}
              <div className="grid grid-cols-2 gap-1.5 sm:gap-2">
                {(market?.outcomes ?? ["Yes", "No"]).map((outcomeName, i) => {
                  const tid = market?.tokenIds?.[i];
                  const book = tid ? liveOrderbooks.books[tid] : undefined;
                  const baseP = market?.prices?.[i] ?? 0.5;
                  const baseCents = baseP <= 1 ? baseP * 100 : baseP;
                  const askCents = book?.bestAsk ? book.bestAsk * 100 : null;
                  const bidCents = book?.bestBid ? book.bestBid * 100 : null;
                  const displayPrice =
                    (tradeSide === "sell" ? bidCents ?? askCents : askCents ?? bidCents) ?? baseCents;
                  return (
                    <button
                      key={i}
                      onClick={() => setSelectedOutcomeIdx(i)}
                      disabled={tradeActionBusy}
                      className={cn(
                        "rounded-xl sm:rounded-2xl border p-3 sm:p-3.5 text-left transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-70 active:scale-[0.97]",
                        selectedOutcomeIdx === i
                          ? tradeSide === "buy"
                            ? "border-[oklch(0.68_0.18_155/0.55)] bg-[oklch(0.68_0.18_155/0.10)] shadow-[0_0_16px_oklch(0.68_0.18_155/0.12)]"
                            : "border-[oklch(0.58_0.2_25/0.5)] bg-[oklch(0.58_0.2_25/0.10)] shadow-[0_0_16px_oklch(0.58_0.2_25/0.12)]"
                          : "border-[oklch(0.22_0.015_255)] bg-[oklch(0.14_0.012_255)] hover:border-[oklch(0.30_0.016_255)] hover:bg-[oklch(0.16_0.014_255)]"
                      )}
                    >
                      <div className={cn(
                        "text-[10px] font-bold uppercase tracking-[0.12em] truncate",
                        tradeSide === "buy" ? "text-[oklch(0.68_0.18_155)]" : "text-[oklch(0.62_0.18_25)]"
                      )}>
                        {tradeSide === "buy" ? "Buy" : "Sell"} {outcomeName}
                      </div>
                      <div className="text-lg sm:text-xl font-bold text-foreground mt-0.5 sm:mt-1">{displayPrice.toFixed(1)}¢</div>
                    </button>
                  );
                })}
              </div>

              {/* Live orderbook depth */}
              {(() => {
                const asks = activeBook?.asks?.slice(0, 5) ?? [];
                const bids = activeBook?.bids?.slice(0, 5) ?? [];
                if (!asks.length && !bids.length) return null;
                const maxSize = Math.max(...[...asks, ...bids].map(l => l.size), 1);
                return (
                  <div className="rounded-2xl border border-[oklch(0.22_0.015_255)] bg-[oklch(0.13_0.012_255)] overflow-hidden">
                    <div className="grid grid-cols-3 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground/60 border-b border-[oklch(0.22_0.015_255)]">
                      <span>Price</span><span className="text-center">Depth</span><span className="text-right">Size</span>
                    </div>
                    {/* Asks (sells) — red, lowest first reversed */}
                    {[...asks].reverse().map((lvl, i) => (
                      <div key={`ask-${i}`} className="relative grid grid-cols-3 px-2.5 py-0.5 text-[10px]">
                        <div className="absolute inset-y-0 right-0 bg-[oklch(0.58_0.2_25/0.07)]" style={{ width: `${(lvl.size / maxSize) * 100}%` }} />
                        <span className="relative text-[oklch(0.62_0.18_25)] font-mono">{(lvl.price * 100).toFixed(1)}¢</span>
                        <span className="relative text-center">
                          <span className="h-1 rounded-full bg-[oklch(0.58_0.2_25/0.4)] inline-block" style={{ width: `${Math.max(4, (lvl.size / maxSize) * 60)}px` }} />
                        </span>
                        <span className="relative text-right text-muted-foreground font-mono">{lvl.size.toFixed(0)}</span>
                      </div>
                    ))}
                    {/* Spread */}
                    {activeBook?.bestAsk && activeBook?.bestBid && (
                      <div className="grid grid-cols-3 px-2.5 py-0.5 text-[9px] bg-[oklch(0.15_0.013_255)] border-y border-[oklch(0.22_0.015_255)]">
                        <span className="text-muted-foreground/50 uppercase tracking-wider">Spread</span>
                        <span className="text-center text-muted-foreground font-mono">
                          {((activeBook.bestAsk - activeBook.bestBid) * 100).toFixed(1)}¢
                        </span>
                        <span />
                      </div>
                    )}
                    {/* Bids (buys) — green */}
                    {bids.map((lvl, i) => (
                      <div key={`bid-${i}`} className="relative grid grid-cols-3 px-2.5 py-0.5 text-[10px]">
                        <div className="absolute inset-y-0 right-0 bg-[oklch(0.68_0.18_155/0.07)]" style={{ width: `${(lvl.size / maxSize) * 100}%` }} />
                        <span className="relative text-[oklch(0.68_0.18_155)] font-mono">{(lvl.price * 100).toFixed(1)}¢</span>
                        <span className="relative text-center">
                          <span className="h-1 rounded-full bg-[oklch(0.68_0.18_155/0.4)] inline-block" style={{ width: `${Math.max(4, (lvl.size / maxSize) * 60)}px` }} />
                        </span>
                        <span className="relative text-right text-muted-foreground font-mono">{lvl.size.toFixed(0)}</span>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* Amount input + quick amounts */}
              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                  {tradeSide === "buy" ? "Amount (pUSD)" : "Shares to sell"}
                </label>
                <div className="flex items-center gap-2 rounded-xl sm:rounded-2xl border border-[oklch(0.22_0.015_255)] bg-[oklch(0.14_0.013_255)] px-3.5 sm:px-4 focus-within:border-[oklch(0.78_0.16_82/0.45)] focus-within:shadow-[0_0_0_3px_oklch(0.78_0.16_82/0.08)] transition-all">
                  <span className="text-sm font-bold text-muted-foreground">{tradeSide === "buy" ? "$" : "sh"}</span>
                  <input
                    value={orderAmount}
                    onChange={(e) => setOrderAmount(e.target.value)}
                    disabled={tradeActionBusy}
                    inputMode="decimal"
                    className="h-11 sm:h-12 flex-1 bg-transparent outline-none text-lg font-bold text-foreground disabled:cursor-not-allowed"
                    placeholder="0.00"
                  />
                </div>
                <div className="flex gap-1.5">
                  {PERCENT_PRESETS.map((item) => {
                    const isBuy = tradeSide === "buy";
                    const refBalance = isBuy ? (spendablePusd ?? availablePusd ?? 0) : sellReferenceShares;
                    const targetAmount = refBalance * item.value;
                    const active = targetAmount > 0 && Math.abs(amountNumber - targetAmount) < (isBuy ? 0.015 : 0.0001);
                    const disabled = isBuy
                      ? !hasBuyReferenceBalance || tradeActionBusy
                      : !hasSellReferenceShares || tradeActionBusy;
                    return (
                      <button
                        key={item.label}
                        onClick={() => isBuy ? setBuyPercentAmount(item.value) : setSellPercentAmount(item.value)}
                        disabled={disabled}
                        className={cn(
                          "flex-1 h-8 rounded-full text-[11px] font-bold transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-45 active:scale-95",
                          active
                            ? "bg-[oklch(0.78_0.16_82)] text-[oklch(0.10_0.012_260)] shadow-[0_2px_8px_oklch(0.78_0.16_82/0.30)]"
                            : "bg-[oklch(0.15_0.013_255)] border border-[oklch(0.22_0.015_255)] text-muted-foreground hover:text-foreground hover:border-[oklch(0.30_0.018_255)]"
                        )}
                      >
                        {item.label}
                      </button>
                    );
                  })}
                </div>
                {connectedWalletAddress && (
                  <div className="grid grid-cols-3 gap-2 rounded-2xl border border-[oklch(0.20_0.014_255)] bg-[oklch(0.12_0.012_260)] p-3">
                    <div className="min-w-0">
                      <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground truncate">
                        {tradeSide === "buy" ? "Available" : "Position"}
                      </div>
                      <div className="mt-1.5 font-mono text-sm font-semibold text-foreground truncate">
                        {tradeSide === "buy"
                          ? availablePusd === null ? "--" : formatPusd(String(availablePusd))
                          : positionShares === null
                          ? hasSellReferenceShares ? `${sellReferenceShares.toFixed(2)} sh` : "--"
                          : `${positionShares.toFixed(2)} sh`}
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground truncate">
                        {tradeSide === "buy" ? "Spendable" : "Sellable"}
                      </div>
                      <div className={cn(
                        "mt-1.5 font-mono text-sm font-semibold truncate",
                        (tradeSide === "buy" ? spendablePusd : sellableShares) === null
                          ? "text-muted-foreground"
                          : (tradeSide === "buy" ? spendablePusd! : sellableShares!) > 0
                          ? "text-[oklch(0.68_0.18_155)]"
                          : "text-[oklch(0.78_0.16_82)]"
                      )}>
                        {tradeSide === "buy"
                          ? spendablePusd === null ? "--" : formatPusd(String(spendablePusd))
                          : sellableShares === null ? "--" : `${sellableShares.toFixed(2)} sh`}
                      </div>
                    </div>
                    <div className="text-right min-w-0">
                      <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground truncate">
                        After
                      </div>
                      <div className="mt-1.5 font-mono text-sm font-semibold text-foreground truncate">
                        {tradeSide === "buy"
                          ? remainingPusd === null ? "--" : formatPusd(String(remainingPusd))
                          : remainingShares === null ? "--" : `${remainingShares.toFixed(2)} sh`}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Order type selector */}
              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                  Order type
                </label>
                <div className="flex rounded-full border border-[oklch(0.22_0.015_255)] bg-[oklch(0.13_0.012_255)] p-0.5">
                  {(["market", "limit", "gtd"] as const).map((type) => (
                    <button
                      key={type}
                      onClick={() => setOrderType(type)}
                      disabled={tradeActionBusy}
                      className={cn(
                        "flex-1 py-2 rounded-full text-[10px] font-bold uppercase tracking-wide transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-60",
                        orderType === type
                          ? "bg-[oklch(0.78_0.16_82/0.18)] border border-[oklch(0.78_0.16_82/0.30)] text-[oklch(0.82_0.16_82)]"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {type === "market" ? "Market" : type === "limit" ? "Limit" : "GTD"}
                    </button>
                  ))}
                </div>

                {/* Limit price input */}
                {(orderType === "limit" || orderType === "gtd") && (
                  <div className="flex items-center gap-2 rounded-xl border border-[oklch(0.22_0.015_255)] bg-[oklch(0.15_0.013_255)] px-3 focus-within:border-[oklch(0.78_0.16_82/0.4)] transition-all">
                    <span className="text-xs text-muted-foreground">¢</span>
                    <input
                      type="number"
                      min="1"
                      max="99"
                      step="0.1"
                      value={limitPrice}
                      onChange={(e) => setLimitPrice(e.target.value)}
                      disabled={tradeActionBusy}
                      className="h-9 flex-1 bg-transparent outline-none text-sm font-semibold text-foreground"
                      placeholder={`Limit price (${activePrice.toFixed(1)}¢ market)`}
                    />
                  </div>
                )}

                {/* GTD expiry */}
                {orderType === "gtd" && (
                  <div className="flex items-center gap-2 rounded-xl border border-[oklch(0.22_0.015_255)] bg-[oklch(0.15_0.013_255)] px-3 focus-within:border-[oklch(0.78_0.16_82/0.4)] transition-all">
                    <input
                      type="datetime-local"
                      value={gtdExpiry}
                      onChange={(e) => setGtdExpiry(e.target.value)}
                      disabled={tradeActionBusy}
                      className="h-9 flex-1 bg-transparent outline-none text-xs font-semibold text-foreground"
                    />
                  </div>
                )}

                {(orderType === "limit" || orderType === "gtd") && (
                  <p className="text-[10px] text-muted-foreground leading-snug">
                    {orderType === "limit"
                      ? "GTC: order rests on the book until filled or manually cancelled."
                      : "GTD: order expires automatically at the selected date and time."}
                  </p>
                )}
              </div>

              {/* ── Step tracker — visible once wallet + trading profile are ready ── */}
              {connectedWalletAddress && tradingProfile.profile && (
                <div className="rounded-2xl border border-[oklch(0.20_0.014_255)] bg-[oklch(0.12_0.012_260/0.6)] px-3 py-3">
                  <TradeStepTracker stageIndex={tradeStageIndex} />
                </div>
              )}

              {/* ── Step 1 entry CTA: Connect / Resolve / Preview ──
                  Only shown before a preview exists. Once previewed, the progressive
                  step blocks below (approve → sign → submit) take over linearly. */}
              {!tradePreview && (
                !connectedWalletAddress ? (
                  <Button
                    className="w-full h-12 rounded-xl gap-2 bg-[oklch(0.78_0.16_82)] text-[oklch(0.12_0.01_255)] hover:bg-[oklch(0.82_0.16_82)] font-semibold text-sm shadow-[0_0_20px_oklch(0.78_0.16_82/0.25)] active:scale-[0.98] transition-transform"
                    onClick={handleConnectWallet}
                    disabled={!ready}
                  >
                    <Wallet className="w-4 h-4" />
                    {ready ? "Connect Wallet to Trade" : "Loading..."}
                  </Button>
                ) : !tradingProfile.profile ? (
                  <Button className="w-full h-12 rounded-xl gap-2" disabled>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Resolving Trading Wallet
                  </Button>
                ) : (
                  <div className="space-y-1.5">
                    <Button
                      className={cn(
                        "w-full h-12 sm:h-13 rounded-xl sm:rounded-2xl gap-2 font-bold text-sm active:scale-[0.98] transition-all duration-200",
                        tradeSide === "buy"
                          ? "bg-[oklch(0.78_0.16_82)] text-[oklch(0.10_0.01_255)] hover:bg-[oklch(0.83_0.16_82)] shadow-[0_4px_20px_oklch(0.78_0.16_82/0.35)]"
                          : "bg-[oklch(0.58_0.2_25)] text-white hover:bg-[oklch(0.63_0.2_25)] shadow-[0_4px_20px_oklch(0.58_0.2_25/0.25)]"
                      )}
                      onClick={handlePreviewTrade}
                      disabled={tradeActionBusy || !activeTokenId || amountNumber <= 0 || readiness.readiness?.canPreview === false || sellOrderbookUnavailable}
                    >
                      {previewLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : tradeSide === "buy" ? <TrendingUp className="w-4 h-4" /> : <ArrowDownUp className="w-4 h-4" />}
                      {sellOrderbookUnavailable
                        ? "Market settling"
                        : amountNumber <= 0
                        ? `Enter an amount to ${tradeSide}`
                        : `Preview ${tradeSide === "buy" ? "Buy" : "Sell"} ${activeOutcomeName}`}
                    </Button>
                    {readiness.readiness?.canPreview === false && readiness.readiness?.executionLockedReason && (
                      <p className="flex items-start gap-1.5 px-1 text-[10px] leading-snug text-[oklch(0.74_0.14_25)]">
                        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                        {readiness.readiness.executionLockedReason}
                      </p>
                    )}
                  </div>
                )
              )}

              {/* Return preview — only after a preview has been generated */}
              {tradePreview && (
              <div className="rounded-2xl border border-[oklch(0.22_0.015_255)] bg-[oklch(0.13_0.012_255)] p-4 space-y-3 text-xs">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Calculator className="h-3.5 w-3.5 text-[oklch(0.78_0.16_82)]" />
                    <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      Return preview
                    </span>
                  </div>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    Break-even {Math.max(0, Math.min(100, avgEntryPriceCents)).toFixed(1)}%
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg border border-[oklch(0.22_0.015_255)] bg-[oklch(0.12_0.012_260)] p-2">
                    <span className="block text-[10px] text-muted-foreground">Avg price</span>
                    <span className="mt-0.5 block font-mono font-semibold text-foreground">
                      {avgEntryPriceCents > 0 ? `${avgEntryPriceCents.toFixed(1)}¢` : "--"}
                    </span>
                  </div>
                  <div className="rounded-lg border border-[oklch(0.22_0.015_255)] bg-[oklch(0.12_0.012_260)] p-2">
                    <span className="block text-[10px] text-muted-foreground">
                      {tradeSide === "buy" ? "Est. shares" : "Shares listed"}
                    </span>
                    <span className="mt-0.5 block font-mono font-semibold text-foreground">
                      {estimatedShares.toFixed(2)}
                    </span>
                  </div>
                </div>

                {tradeSide === "buy" ? (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-lg bg-[oklch(0.68_0.18_155/0.08)] p-2">
                        <span className="block text-[10px] text-muted-foreground">Potential return</span>
                        <span className="mt-0.5 block font-mono font-semibold text-[oklch(0.68_0.18_155)]">
                          ${buyPotentialReturn.toFixed(2)}
                        </span>
                      </div>
                      <div className="rounded-lg bg-[oklch(0.68_0.18_155/0.08)] p-2">
                        <span className="block text-[10px] text-muted-foreground">Profit if correct</span>
                        <span className="mt-0.5 block font-mono font-semibold text-[oklch(0.68_0.18_155)]">
                          {buyPotentialProfit >= 0 ? "+" : "-"}${Math.abs(buyPotentialProfit).toFixed(2)}
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-lg bg-[oklch(0.16_0.014_255)] p-2">
                        <span className="block text-[10px] text-muted-foreground">ROI if correct</span>
                        <span className="mt-0.5 block font-mono font-semibold text-foreground">
                          {buyPotentialRoi >= 0 ? "+" : "-"}{Math.abs(buyPotentialRoi).toFixed(1)}%
                        </span>
                      </div>
                      <div className="rounded-lg bg-[oklch(0.58_0.2_25/0.08)] p-2">
                        <span className="block text-[10px] text-muted-foreground">Max loss</span>
                        <span className="mt-0.5 block font-mono font-semibold text-[oklch(0.58_0.2_25)]">
                          -${buyTotalCost.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-lg bg-[oklch(0.68_0.18_155/0.08)] p-2">
                        <span className="block text-[10px] text-muted-foreground">Cash secured</span>
                        <span className="mt-0.5 block font-mono font-semibold text-[oklch(0.68_0.18_155)]">
                          ${sellProceeds.toFixed(2)}
                        </span>
                      </div>
                      <div className="rounded-lg bg-[oklch(0.16_0.014_255)] p-2">
                        <span className="block text-[10px] text-muted-foreground">Capture rate</span>
                        <span className="mt-0.5 block font-mono font-semibold text-foreground">
                          {sellCaptureRate.toFixed(1)}%
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-lg bg-[oklch(0.58_0.2_25/0.08)] p-2">
                        <span className="block text-[10px] text-muted-foreground">Payout forgone</span>
                        <span className="mt-0.5 block font-mono font-semibold text-[oklch(0.58_0.2_25)]">
                          ${sellPayoutForgone.toFixed(2)}
                        </span>
                      </div>
                      <div className="rounded-lg bg-[oklch(0.16_0.014_255)] p-2">
                        <span className="block text-[10px] text-muted-foreground">Shares at risk</span>
                        <span className="mt-0.5 block font-mono font-semibold text-foreground">
                          {amountNumber.toFixed(4)} sh
                        </span>
                      </div>
                    </div>
                  </>
                )}

                {tradePreview?.avgPrice !== undefined && Math.abs(previewSlippageCents) >= 0.1 && (
                  <div className={cn(
                    "flex items-center justify-between rounded-lg border px-2.5 py-2",
                    Math.abs(previewSlippageCents) >= 5
                      ? "border-[oklch(0.58_0.2_25/0.35)] bg-[oklch(0.58_0.2_25/0.09)]"
                      : "border-[oklch(0.78_0.16_82/0.18)] bg-[oklch(0.78_0.16_82/0.07)]"
                  )}>
                    <span className={cn(
                      "flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest",
                      Math.abs(previewSlippageCents) >= 5 ? "text-[oklch(0.74_0.14_25)]" : "text-muted-foreground"
                    )}>
                      {Math.abs(previewSlippageCents) >= 5 && <AlertTriangle className="h-3 w-3" />}
                      {Math.abs(previewSlippageCents) >= 5 ? "High slippage" : "Depth impact"}
                    </span>
                    <span className={cn(
                      "font-mono",
                      Math.abs(previewSlippageCents) >= 5 ? "text-[oklch(0.74_0.14_25)]" : "text-[oklch(0.78_0.16_82)]"
                    )}>
                      {previewSlippageCents > 0 ? "+" : ""}{previewSlippageCents.toFixed(1)}¢ vs top book
                    </span>
                  </div>
                )}

                <p className="text-[10px] leading-snug text-muted-foreground">
                  Potential return assumes this outcome resolves correctly at $1.00 per share. You can still sell before resolution if book liquidity is available.
                </p>

                {tradePreview?.platformFee && (
                  <>
                    <div className="h-px bg-[oklch(0.22_0.015_255)]" />
                    <div className="flex items-center justify-between text-muted-foreground">
                      <span>{tradePreview.platformFee.label}</span>
                      <span className="font-mono text-foreground">
                        ${tradePreview.platformFee.amount.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground font-semibold">Total cost</span>
                      <span className="font-mono font-semibold text-foreground">
                        ${((tradePreview.filledAmountUsd ?? 0) + tradePreview.platformFee.amount).toFixed(2)}
                      </span>
                    </div>
                  </>
                )}
              </div>
              )}

              {(tradePreview || previewError) && (
                <div className="rounded-2xl border border-[oklch(0.22_0.015_255)] bg-[oklch(0.12_0.012_260)] p-4 space-y-2.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      Trade preview
                    </span>
                    {tradePreview?.bestAsk !== undefined && (
                      <span className="font-mono text-[oklch(0.78_0.16_82)]">
                        {tradeSide === "sell" ? "Best bid" : "Best ask"} {formatCents(tradePreview.bestAsk)}
                      </span>
                    )}
                  </div>

                  {previewError ? (
                    <div className="flex gap-2 rounded-lg border border-[oklch(0.58_0.2_25/0.3)] bg-[oklch(0.58_0.2_25/0.08)] p-2.5 text-[oklch(0.74_0.14_25)]">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>{previewError}</span>
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="rounded-lg bg-[oklch(0.16_0.014_255)] p-2">
                          <span className="block text-[10px] text-muted-foreground">{tradeSide === "sell" ? "Proceeds" : "Filled"}</span>
                          <span className="font-mono text-foreground">
                            ${(tradePreview?.filledAmountUsd ?? 0).toFixed(2)}
                          </span>
                        </div>
                        <div className="rounded-lg bg-[oklch(0.16_0.014_255)] p-2">
                          <span className="block text-[10px] text-muted-foreground">{tradeSide === "sell" ? "Worst bid" : "Max price"}</span>
                          <span className="font-mono text-foreground">{formatCents(tradePreview?.maxPrice)}</span>
                        </div>
                      </div>

                      {tradePreview?.platformFee && (
                        <div className="flex items-center justify-between text-[11px] text-muted-foreground px-0.5">
                          <span>{tradePreview.platformFee.label}</span>
                          <span className="font-mono text-foreground">${tradePreview.platformFee.amount.toFixed(2)}</span>
                        </div>
                      )}

                      {tradePreview?.tradeInsight && (
                        <div className="rounded-lg border border-[oklch(0.22_0.015_255)] bg-[oklch(0.15_0.013_255)] p-2.5 space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className={cn(
                              "text-[10px] font-bold uppercase tracking-widest",
                              tradePreview.tradeInsight.signal === "bullish"
                                ? "text-[oklch(0.68_0.18_155)]"
                                : tradePreview.tradeInsight.signal === "bearish"
                                ? "text-[oklch(0.58_0.2_25)]"
                                : "text-[oklch(0.78_0.16_82)]"
                            )}>
                              {tradePreview.tradeInsight.signal.toUpperCase()} SIGNAL
                            </span>
                            <span className="text-[10px] font-mono text-muted-foreground">
                              {tradePreview.tradeInsight.signalStrength}/100
                            </span>
                          </div>
                          <p className="text-[11px] font-semibold text-foreground leading-snug">
                            {tradePreview.tradeInsight.headline}
                          </p>
                          <p className="text-[11px] text-muted-foreground leading-snug">
                            {tradePreview.tradeInsight.context}
                          </p>
                          <div className="flex gap-1.5 items-start rounded-md bg-[oklch(0.12_0.012_260)] p-2 text-[10px] text-[oklch(0.78_0.16_82)]">
                            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                            <span>{tradePreview.tradeInsight.keyRisk}</span>
                          </div>
                        </div>
                      )}

                      {(tradePreview?.warnings?.length ?? 0) > 0 && (
                        <div className="space-y-1.5">
                          {tradePreview!.warnings!.map((warning) => (
                            <div
                              key={warning.code}
                              className={cn(
                                "flex gap-2 rounded-lg p-2 text-[11px]",
                                warning.severity === "warning"
                                  ? "border border-[oklch(0.76_0.14_70/0.3)] bg-[oklch(0.76_0.14_70/0.08)] text-[oklch(0.82_0.13_75)]"
                                  : "border border-[oklch(0.28_0.018_255)] bg-[oklch(0.16_0.014_255)] text-muted-foreground"
                              )}
                            >
                              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                              <span>{warning.message}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* ── Progressive trade steps — only show the CURRENT step ── */}
              {tradePreview && (() => {
                // Step 2 (activate): Session not ready → "Prepare trading session"
                if (clobSession.status !== "ready") {
                  return (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        <span className="grid h-5 w-5 place-items-center rounded-full bg-[oklch(0.78_0.16_82/0.15)] text-[oklch(0.78_0.16_82)] text-[9px]">2</span>
                        Activate trading session
                      </div>
                      <div className="rounded-lg border border-[oklch(0.78_0.16_82/0.2)] bg-[oklch(0.78_0.16_82/0.07)] p-2.5 text-[11px] leading-snug text-[oklch(0.78_0.16_82)]">
                        <p>Prepare your trading session once, then sign this order.</p>
                      </div>
                      <Button
                        type="button"
                        onClick={clobSession.prepareSession}
                        disabled={
                          clobSession.status === "preparing" ||
                          !connectedWallet ||
                          (tradingProfile.profile?.tradingWalletKind === "deposit" && depositWalletStatus.status?.deployed === false)
                        }
                        className="h-10 w-full gap-2 bg-[oklch(0.78_0.16_82)] text-[oklch(0.12_0.01_255)] hover:bg-[oklch(0.82_0.16_82)] font-semibold shadow-[0_0_22px_oklch(0.78_0.16_82/0.22)]"
                      >
                        {clobSession.status === "preparing" ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldAlert className="w-4 h-4" />}
                        {clobSession.status === "preparing" ? "Preparing..." : "Prepare Trading Session"}
                      </Button>
                    </div>
                  );
                }

                // Step 2 (buy): Collateral approval needed
                if (requiresCollateral && !tradeCollateralGate.ready) {
                  return (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        <span className="grid h-5 w-5 place-items-center rounded-full bg-[oklch(0.78_0.16_82/0.15)] text-[oklch(0.78_0.16_82)] text-[9px]">2</span>
                        {tradeCollateralGate.needsApproval ? "Approve Trading" : "Fund Account"}
                      </div>
                      <div className="rounded-lg border border-[oklch(0.58_0.2_25/0.3)] bg-[oklch(0.58_0.2_25/0.08)] p-2.5 text-[11px] leading-snug text-[oklch(0.74_0.14_25)]">
                        {tradeCollateralGate.message}
                      </div>
                      {tradeCollateralGate.needsApproval && (
                        <div className="space-y-2">
                          {tradingProfile.profile?.tradingWalletKind === "deposit" ? (
                            <>
                              <Button
                                type="button"
                                onClick={depositWalletApproval.approve}
                                disabled={
                                  depositWalletApproval.status === "preparing" ||
                                  depositWalletApproval.status === "signing" ||
                                  depositWalletApproval.status === "submitting" ||
                                  depositWalletStatus.status?.deployed === false
                                }
                                className="w-full h-10 gap-2 bg-[oklch(0.78_0.16_82)] text-[oklch(0.12_0.01_255)] hover:bg-[oklch(0.82_0.16_82)] font-semibold shadow-[0_0_22px_oklch(0.78_0.16_82/0.22)]"
                              >
                                {depositWalletApproval.status === "preparing" ||
                                depositWalletApproval.status === "signing" ||
                                depositWalletApproval.status === "submitting" ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : depositWalletApproval.status === "approved" ? (
                                  <Unlock className="w-4 h-4" />
                                ) : (
                                  <Lock className="w-4 h-4" />
                                )}
                                {depositWalletApproval.status === "preparing"
                                  ? "Preparing relayed approval..."
                                  : depositWalletApproval.status === "signing"
                                  ? "Sign approval batch..."
                                  : depositWalletApproval.status === "submitting"
                                  ? "Relaying approval..."
                                  : depositWalletApproval.status === "approved"
                                  ? "Trading Permissions Relayed ✓"
                                  : "Approve Trading via Relayer"}
                              </Button>
                              {depositWalletApproval.error && (
                                <p className="rounded-lg border border-[oklch(0.58_0.2_25/0.3)] bg-[oklch(0.58_0.2_25/0.08)] p-2 text-[11px] leading-snug text-[oklch(0.74_0.14_25)]">
                                  {depositWalletApproval.error}
                                </p>
                              )}
                            </>
                          ) : (
                            <>
                              <GasAssistButton
                                address={tradingWalletAddress}
                                active={Boolean(tradingWalletAddress && effectiveBalanceAllowance)}
                                reason="approve_pusd"
                                onAssisted={clobSession.refreshBalanceAllowance}
                              />
                              <Button
                                type="button"
                                onClick={clobSession.approveCollateral}
                                disabled={clobSession.approvalStatus === "approving"}
                                className="w-full h-10 gap-2 bg-[oklch(0.78_0.16_82)] text-[oklch(0.12_0.01_255)] hover:bg-[oklch(0.82_0.16_82)] font-semibold shadow-[0_0_22px_oklch(0.78_0.16_82/0.22)]"
                              >
                                {clobSession.approvalStatus === "approving" ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : clobSession.approvalStatus === "approved" ? (
                                  <Unlock className="w-4 h-4" />
                                ) : (
                                  <Lock className="w-4 h-4" />
                                )}
                                {clobSession.approvalStatus === "approving"
                                  ? "Approving pUSD…"
                                  : clobSession.approvalStatus === "approved"
                                  ? "pUSD Approved ✓"
                                  : "Approve pUSD for Trading"}
                              </Button>
                            </>
                          )}
                        </div>
                      )}
                      {tradeCollateralGate.needsFunding && !tradeCollateralGate.needsApproval && (
                        <Button
                          type="button"
                          onClick={() => openFundingModal("deposit")}
                          className="w-full h-10 gap-2 bg-[oklch(0.78_0.16_82)] text-[oklch(0.12_0.01_255)] hover:bg-[oklch(0.82_0.16_82)] font-semibold shadow-[0_0_22px_oklch(0.78_0.16_82/0.22)]"
                        >
                          <Wallet className="w-4 h-4" />
                          Fund pUSD from BNB
                        </Button>
                      )}
                    </div>
                  );
                }

                // Step 2 (sell): Position approval needed
                if (requiresPositionApproval && !tradePositionGate.ready) {
                  return (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        <span className="grid h-5 w-5 place-items-center rounded-full bg-[oklch(0.78_0.16_82/0.15)] text-[oklch(0.78_0.16_82)] text-[9px]">2</span>
                        {tradePositionGate.needsApproval ? "Approve Selling" : "Insufficient Shares"}
                      </div>
                      <div className="rounded-lg border border-[oklch(0.58_0.2_25/0.3)] bg-[oklch(0.58_0.2_25/0.08)] p-2.5 text-[11px] leading-snug text-[oklch(0.74_0.14_25)]">
                        {tradePositionGate.message}
                      </div>
                      {tradePositionGate.needsApproval && (
                        <div className="space-y-2">
                          {tradingProfile.profile?.tradingWalletKind === "deposit" ? (
                            <>
                              <Button
                                type="button"
                                onClick={depositWalletApproval.approve}
                                disabled={
                                  depositWalletApproval.status === "preparing" ||
                                  depositWalletApproval.status === "signing" ||
                                  depositWalletApproval.status === "submitting" ||
                                  depositWalletStatus.status?.deployed === false
                                }
                                className="w-full h-10 gap-2 bg-[oklch(0.78_0.16_82)] text-[oklch(0.12_0.01_255)] hover:bg-[oklch(0.82_0.16_82)] font-semibold shadow-[0_0_22px_oklch(0.78_0.16_82/0.22)]"
                              >
                                {depositWalletApproval.status === "preparing" ||
                                depositWalletApproval.status === "signing" ||
                                depositWalletApproval.status === "submitting" ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : depositWalletApproval.status === "approved" ? (
                                  <Unlock className="w-4 h-4" />
                                ) : (
                                  <Lock className="w-4 h-4" />
                                )}
                                {depositWalletApproval.status === "preparing"
                                  ? "Preparing relayed approval..."
                                  : depositWalletApproval.status === "signing"
                                  ? "Sign approval batch..."
                                  : depositWalletApproval.status === "submitting"
                                  ? "Relaying approval..."
                                  : depositWalletApproval.status === "approved"
                                  ? "Selling Permissions Relayed ✓"
                                  : "Approve Selling via Relayer"}
                              </Button>
                              {depositWalletApproval.error && (
                                <p className="rounded-lg border border-[oklch(0.58_0.2_25/0.3)] bg-[oklch(0.58_0.2_25/0.08)] p-2 text-[11px] leading-snug text-[oklch(0.74_0.14_25)]">
                                  {depositWalletApproval.error}
                                </p>
                              )}
                            </>
                          ) : (
                            <>
                              <GasAssistButton
                                address={tradingWalletAddress}
                                active={Boolean(tradingWalletAddress && clobSession.conditionalBalanceAllowance)}
                                reason="approve_position_tokens"
                                onAssisted={async () => {
                                  if (activeTokenId) await clobSession.refreshConditionalBalanceAllowance(activeTokenId);
                                }}
                              />
                              <Button
                                type="button"
                                onClick={async () => {
                                  const approved = await clobSession.approveConditionalTokens();
                                  if (approved) {
                                    setPreviewError(null);
                                    setSubmitDialogError(null);
                                  }
                                  if (approved && activeTokenId) await clobSession.refreshConditionalBalanceAllowance(activeTokenId);
                                }}
                                disabled={clobSession.approvalStatus === "approving"}
                                className="w-full h-10 gap-2 bg-[oklch(0.78_0.16_82)] text-[oklch(0.12_0.01_255)] hover:bg-[oklch(0.82_0.16_82)] font-semibold shadow-[0_0_22px_oklch(0.78_0.16_82/0.22)]"
                              >
                                {clobSession.approvalStatus === "approving" ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : clobSession.approvalStatus === "approved" ? (
                                  <Unlock className="w-4 h-4" />
                                ) : (
                                  <Lock className="w-4 h-4" />
                                )}
                                {clobSession.approvalStatus === "approving"
                                  ? "Approving sell permissions..."
                                  : clobSession.approvalStatus === "approved"
                                  ? "Sell Permissions Approved ✓"
                                  : "Approve Selling for Trading"}
                              </Button>
                            </>
                          )}
                        </div>
                      )}
                      {tradePositionGate.needsFunding && !tradePositionGate.needsApproval && (
                        <p className="rounded-lg border border-[oklch(0.78_0.16_82/0.22)] bg-[oklch(0.78_0.16_82/0.07)] p-2.5 text-[11px] leading-snug text-[oklch(0.78_0.16_82)]">
                          You need more shares of this outcome before you can sell this amount.
                        </p>
                      )}
                    </div>
                  );
                }

                // Step 3: All approvals done → Sign order (only if not already signed)
                if (!previewError && !clobSession.signedOrderPreview) {
                  return (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        <span className="grid h-5 w-5 place-items-center rounded-full bg-[oklch(0.68_0.18_155/0.18)] text-[oklch(0.68_0.18_155)] text-[9px]">3</span>
                        Sign your order
                      </div>
                      <Button
                        type="button"
                        onClick={handleCreateSignedOrder}
                        disabled={signOrderPreviewDisabled}
                        className="w-full h-10 gap-2 font-semibold border border-[oklch(0.78_0.16_82/0.55)] bg-[oklch(0.78_0.16_82)] text-[oklch(0.12_0.01_255)] shadow-[0_0_22px_oklch(0.78_0.16_82/0.22)] hover:bg-[oklch(0.82_0.16_82)] transition-all"
                      >
                        {signingOrder ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldAlert className="w-4 h-4" />}
                        {signingOrder ? "Waiting for wallet signature..." : "Sign Order Preview"}
                      </Button>
                    </div>
                  );
                }

                // No action needed at this point (signed order is shown separately below)
                return null;
              })()}

              {clobSession.signedOrderPreview && (
                <div className="rounded-2xl border border-[oklch(0.68_0.18_155/0.32)] bg-[oklch(0.68_0.18_155/0.08)] p-4 space-y-2.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-[oklch(0.68_0.18_155)]">
                      <span className="grid h-5 w-5 place-items-center rounded-full bg-[oklch(0.68_0.18_155/0.18)] text-[9px]">4</span>
                      Review &amp; submit
                    </span>
                    <span className="text-[9px] font-bold uppercase tracking-widest text-[oklch(0.68_0.18_155)]">
                      Not submitted
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-lg bg-[oklch(0.16_0.014_255)] p-2">
                      <span className="block text-[10px] text-muted-foreground">Order type</span>
                      <span className="font-mono text-foreground">{clobSession.signedOrderPreview.orderType}</span>
                    </div>
                    <div className="rounded-lg bg-[oklch(0.16_0.014_255)] p-2">
                      <span className="block text-[10px] text-muted-foreground">Side</span>
                      <span className="font-mono text-foreground">{clobSession.signedOrderPreview.side}</span>
                    </div>
                    <div className="rounded-lg bg-[oklch(0.16_0.014_255)] p-2">
                      <span className="block text-[10px] text-muted-foreground">Maker</span>
                      <span className="font-mono text-foreground">{shortAddress(clobSession.signedOrderPreview.maker)}</span>
                    </div>
                    <div className="rounded-lg bg-[oklch(0.16_0.014_255)] p-2">
                      <span className="block text-[10px] text-muted-foreground">Signer</span>
                      <span className="font-mono text-foreground">{shortAddress(clobSession.signedOrderPreview.signer)}</span>
                    </div>
                  </div>

                  <div className="rounded-lg border border-[oklch(0.28_0.018_255)] bg-[oklch(0.14_0.013_255)] p-2 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">Maker amount</span>
                      <span className="font-mono text-foreground">{clobSession.signedOrderPreview.makerAmount}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">Taker amount</span>
                      <span className="font-mono text-foreground">{clobSession.signedOrderPreview.takerAmount}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">Signature</span>
                      <span className="font-mono text-foreground">{clobSession.signedOrderPreview.signaturePreview}</span>
                    </div>
                  </div>

                  <p className="text-[11px] leading-snug text-muted-foreground">
                    This signed payload is held in browser memory until you submit or clear it.
                  </p>

                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={clobSession.clearSignedOrderPreview}
                      disabled={clobSession.submitStatus === "submitting"}
                      className="h-10 rounded-xl text-xs border-[oklch(0.24_0.016_255)] text-muted-foreground hover:text-foreground"
                    >
                      Clear
                    </Button>
                    <Button
                      type="button"
                      onClick={() => setSubmitConfirmOpen(true)}
                      disabled={
                        clobSession.submitStatus === "submitting" ||
                        (clobSession.signedOrderPreview.side === "BUY" && !tradeCollateralGate.ready) ||
                        (clobSession.signedOrderPreview.side === "SELL" && !tradePositionGate.ready)
                      }
                      className="h-10 rounded-xl gap-2 bg-[oklch(0.68_0.18_155)] text-[oklch(0.10_0.01_255)] hover:bg-[oklch(0.72_0.18_155)] text-xs font-bold shadow-[0_4px_16px_oklch(0.68_0.18_155/0.25)]"
                    >
                      <Send className="w-3.5 h-3.5" />
                      Submit
                    </Button>
                  </div>
                </div>
              )}

              {clobSession.orderSubmission && (
                <div
                  className={cn(
                    "rounded-2xl border p-4 space-y-2.5 text-xs",
                    clobSession.orderSubmission.success
                      ? "border-[oklch(0.68_0.18_155/0.35)] bg-[oklch(0.68_0.18_155/0.08)]"
                      : "border-[oklch(0.58_0.2_25/0.35)] bg-[oklch(0.58_0.2_25/0.08)]"
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={cn(
                        "text-[10px] font-bold uppercase tracking-widest",
                        clobSession.orderSubmission.success
                          ? "text-[oklch(0.68_0.18_155)]"
                          : "text-[oklch(0.74_0.14_25)]"
                      )}
                    >
                      Order submission
                    </span>
                    <span className="font-mono text-foreground">
                      {clobSession.orderSubmission.success ? (clobSession.orderSubmission.status ?? "submitted") : "failed"}
                    </span>
                  </div>

                  {clobSession.orderSubmission.success ? (
                    <div className="space-y-1.5">
                      {clobSession.orderSubmission.orderId && (
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-muted-foreground">Order ID</span>
                          <span className="font-mono text-foreground">{shortAddress(clobSession.orderSubmission.orderId)}</span>
                        </div>
                      )}
                      {clobSession.orderSubmission.takingAmount && (
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-muted-foreground">Taking</span>
                          <span className="font-mono text-foreground">{clobSession.orderSubmission.takingAmount}</span>
                        </div>
                      )}
                      {clobSession.orderSubmission.makingAmount && (
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-muted-foreground">Making</span>
                          <span className="font-mono text-foreground">{clobSession.orderSubmission.makingAmount}</span>
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => clobSession.refreshSubmittedOrder()}
                        disabled={!clobSession.orderSubmission.orderId || clobSession.orderStatusRefresh === "loading"}
                        className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-[oklch(0.22_0.015_255)] bg-[oklch(0.16_0.014_255)] px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                      >
                        <RefreshCw className={cn("h-3 w-3", clobSession.orderStatusRefresh === "loading" && "animate-spin")} />
                        Refresh order status
                      </button>
                      {clobSession.orderStatus && (
                        <div className="mt-2 rounded-lg border border-[oklch(0.22_0.015_255)] bg-[oklch(0.12_0.012_260)] p-2 space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-muted-foreground">CLOB status</span>
                            <span className="font-mono text-foreground">{clobSession.orderStatus.status ?? "tracked"}</span>
                          </div>
                          {clobSession.orderStatus.sizeMatched && (
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-muted-foreground">Matched</span>
                              <span className="font-mono text-foreground">{clobSession.orderStatus.sizeMatched}</span>
                            </div>
                          )}
                          {clobSession.orderStatus.price && (
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-muted-foreground">Price</span>
                              <span className="font-mono text-foreground">{clobSession.orderStatus.price}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex min-w-0 gap-2 rounded-lg border border-[oklch(0.58_0.2_25/0.3)] bg-[oklch(0.58_0.2_25/0.08)] p-2.5 text-[oklch(0.74_0.14_25)]">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span className="min-w-0 overflow-hidden break-words leading-snug">
                        {friendlyTradeError(clobSession.orderSubmission.errorMsg)}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {(
                <div className="rounded-xl border border-[oklch(0.22_0.015_255)] bg-[oklch(0.13_0.012_260)] p-3.5 space-y-3 text-xs">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <span className="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        Open orders
                      </span>
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">
                        Resting GTC/GTD orders from this CLOB session.
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => clobSession.refreshOpenOrders()}
                      disabled={clobSession.status !== "ready" || clobSession.openOrdersStatus === "loading"}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[oklch(0.22_0.015_255)] bg-[oklch(0.16_0.014_255)] px-2.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                    >
                      <RefreshCw className={cn("h-3 w-3", clobSession.openOrdersStatus === "loading" && "animate-spin")} />
                      Refresh
                    </button>
                  </div>

                  {clobSession.status !== "ready" ? (
                    <div className="rounded-lg border border-[oklch(0.78_0.16_82/0.2)] bg-[oklch(0.78_0.16_82/0.07)] p-2.5 text-[11px] leading-snug text-[oklch(0.78_0.16_82)]">
                      Prepare the CLOB session to load and cancel resting limit orders for this wallet.
                    </div>
                  ) : clobSession.openOrdersStatus === "loading" ? (
                    <div className="flex items-center gap-2 rounded-lg border border-[oklch(0.22_0.015_255)] bg-[oklch(0.16_0.014_255)] p-2.5 text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Loading open orders...
                    </div>
                  ) : clobSession.openOrders.length ? (
                    <div className="space-y-2">
                      {clobSession.openOrders.map((order) => (
                        <div
                          key={order.id}
                          className="rounded-lg border border-[oklch(0.22_0.015_255)] bg-[oklch(0.15_0.013_255)] p-2.5 space-y-2"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className={cn(
                                  "rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest",
                                  order.side === "BUY"
                                    ? "bg-[oklch(0.68_0.18_155/0.12)] text-[oklch(0.68_0.18_155)]"
                                    : "bg-[oklch(0.58_0.2_25/0.12)] text-[oklch(0.64_0.18_25)]"
                                )}>
                                  {order.side ?? "Order"}
                                </span>
                                <span className="rounded-md bg-[oklch(0.78_0.16_82/0.1)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-[oklch(0.78_0.16_82)]">
                                  {order.orderType ?? "GTC"}
                                </span>
                                <span className="font-mono text-[10px] text-muted-foreground">{shortAddress(order.id)}</span>
                              </div>
                              <div className="mt-1 text-[11px] text-muted-foreground">
                                {order.outcome ?? "Outcome"} at {order.price ? `${(Number(order.price) * 100).toFixed(1)}¢` : "--"}
                              </div>
                            </div>
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => setCancelOrderId(order.id)}
                              disabled={cancelingOrderId === order.id}
                              className="h-8 shrink-0 border-[oklch(0.58_0.2_25/0.35)] px-2.5 text-[10px] font-bold uppercase tracking-widest text-[oklch(0.64_0.18_25)] hover:bg-[oklch(0.58_0.2_25/0.1)]"
                            >
                              {cancelingOrderId === order.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Cancel"}
                            </Button>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-[10px] text-muted-foreground">
                            <div className="flex items-center justify-between gap-2 rounded-md bg-[oklch(0.12_0.012_260)] px-2 py-1">
                              <span>Size</span>
                              <span className="font-mono text-foreground">{order.originalSize ?? "--"}</span>
                            </div>
                            <div className="flex items-center justify-between gap-2 rounded-md bg-[oklch(0.12_0.012_260)] px-2 py-1">
                              <span>Matched</span>
                              <span className="font-mono text-foreground">{order.sizeMatched ?? "0"}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-[oklch(0.22_0.015_255)] bg-[oklch(0.16_0.014_255)] p-2.5 text-[11px] text-muted-foreground">
                      No open resting orders found for this session.
                    </div>
                  )}
                </div>
              )}

              <AlertDialog open={submitConfirmOpen} onOpenChange={setSubmitConfirmOpen}>
                <AlertDialogContent className="border-[oklch(0.22_0.015_255)] bg-[oklch(0.13_0.012_260)]">
                  <AlertDialogHeader>
                    <AlertDialogTitle>Submit signed order?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This sends the signed {tradeSide.toUpperCase()} order to Polymarket CLOB. The order may execute immediately or fail if balance, allowance, region, market status, or liquidity checks fail.
                    </AlertDialogDescription>
                  </AlertDialogHeader>

                  <div className="rounded-xl border border-[oklch(0.22_0.015_255)] bg-[oklch(0.16_0.014_255)] p-3 text-xs space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Outcome</span>
                      <span className="font-mono text-foreground">{activeOutcomeName}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Amount</span>
                      <span className="font-mono text-foreground">
                        {clobSession.signedOrderPreview?.side === "SELL"
                          ? `${amountNumber.toFixed(4)} shares`
                          : `$${amountNumber.toFixed(2)}`}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Order type</span>
                      <span className="font-mono text-foreground">{clobSession.signedOrderPreview?.orderType ?? "FAK"}</span>
                    </div>
                  </div>

                  {submitDialogError && (
                    <div className="flex gap-2 rounded-lg border border-[oklch(0.58_0.2_25/0.35)] bg-[oklch(0.58_0.2_25/0.08)] p-2.5 text-[11px] text-[oklch(0.74_0.14_25)]">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span className="min-w-0 break-words leading-snug">{submitDialogError}</span>
                    </div>
                  )}

                  <AlertDialogFooter>
                    <AlertDialogCancel
                      disabled={clobSession.submitStatus === "submitting"}
                      onClick={() => setSubmitDialogError(null)}
                    >
                      Cancel
                    </AlertDialogCancel>
                    <AlertDialogAction
                      onClick={(event) => {
                        event.preventDefault();
                        void handleSubmitSignedOrder();
                      }}
                      disabled={
                        clobSession.submitStatus === "submitting" ||
                        (clobSession.signedOrderPreview?.side === "BUY" && !tradeCollateralGate.ready) ||
                        (clobSession.signedOrderPreview?.side === "SELL" && !tradePositionGate.ready)
                      }
                      className="gap-2 bg-[oklch(0.68_0.18_155)] text-[oklch(0.10_0.01_255)] hover:bg-[oklch(0.72_0.18_155)]"
                    >
                      {clobSession.submitStatus === "submitting" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                      Submit order
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

              <AlertDialog open={Boolean(cancelOrderId)} onOpenChange={(open) => !open && setCancelOrderId(null)}>
                <AlertDialogContent className="border-[oklch(0.22_0.015_255)] bg-[oklch(0.13_0.012_260)]">
                  <AlertDialogHeader>
                    <AlertDialogTitle>Cancel open order?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This sends a cancellation request to Polymarket CLOB for the resting order. Any already matched amount cannot be reversed.
                    </AlertDialogDescription>
                  </AlertDialogHeader>

                  {cancelTargetOrder && (
                    <div className="rounded-xl border border-[oklch(0.22_0.015_255)] bg-[oklch(0.16_0.014_255)] p-3 text-xs space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground">Order</span>
                        <span className="font-mono text-foreground">{shortAddress(cancelTargetOrder.id)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground">Side</span>
                        <span className="font-mono text-foreground">{cancelTargetOrder.side ?? "--"}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground">Price</span>
                        <span className="font-mono text-foreground">
                          {cancelTargetOrder.price ? `${(Number(cancelTargetOrder.price) * 100).toFixed(1)}¢` : "--"}
                        </span>
                      </div>
                    </div>
                  )}

                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={Boolean(cancelingOrderId)}>Keep order</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={(event) => {
                        event.preventDefault();
                        void handleCancelOpenOrder();
                      }}
                      disabled={!cancelOrderId || Boolean(cancelingOrderId)}
                      className="gap-2 bg-[oklch(0.58_0.2_25)] text-white hover:bg-[oklch(0.62_0.19_25)]"
                    >
                      {cancelingOrderId ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertTriangle className="h-4 w-4" />}
                      Cancel order
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

              {/* Trading access — surfaced only for deposit-wallet deployment or errors.
                  Generic session activation is owned by the onboarding stepper (pre-preview)
                  and the linear step flow (post-preview), so it isn't duplicated here. */}
              {connectedWalletAddress && (
                clobSession.error ||
                depositWalletStatus.error ||
                (tradingProfile.profile?.tradingWalletKind === "deposit" && depositWalletStatus.status?.deployed !== true)
              ) && (
                <div className="rounded-xl border border-[oklch(0.22_0.015_255)] bg-[oklch(0.13_0.012_260)] p-3 text-xs space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold text-foreground">Trading access</p>
                      <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                        {clobSession.status === "ready"
                          ? "Ready to sign orders."
                          : tradingProfile.profile?.tradingWalletKind === "deposit" && depositWalletStatus.deploying
                          ? "Deploying your trading wallet on Polygon..."
                          : tradingProfile.profile?.tradingWalletKind === "deposit" && depositWalletStatus.status?.deployed !== true
                          ? "Setting up your Polymarket trading wallet..."
                          : "Prepare your secure trading session before signing."}
                      </p>
                    </div>
                    {clobSession.status === "ready" ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-[oklch(0.68_0.18_155)]" />
                    ) : depositWalletStatus.deploying ? (
                      <Loader2 className="h-4 w-4 shrink-0 text-[oklch(0.78_0.16_82)] animate-spin" />
                    ) : (
                      <ShieldAlert className="h-4 w-4 shrink-0 text-[oklch(0.78_0.16_82)]" />
                    )}
                  </div>

                  {tradingProfile.profile?.tradingWalletKind === "deposit" && depositWalletStatus.status?.deployed !== true ? (
                    <Button
                      type="button"
                      onClick={async () => {
                        await depositWalletStatus.deploy();
                        await depositWalletStatus.refresh();
                      }}
                      disabled={depositWalletStatus.deploying || depositWalletStatus.status?.builderConfigured === false}
                      className="h-9 w-full gap-2 bg-[oklch(0.78_0.16_82)] text-[oklch(0.12_0.01_255)] hover:bg-[oklch(0.82_0.16_82)] text-xs font-semibold"
                    >
                      {depositWalletStatus.deploying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldAlert className="h-3.5 w-3.5" />}
                      {depositWalletStatus.deploying ? "Deploying wallet..." : "Deploy trading wallet"}
                    </Button>
                  ) : clobSession.status !== "ready" ? (
                    <Button
                      type="button"
                      onClick={clobSession.prepareSession}
                      disabled={clobSession.status === "preparing" || !connectedWallet}
                      className="h-9 w-full gap-2 bg-[oklch(0.78_0.16_82)] text-[oklch(0.12_0.01_255)] hover:bg-[oklch(0.82_0.16_82)] text-xs font-semibold"
                    >
                      {clobSession.status === "preparing" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldAlert className="w-3.5 h-3.5" />}
                      {clobSession.status === "preparing" ? "Preparing..." : "Prepare trading session"}
                    </Button>
                  ) : null}

                  {(clobSession.error || depositWalletStatus.error) && (
                    <div className="flex min-w-0 gap-2 rounded-lg border border-[oklch(0.58_0.2_25/0.3)] bg-[oklch(0.58_0.2_25/0.08)] p-2.5 text-[11px] text-[oklch(0.74_0.14_25)]">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                      <span className="min-w-0 overflow-hidden break-words leading-snug">
                        {depositWalletStatus.error ?? friendlyTradeError(clobSession.error)}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Collapsible wallet section */}
              {connectedWalletAddress && (
                <div className="rounded-xl border border-[oklch(0.22_0.015_255)] bg-[oklch(0.13_0.012_260)] overflow-hidden">
                  <button
                    onClick={() => setWalletExpanded((v) => !v)}
                    className="w-full flex items-center justify-between px-3.5 py-2.5 text-xs hover:bg-[oklch(0.16_0.014_255)] transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <Wallet className="w-3.5 h-3.5 text-[oklch(0.78_0.16_82)]" />
                      <span className="font-semibold text-muted-foreground">Wallet</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-semibold text-[oklch(0.78_0.16_82)]">BNB Chain</span>
                      {walletExpanded ? (
                        <ChevronUp className="w-3 h-3 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="w-3 h-3 text-muted-foreground" />
                      )}
                    </div>
                  </button>

                  {walletExpanded && (
                    <div className="px-3.5 pb-3 space-y-2.5 text-xs border-t border-[oklch(0.22_0.015_255)] pt-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Connected</span>
                        <span className="font-mono text-foreground">{shortAddress(connectedWalletAddress)}</span>
                      </div>
                      {tradingWalletAddress && (
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">
                            {tradingProfile.profile?.tradingWalletKind === "deposit" ? "Poly deposit wallet" : "Trading"}
                          </span>
                          <button
                            onClick={() => copyToClipboard(tradingWalletAddress, "Trading wallet")}
                            className="flex items-center gap-1.5 font-mono text-foreground hover:text-[oklch(0.78_0.16_82)] transition-colors"
                          >
                            {shortAddress(tradingWalletAddress)}
                            <Copy className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                      {depositAddress && (
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Deposit</span>
                          <button
                            onClick={() => copyToClipboard(depositAddress, "Deposit address")}
                            className="flex items-center gap-1.5 font-mono text-foreground hover:text-[oklch(0.78_0.16_82)] transition-colors"
                          >
                            {shortAddress(depositAddress)}
                            <Copy className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                      {depositAddress && (
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-muted-foreground">Funding</span>
                          <button
                            type="button"
                            onClick={fundingStatus.refresh}
                            disabled={fundingStatus.loading}
                            className={cn("flex items-center gap-1.5 font-semibold transition-colors", fundingStatusTone(fundingStatus.phase))}
                          >
                            {fundingStatus.loading && <RefreshCw className="h-3 w-3 animate-spin" />}
                            {fundingStatus.label}
                          </button>
                        </div>
                      )}
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Status</span>
                        <span
                          className={cn(
                            "font-semibold",
                            tradingProfile.error
                              ? "text-[oklch(0.58_0.2_25)]"
                              : tradingProfile.profile
                              ? "text-[oklch(0.68_0.18_155)]"
                              : "text-muted-foreground"
                          )}
                        >
                          {tradingProfile.loading
                            ? "Resolving..."
                            : tradingProfile.error
                            ? "Unavailable"
                            : tradingProfile.profile?.status ?? "Not set up"}
                        </span>
                      </div>

                      <div className="flex gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => openFundingModal(depositAddress ? "withdraw" : "deposit")}
                          disabled={tradingProfile.depositLoading || !tradingProfile.profile}
                          className="flex-1 h-8 rounded-lg border border-[oklch(0.78_0.16_82/0.3)] bg-[oklch(0.78_0.16_82/0.08)] text-[10px] font-bold uppercase tracking-widest text-[oklch(0.78_0.16_82)] hover:bg-[oklch(0.78_0.16_82/0.15)] disabled:opacity-50 transition-colors"
                        >
                          {depositAddress ? "Manage funds" : "Fund from BNB"}
                        </button>
                        <button
                          type="button"
                          onClick={tradingProfile.refresh}
                          disabled={tradingProfile.loading}
                          className="h-8 px-3 rounded-lg border border-[oklch(0.22_0.015_255)] bg-[oklch(0.16_0.014_255)] text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
                        >
                          <RefreshCw className={cn("w-3 h-3", tradingProfile.loading && "animate-spin")} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Wallet notice */}
              {walletNotice && (
                <p className="text-[11px] text-center text-muted-foreground">{walletNotice}</p>
              )}
            </div>
          </div>
        </div>
      </main>
      {/* ── Mobile sticky bottom trade bar ── */}
      <div className="lg:hidden fixed bottom-0 inset-x-0 z-40 glass-surface border-t border-[oklch(0.28_0.016_255/0.55)] safe-bottom">
        <div className="flex items-center gap-2 px-4 py-2.5 max-w-7xl mx-auto">
          {/* Price pills */}
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            <span className="text-xs font-bold text-[oklch(0.74_0.20_155)] tabular-nums">Yes {yesPrice.toFixed(0)}¢</span>
            <span className="text-[oklch(0.24_0.014_255)]">/</span>
            <span className="text-xs font-bold text-[oklch(0.65_0.20_25)] tabular-nums">No {noPrice.toFixed(0)}¢</span>
          </div>
          {/* Quick trade buttons — resolve Yes/No to real outcome indices */}
          <div className="flex gap-2 shrink-0">
            <button
              onClick={() => {
                setTradeSide("buy");
                const idx = market.outcomes.findIndex((o) => o.trim().toLowerCase().includes("yes"));
                setSelectedOutcomeIdx(idx >= 0 ? idx : 0);
                document.getElementById("trade-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
              className="h-10 px-5 rounded-xl btn-yes btn-press flex items-center justify-center"
            >
              <span className="text-[12px] font-bold text-[oklch(0.92_0.12_155)]">Buy Yes</span>
            </button>
            <button
              onClick={() => {
                setTradeSide("buy");
                const idx = market.outcomes.findIndex((o) => o.trim().toLowerCase().includes("no"));
                setSelectedOutcomeIdx(idx >= 0 ? idx : Math.min(1, market.outcomes.length - 1));
                document.getElementById("trade-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
              className="h-10 px-5 rounded-xl btn-no btn-press flex items-center justify-center"
            >
              <span className="text-[12px] font-bold text-[oklch(0.90_0.12_25)]">Buy No</span>
            </button>
          </div>
        </div>
      </div>

      <Footer />
      <BnbFundingModal
        open={fundingOpen}
        onOpenChange={setFundingOpen}
        initialTab={fundingInitialTab}
        profile={tradingProfile.profile}
        depositAddress={depositAddress}
        loadingDeposit={tradingProfile.depositLoading}
        onCreateDepositAddress={tradingProfile.createDepositAddress}
        wallet={connectedWallet}
        collateralBalance={effectiveBalanceAllowance?.balance ?? null}
        collateralAllowance={effectiveBalanceAllowance?.allowance ?? null}
        collateralSessionReady={clobSession.status === "ready"}
        onRefreshCollateralBalance={clobSession.refreshBalanceAllowance}
        onFundingSent={() => clobSession.refreshBalanceAllowance()}
      />
    </div>
  );
}
