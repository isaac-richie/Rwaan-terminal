/**
 * Multi-Timeframe Technical Analysis Engine
 *
 * Fetches 4H / 1H / 15m candles from Binance, computes market structure,
 * key levels, regime, and a confluence-based conviction score.
 *
 * Used by the x402 premium analysis flow to give the AI real TA data
 * instead of relying on news-only reasoning for crypto markets.
 */

import { buildCacheKey, getJsonCache, setJsonCache } from "./cache.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type SwingPoint = {
  type: "high" | "low";
  price: number;
  index: number;
  time: number;
};

type KeyLevel = {
  price: number;
  type: "support" | "resistance" | "pivot";
  strength: number; // 1-5 based on touches
  tested: number;
  broken: boolean;
};

type MarketStructure = "uptrend" | "downtrend" | "range";

type Regime = "trending" | "ranging" | "volatile";

export type TechnicalAnalysis = {
  symbol: string;
  currentPrice: number;
  // Higher timeframe context
  htf: {
    structure: MarketStructure;
    trendStrength: number; // 0-100
    bias: string;
    swingHigh: number | null;
    swingLow: number | null;
  };
  // Key levels
  levels: KeyLevel[];
  nearestSupport: number | null;
  nearestResistance: number | null;
  // Indicators
  rsi14: number;
  vwapDistance: number; // % distance from VWAP
  volumeProfile: "increasing" | "decreasing" | "flat";
  volatilityPct: number; // ATR as % of price
  // Regime
  regime: Regime;
  // Conviction
  confluenceScore: number; // 0-100
  confluenceFactors: string[];
  // Pre-computed trade context
  riskReward: {
    longEntry: number;
    longStop: number;
    longTarget: number;
    longRR: number;
    shortEntry: number;
    shortStop: number;
    shortTarget: number;
    shortRR: number;
  } | null;
  // Summary for AI prompt injection
  summary: string;
};

// ─── Supported assets ────────────────────────────────────────────────────────

const BINANCE_SYMBOLS: Record<string, string> = {
  BTC: "BTCUSDT", ETH: "ETHUSDT", BNB: "BNBUSDT",
  SOL: "SOLUSDT", XRP: "XRPUSDT", DOGE: "DOGEUSDT",
  ADA: "ADAUSDT", AVAX: "AVAXUSDT", DOT: "DOTUSDT",
  MATIC: "MATICUSDT", LINK: "LINKUSDT", UNI: "UNIUSDT",
  NEAR: "NEARUSDT", ARB: "ARBUSDT", OP: "OPUSDT",
  SUI: "SUIUSDT", APT: "APTUSDT", SEI: "SEIUSDT",
};

// ─── Binance kline fetcher ───────────────────────────────────────────────────

type BinanceKline = [number, string, string, string, string, string, number, string, number, string, string, string];

async function fetchCandles(symbol: string, interval: string, limit: number): Promise<Candle[]> {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return [];
  const raw = (await res.json()) as BinanceKline[];
  return raw.map((r) => ({
    time: Math.floor(Number(r[0]) / 1000),
    open: Number(r[1]),
    high: Number(r[2]),
    low: Number(r[3]),
    close: Number(r[4]),
    volume: Number(r[5]),
  })).filter((c) => Number.isFinite(c.close) && Number.isFinite(c.high));
}

// ─── Swing point detection ───────────────────────────────────────────────────

function findSwingPoints(candles: Candle[], lookback: number = 5): SwingPoint[] {
  const points: SwingPoint[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = 1; j <= lookback; j++) {
      if (candles[i].high <= candles[i - j].high || candles[i].high <= candles[i + j].high) isHigh = false;
      if (candles[i].low >= candles[i - j].low || candles[i].low >= candles[i + j].low) isLow = false;
    }
    if (isHigh) points.push({ type: "high", price: candles[i].high, index: i, time: candles[i].time });
    if (isLow) points.push({ type: "low", price: candles[i].low, index: i, time: candles[i].time });
  }
  return points;
}

// ─── Market structure ────────────────────────────────────────────────────────

