export type BookLevel = {
  price: number;
  size: number;
};

export type TradePreviewWarning = {
  code:
    | "amount_below_min_order_size"
    | "balance_not_checked"
    | "insufficient_visible_liquidity"
    | "neg_risk_market"
    | "no_orderbook";
  message: string;
  severity: "info" | "warning";
};

export type TradePreviewInput = {
  amountUsd: number;
  asks: BookLevel[];
  minOrderSize?: number | null;
  tickSize?: number | null;
  negRisk?: boolean;
};

export type TradePreviewResult = {
  filledAmountUsd: number;
  unfilledAmountUsd: number;
  estimatedShares: number;
  avgPrice: number | null;
  maxPrice: number | null;
  bestAsk: number | null;
  minOrderSize: number | null;
  tickSize: number | null;
  warnings: TradePreviewWarning[];
};

type UnknownRecord = Record<string, unknown>;

export function parseStringArray(raw: unknown): string[] {
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

export function parseNumber(raw: unknown): number | null {
  const value = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : Number.NaN;
  return Number.isFinite(value) ? value : null;
}

export function parseBoolean(raw: unknown): boolean {
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "string") return raw.toLowerCase() === "true";
  return false;
}

export function parseBookLevels(raw: unknown, side: "asks" | "bids"): BookLevel[] {
  const book = raw && typeof raw === "object" ? (raw as UnknownRecord) : {};
  const levels = Array.isArray(book[side]) ? (book[side] as unknown[]) : [];

  return levels
    .map((level) => {
      if (Array.isArray(level)) {
        return {
          price: parseNumber(level[0]) ?? Number.NaN,
          size: parseNumber(level[1]) ?? Number.NaN
        };
      }

      if (level && typeof level === "object") {
        const entry = level as UnknownRecord;
        return {
          price: parseNumber(entry.price) ?? Number.NaN,
          size: parseNumber(entry.size) ?? Number.NaN
        };
      }

      return { price: Number.NaN, size: Number.NaN };
    })
    .filter((level) => Number.isFinite(level.price) && Number.isFinite(level.size) && level.price > 0 && level.size > 0)
    .sort((a, b) => (side === "asks" ? a.price - b.price : b.price - a.price));
}

export function buildBuyPreview(input: TradePreviewInput): TradePreviewResult {
  const minOrderSize = input.minOrderSize ?? null;
  const tickSize = input.tickSize ?? null;
  const warnings: TradePreviewWarning[] = [
    {
      code: "balance_not_checked",
      message: "Spendable pUSD balance and CLOB allowance are not checked in this preview yet.",
      severity: "info"
    }
  ];

  if (input.negRisk) {
    warnings.push({
      code: "neg_risk_market",
      message: "This market uses negative-risk handling; execution must preserve Polymarket order rules.",
      severity: "info"
    });
  }

  if (!input.asks.length) {
    warnings.push({
      code: "no_orderbook",
      message: "No visible asks are available for this outcome right now.",
      severity: "warning"
    });

    return {
      filledAmountUsd: 0,
      unfilledAmountUsd: roundMoney(input.amountUsd),
      estimatedShares: 0,
      avgPrice: null,
      maxPrice: null,
      bestAsk: null,
      minOrderSize,
      tickSize,
      warnings
    };
  }

  let remaining = input.amountUsd;
  let filledAmountUsd = 0;
  let estimatedShares = 0;
  let maxPrice: number | null = null;

  for (const level of input.asks) {
    if (remaining <= 0) break;
    const levelCost = level.price * level.size;
    const spendAtLevel = Math.min(remaining, levelCost);
    const sharesAtLevel = spendAtLevel / level.price;

    filledAmountUsd += spendAtLevel;
    estimatedShares += sharesAtLevel;
    remaining -= spendAtLevel;
    maxPrice = level.price;
  }

  if (minOrderSize !== null && estimatedShares < minOrderSize) {
    warnings.push({
      code: "amount_below_min_order_size",
      message: `Estimated shares are below the market minimum order size (${minOrderSize}).`,
      severity: "warning"
    });
  }

  if (remaining > 0.000001) {
    warnings.push({
      code: "insufficient_visible_liquidity",
      message: "Visible liquidity cannot fill the full preview amount at the current order book depth.",
      severity: "warning"
    });
  }

  return {
    filledAmountUsd: roundMoney(filledAmountUsd),
    unfilledAmountUsd: roundMoney(Math.max(0, remaining)),
    estimatedShares: roundShares(estimatedShares),
    avgPrice: estimatedShares > 0 ? roundPrice(filledAmountUsd / estimatedShares) : null,
    maxPrice: maxPrice === null ? null : roundPrice(maxPrice),
    bestAsk: roundPrice(input.asks[0].price),
    minOrderSize,
    tickSize,
    warnings
  };
}