function analyzeStructure(swings: SwingPoint[]): { structure: MarketStructure; trendStrength: number } {
  const highs = swings.filter((s) => s.type === "high").slice(-4);
  const lows = swings.filter((s) => s.type === "low").slice(-4);

  if (highs.length < 2 || lows.length < 2) return { structure: "range", trendStrength: 30 };

  let hhCount = 0, hlCount = 0, lhCount = 0, llCount = 0;
  for (let i = 1; i < highs.length; i++) {
    if (highs[i].price > highs[i - 1].price) hhCount++;
    else lhCount++;
  }
  for (let i = 1; i < lows.length; i++) {
    if (lows[i].price > lows[i - 1].price) hlCount++;
    else llCount++;
  }

  const bullScore = hhCount + hlCount;
  const bearScore = lhCount + llCount;
  const total = bullScore + bearScore || 1;

  if (bullScore > bearScore && bullScore >= 2) {
    return { structure: "uptrend", trendStrength: Math.min(95, 50 + (bullScore / total) * 50) };
  }
  if (bearScore > bullScore && bearScore >= 2) {
    return { structure: "downtrend", trendStrength: Math.min(95, 50 + (bearScore / total) * 50) };
  }
  return { structure: "range", trendStrength: 25 + Math.abs(bullScore - bearScore) * 10 };
}

// ─── Key level clustering ────────────────────────────────────────────────────

function buildKeyLevels(swings: SwingPoint[], currentPrice: number, clusterPct: number = 0.003): KeyLevel[] {
  const rawPrices = swings.map((s) => s.price);
  const clusters: { price: number; count: number; types: Set<string> }[] = [];

  for (const price of rawPrices) {
    const existing = clusters.find((c) => Math.abs(c.price - price) / price < clusterPct);
    if (existing) {
      existing.count++;
      existing.price = (existing.price + price) / 2; // average
      const swing = swings.find((s) => s.price === price);
      if (swing) existing.types.add(swing.type);
    } else {
      const swing = swings.find((s) => s.price === price);
      clusters.push({ price, count: 1, types: new Set([swing?.type ?? "high"]) });
    }
  }

  return clusters
    .filter((c) => c.count >= 1)
    .map((c) => ({
      price: Math.round(c.price * 100) / 100,
      type: c.price < currentPrice ? "support" as const
        : c.price > currentPrice ? "resistance" as const
        : "pivot" as const,
      strength: Math.min(5, c.count),
      tested: c.count,
      broken: false,
    }))
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 12);
}

// ─── RSI calculation ─────────────────────────────────────────────────────────

function computeRSI(candles: Candle[], period: number = 14): number {
  if (candles.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = candles[candles.length - period - 1 + i].close - candles[candles.length - period - 1 + i - 1].close;
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return Math.round(100 - 100 / (1 + rs));
}

// ─── VWAP approximation (session) ────────────────────────────────────────────

function computeVWAP(candles: Candle[]): number {
  let cumTypicalVol = 0;
  let cumVol = 0;
  // Use last 24 candles as session proxy
  const session = candles.slice(-24);
  for (const c of session) {
    const typical = (c.high + c.low + c.close) / 3;
    cumTypicalVol += typical * c.volume;
    cumVol += c.volume;
  }
  return cumVol > 0 ? cumTypicalVol / cumVol : session[session.length - 1]?.close ?? 0;
}

// ─── ATR calculation ─────────────────────────────────────────────────────────

function computeATR(candles: Candle[], period: number = 14): number {
  if (candles.length < period + 1) return 0;
  let sum = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const prev = candles[i - 1];
    const cur = candles[i];
    const tr = Math.max(cur.high - cur.low, Math.abs(cur.high - prev.close), Math.abs(cur.low - prev.close));
    sum += tr;
  }
  return sum / period;
}

// ─── Volume profile ──────────────────────────────────────────────────────────

function analyzeVolumeProfile(candles: Candle[]): "increasing" | "decreasing" | "flat" {
  if (candles.length < 10) return "flat";
  const recent = candles.slice(-5).reduce((s, c) => s + c.volume, 0) / 5;
  const prior = candles.slice(-10, -5).reduce((s, c) => s + c.volume, 0) / 5;
  if (prior === 0) return "flat";
  const ratio = recent / prior;
  if (ratio > 1.3) return "increasing";
  if (ratio < 0.7) return "decreasing";
  return "flat";
}

// ─── Regime detection ────────────────────────────────────────────────────────

function detectRegime(candles: Candle[], atr: number, structure: MarketStructure): Regime {
  if (candles.length < 20) return "ranging";
  const price = candles[candles.length - 1].close;
  const atrPct = (atr / price) * 100;

  // High volatility
  if (atrPct > 3.5) return "volatile";

  // Use structure to determine trending vs ranging
  if (structure === "uptrend" || structure === "downtrend") return "trending";
  return "ranging";
}

// ─── Confluence scoring ──────────────────────────────────────────────────────

function scoreConfluence(
  htfStructure: MarketStructure,
  trendStrength: number,
  rsi: number,
  vwapDist: number,
  volProfile: "increasing" | "decreasing" | "flat",
  nearSupport: boolean,
  nearResistance: boolean,
  regime: Regime,
): { score: number; factors: string[] } {
  let score = 0;
  const factors: string[] = [];

  // HTF alignment (25%)
  if (htfStructure === "uptrend" && trendStrength > 60) {
    score += 25;
    factors.push(`4H uptrend (strength ${trendStrength})`);
  } else if (htfStructure === "downtrend" && trendStrength > 60) {
    score += 25;
    factors.push(`4H downtrend (strength ${trendStrength})`);
  } else if (trendStrength > 40) {
    score += 12;
    factors.push(`4H ${htfStructure} (moderate ${trendStrength})`);
  } else {
    score += 5;
    factors.push(`4H ranging — low directional conviction`);
  }

  // Key level proximity (20%)
  if (nearSupport) {
    score += 20;
    factors.push("Price near key support level");
  } else if (nearResistance) {
    score += 15;
    factors.push("Price near key resistance level");
  } else {
    score += 5;
    factors.push("Price in no-man's-land between levels");
  }

  // RSI context (15%)
  if (rsi <= 30) {
    score += 15;
    factors.push(`RSI oversold (${rsi})`);
  } else if (rsi >= 70) {
    score += 15;
    factors.push(`RSI overbought (${rsi})`);
  } else if (rsi >= 45 && rsi <= 55) {
    score += 5;
    factors.push(`RSI neutral (${rsi})`);
  } else {
    score += 10;
    factors.push(`RSI ${rsi > 55 ? "bullish" : "bearish"} (${rsi})`);
  }

  // Volume confirmation (15%)
  if (volProfile === "increasing") {
    score += 15;
    factors.push("Volume increasing — conviction building");
  } else if (volProfile === "flat") {
    score += 8;
    factors.push("Volume flat — waiting for catalyst");
  } else {
    score += 3;
    factors.push("Volume declining — momentum fading");
  }

  // VWAP proximity (10%)
  if (Math.abs(vwapDist) < 0.5) {
    score += 10;
    factors.push(`Price at VWAP (${vwapDist > 0 ? "+" : ""}${vwapDist.toFixed(2)}%)`);
  } else if (vwapDist > 0) {
    score += 7;
    factors.push(`Price above VWAP (+${vwapDist.toFixed(2)}%)`);
  } else {
    score += 7;
    factors.push(`Price below VWAP (${vwapDist.toFixed(2)}%)`);
  }

  // Regime filter (10%)
  if (regime === "trending") {
    score += 10;
    factors.push("Trending regime — setups higher probability");
  } else if (regime === "ranging") {
    score += 5;
    factors.push("Ranging regime — mean reversion more likely");
  } else {
    score += 3;
    factors.push("Volatile regime — elevated risk");
  }

  // Volume + structure alignment bonus (5%)
  if ((htfStructure === "uptrend" && volProfile === "increasing") || (htfStructure === "downtrend" && volProfile === "increasing")) {
    score += 5;
    factors.push("Volume confirms trend direction");
  }

  return { score: Math.min(100, score), factors };
}

// ─── Risk/reward pre-calc ────────────────────────────────────────────────────

function computeRiskReward(price: number, levels: KeyLevel[]) {
  const supports = levels.filter((l) => l.type === "support" && l.price < price).sort((a, b) => b.price - a.price);
  const resistances = levels.filter((l) => l.type === "resistance" && l.price > price).sort((a, b) => a.price - b.price);

  if (!supports.length || !resistances.length) return null;

  const nearestSup = supports[0].price;
  const nearestRes = resistances[0].price;
  const nextRes = resistances[1]?.price ?? nearestRes * 1.03;
  const nextSup = supports[1]?.price ?? nearestSup * 0.97;

  const longRisk = price - nearestSup;
  const longReward = nearestRes - price;
  const shortRisk = nearestRes - price;
  const shortReward = price - nearestSup;

  return {
    longEntry: price,
    longStop: nearestSup,
    longTarget: nearestRes,
    longRR: longRisk > 0 ? Math.round((longReward / longRisk) * 10) / 10 : 0,
    shortEntry: price,
    shortStop: nearestRes,
    shortTarget: nearestSup,
    shortRR: shortRisk > 0 ? Math.round((shortReward / shortRisk) * 10) / 10 : 0,
  };
}