export type SellPreviewInput = {
  amountShares: number;
  bids: BookLevel[];
  minOrderSize?: number | null;
  tickSize?: number | null;
  negRisk?: boolean;
};

export function buildSellPreview(input: SellPreviewInput): TradePreviewResult {
  const minOrderSize = input.minOrderSize ?? null;
  const tickSize = input.tickSize ?? null;
  const warnings: TradePreviewWarning[] = [
    {
      code: "balance_not_checked",
      message: "Conditional token (share) balance is not checked in this preview yet.",
      severity: "info"
    }
  ];

  if (input.negRisk) {
    warnings.push({
      code: "neg_risk_market",
      message: "This market uses negative-risk handling; execution must preserve Polymarket order rules.",
      severity: "info"
    });
  }

  if (minOrderSize !== null && input.amountShares < minOrderSize) {
    warnings.push({
      code: "amount_below_min_order_size",
      message: `Shares to sell are below the market minimum order size (${minOrderSize}).`,
      severity: "warning"
    });
  }

  if (!input.bids.length) {
    warnings.push({
      code: "no_orderbook",
      message: "No visible bids are available for this outcome right now.",
      severity: "warning"
    });

    return {
      filledAmountUsd: 0,
      unfilledAmountUsd: 0,
      estimatedShares: 0,
      avgPrice: null,
      maxPrice: null,
      bestAsk: null,
      minOrderSize,
      tickSize,
      warnings
    };
  }

  let remainingShares = input.amountShares;
  let filledAmountUsd = 0;
  let filledShares = 0;
  let worstPrice: number | null = null;

  // Sweep bids from highest to lowest
  for (const level of input.bids) {
    if (remainingShares <= 0) break;
    const sharesAtLevel = Math.min(remainingShares, level.size);
    const proceeds = sharesAtLevel * level.price;

    filledAmountUsd += proceeds;
    filledShares += sharesAtLevel;
    remainingShares -= sharesAtLevel;
    worstPrice = level.price;
  }

  if (remainingShares > 0.000001) {
    warnings.push({
      code: "insufficient_visible_liquidity",
      message: "Visible bid liquidity cannot fill the full sell amount at the current order book depth.",
      severity: "warning"
    });
  }

  return {
    filledAmountUsd: roundMoney(filledAmountUsd),
    unfilledAmountUsd: roundMoney(Math.max(0, remainingShares * (worstPrice ?? 0))),
    estimatedShares: roundShares(filledShares),
    avgPrice: filledShares > 0 ? roundPrice(filledAmountUsd / filledShares) : null,
    maxPrice: worstPrice === null ? null : roundPrice(worstPrice),
    bestAsk: roundPrice(input.bids[0].price), // best bid for sells
    minOrderSize,
    tickSize,
    warnings
  };
}

export function roundMoney(value: number): number {
  return Number(value.toFixed(6));
}

function roundShares(value: number): number {
  return Number(value.toFixed(4));
}

function roundPrice(value: number): number {
  return Number(value.toFixed(4));
}