// ─── Summary builder ─────────────────────────────────────────────────────────

function buildSummary(ta: Omit<TechnicalAnalysis, "summary">): string {
  const { htf, rsi14, vwapDistance, volumeProfile, regime, confluenceScore, confluenceFactors, levels, nearestSupport, nearestResistance, riskReward, currentPrice, volatilityPct } = ta;

  const lines: string[] = [
    `TECHNICAL ANALYSIS — ${ta.symbol} @ $${currentPrice.toLocaleString("en-US", { maximumFractionDigits: 2 })}`,
    ``,
    `STRUCTURE:`,
    `  4H: ${htf.structure.toUpperCase()} (strength ${htf.trendStrength}/100)`,
    `  Bias: ${htf.bias}`,
    ...(htf.swingHigh ? [`  4H Swing High: $${htf.swingHigh.toLocaleString("en-US", { maximumFractionDigits: 2 })}`] : []),
    ...(htf.swingLow ? [`  4H Swing Low: $${htf.swingLow.toLocaleString("en-US", { maximumFractionDigits: 2 })}`] : []),
    `  Regime: ${regime}`,
    ``,
    `INDICATORS:`,
    `  RSI(14): ${rsi14}`,
    `  VWAP distance: ${vwapDistance > 0 ? "+" : ""}${vwapDistance.toFixed(2)}%`,
    `  Volume: ${volumeProfile}`,
    `  Volatility (ATR%): ${volatilityPct.toFixed(2)}%`,
    ``,
    `KEY LEVELS:`,
  ];

  const topLevels = levels.slice(0, 8);
  for (const level of topLevels) {
    const dist = ((level.price - currentPrice) / currentPrice * 100).toFixed(2);
    lines.push(`  $${level.price.toLocaleString("en-US", { maximumFractionDigits: 2 })} — ${level.type} (${level.tested}x tested, ${dist}%)`);
  }

  if (nearestSupport) lines.push(`  Nearest support: $${nearestSupport.toLocaleString("en-US", { maximumFractionDigits: 2 })}`);
  if (nearestResistance) lines.push(`  Nearest resistance: $${nearestResistance.toLocaleString("en-US", { maximumFractionDigits: 2 })}`);

  lines.push(``, `CONFLUENCE SCORE: ${confluenceScore}/100`);
  for (const f of confluenceFactors) lines.push(`  ✓ ${f}`);

  if (riskReward) {
    lines.push(``, `RISK/REWARD:`);
    lines.push(`  Long: entry $${riskReward.longEntry.toFixed(2)}, stop $${riskReward.longStop.toFixed(2)}, target $${riskReward.longTarget.toFixed(2)} — R:R ${riskReward.longRR}:1`);
    lines.push(`  Short: entry $${riskReward.shortEntry.toFixed(2)}, stop $${riskReward.shortStop.toFixed(2)}, target $${riskReward.shortTarget.toFixed(2)} — R:R ${riskReward.shortRR}:1`);
  }

  return lines.filter(Boolean).join("\n");
}

// ─── Main entry point ────────────────────────────────────────────────────────

export function detectCryptoSymbol(text: string): string | null {
  const haystack = text.toLowerCase();
  const patterns: Array<[string, (string | RegExp)[]]> = [
    ["BTC", ["bitcoin", /\bbtc\b/]],
    ["ETH", ["ethereum", "ether", /\beth\b/]],
    ["BNB", [/\bbnb\b/, "binance coin"]],
    ["SOL", ["solana", /\bsol\b/]],
    ["XRP", [/\bxrp\b/, "ripple"]],
    ["DOGE", ["dogecoin", /\bdoge\b/]],
    ["ADA", ["cardano", /\bada\b/]],
    ["AVAX", ["avalanche", /\bavax\b/]],
    ["DOT", ["polkadot", /\bdot\b/]],
    ["MATIC", ["polygon", /\bmatic\b/]],
    ["LINK", ["chainlink", /\blink\b/]],
    ["UNI", ["uniswap", /\buni\b/]],
    ["NEAR", [/\bnear\b/]],
    ["ARB", ["arbitrum", /\barb\b/]],
    ["OP", ["optimism"]],
    ["SUI", [/\bsui\b/]],
    ["APT", ["aptos", /\bapt\b/]],
    ["SEI", [/\bsei\b/]],
  ];
  for (const [sym, needles] of patterns) {
    if (needles.some((n) => typeof n === "string" ? haystack.includes(n) : n.test(haystack))) {
      return sym;
    }
  }
  return null;
}

export async function runTechnicalAnalysis(asset: string): Promise<TechnicalAnalysis | null> {
  const binanceSymbol = BINANCE_SYMBOLS[asset.toUpperCase()];
  if (!binanceSymbol) return null;

  // Check cache (5 minute TTL — structural data doesn't change per tick)
  const cacheKey = buildCacheKey("ta:analysis", { asset: asset.toUpperCase() });
  const cached = await getJsonCache(cacheKey);
  if (cached) return cached as TechnicalAnalysis;

  try {
    // Fetch multi-timeframe candles in parallel
    const [candles4h, candles1h, candles15m] = await Promise.all([
      fetchCandles(binanceSymbol, "4h", 100),  // ~16 days
      fetchCandles(binanceSymbol, "1h", 200),  // ~8 days
      fetchCandles(binanceSymbol, "15m", 96),  // ~24 hours
    ]);

    if (!candles4h.length || !candles1h.length) return null;

    const price = (candles15m.length ? candles15m[candles15m.length - 1] : candles1h[candles1h.length - 1]).close;

    // HTF structure from 4H
    const htfSwings = findSwingPoints(candles4h, 3);
    const { structure, trendStrength } = analyzeStructure(htfSwings);

    const recentHighs = htfSwings.filter((s) => s.type === "high").slice(-3);
    const recentLows = htfSwings.filter((s) => s.type === "low").slice(-3);
    const swingHigh = recentHighs.length ? Math.max(...recentHighs.map((s) => s.price)) : null;
    const swingLow = recentLows.length ? Math.min(...recentLows.map((s) => s.price)) : null;

    const bias = structure === "uptrend"
      ? `Bullish — higher highs and higher lows on 4H. Pullbacks toward ${swingLow ? `$${swingLow.toFixed(2)}` : "swing low"} are buy zones.`
      : structure === "downtrend"
        ? `Bearish — lower highs and lower lows on 4H. Rallies toward ${swingHigh ? `$${swingHigh.toFixed(2)}` : "swing high"} are sell zones.`
        : `Neutral — 4H is ranging. Trade the boundaries or wait for a breakout.`;

    // Key levels from combined 4H + 1H swings
    const oneHSwings = findSwingPoints(candles1h, 4);
    const allSwings = [...htfSwings, ...oneHSwings];
    const levels = buildKeyLevels(allSwings, price);

    const supports = levels.filter((l) => l.type === "support").sort((a, b) => b.price - a.price);
    const resistances = levels.filter((l) => l.type === "resistance").sort((a, b) => a.price - b.price);
    const nearestSupport = supports[0]?.price ?? null;
    const nearestResistance = resistances[0]?.price ?? null;

    // Indicators from 1H
    const rsi14 = computeRSI(candles1h, 14);
    const vwap = computeVWAP(candles1h);
    const vwapDistance = vwap > 0 ? ((price - vwap) / vwap) * 100 : 0;
    const atr = computeATR(candles1h, 14);
    const volatilityPct = price > 0 ? (atr / price) * 100 : 0;
    const volumeProfile = analyzeVolumeProfile(candles1h);

    // Regime
    const regime = detectRegime(candles1h, atr, structure);

    // Confluence
    const nearSup = nearestSupport ? Math.abs((price - nearestSupport) / price) < 0.015 : false;
    const nearRes = nearestResistance ? Math.abs((price - nearestResistance) / price) < 0.015 : false;
    const { score, factors } = scoreConfluence(structure, trendStrength, rsi14, vwapDistance, volumeProfile, nearSup, nearRes, regime);

    // Risk/reward
    const riskReward = computeRiskReward(price, levels);

    const ta: Omit<TechnicalAnalysis, "summary"> = {
      symbol: `${asset.toUpperCase()}USDT`,
      currentPrice: price,
      htf: { structure, trendStrength: Math.round(trendStrength), bias, swingHigh, swingLow },
      levels,
      nearestSupport,
      nearestResistance,
      rsi14,
      vwapDistance: Math.round(vwapDistance * 100) / 100,
      volumeProfile,
      volatilityPct: Math.round(volatilityPct * 100) / 100,
      regime,
      confluenceScore: Math.round(score),
      confluenceFactors: factors,
      riskReward,
    };

    const result: TechnicalAnalysis = { ...ta, summary: buildSummary(ta) };

    // Cache for 5 minutes
    await setJsonCache(cacheKey, result, 300);

    return result;
  } catch (err) {
    console.error("[ta-engine] Analysis failed:", err);
    return null;
  }
}
