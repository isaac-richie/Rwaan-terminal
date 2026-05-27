/**
 * Multi-Timeframe Technical Analysis Engine v2
 *
 * Fetches 4H / 1H / 15m candles from Binance spot + futures data,
 * computes market structure, key levels, full indicator suite, and
 * a confluence-based conviction score.
 *
 * Indicators: EMA ribbon (9/21/50/200), MACD + histogram, Bollinger Bands,
 * RSI + divergence detection, Fibonacci retracements, OBV, VWAP, ATR,
 * funding rates, open interest sentiment, Fear & Greed index.
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

type Divergence = {
  type: "bullish" | "bearish";
  description: string;
};

type EMASet = {
  ema9: number;
  ema21: number;
  ema50: number;
  ema200: number;
  ribbonState: "bullish_stack" | "bearish_stack" | "mixed" | "compressed";
  priceVsEma200: "above" | "below" | "at";
};

type MACDResult = {
  macdLine: number;
  signalLine: number;
  histogram: number;
  trend: "bullish" | "bearish" | "neutral";
  crossover: "bullish_cross" | "bearish_cross" | "none";
  histogramDirection: "expanding" | "contracting";
};

type BollingerResult = {
  upper: number;
  middle: number;
  lower: number;
  bandwidth: number;
  percentB: number;
  squeeze: boolean;
  priceZone: "above_upper" | "upper_half" | "lower_half" | "below_lower";
};

type FibLevel = {
  level: string;
  price: number;
  distance: number; // % from current price
};

type FundingData = {
  rate: number;
  annualized: number;
  sentiment: "long_heavy" | "short_heavy" | "neutral";
};

type FearGreedData = {
  value: number;
  classification: string;
};

export type OpenInterestData = {
  current: number;           // current OI in USD
  change24h: number;         // % change over 24h
  trend: "rising" | "falling" | "flat";
  signal: "bullish" | "bearish" | "neutral"; // OI + price direction combo
  interpretation: string;
};

export type LongShortData = {
  globalLongPct: number;     // % of accounts long (0-100)
  globalShortPct: number;
  topTraderLongPct: number;  // top traders (smart money) long %
  topTraderShortPct: number;
  retailBias: "long_heavy" | "short_heavy" | "balanced";
  smartMoneyBias: "long_heavy" | "short_heavy" | "balanced";
  contrarian: "bullish" | "bearish" | "neutral"; // when retail is crowded = fade them
  interpretation: string;
};

export type TakerRatioData = {
  buyRatio: number;          // taker buy volume / total volume (0-1)
  sellRatio: number;
  trend: "buyers_dominant" | "sellers_dominant" | "balanced";
  strength: "strong" | "moderate" | "weak";
  interpretation: string;
};

export type SignalVote = {
  name: string;
  direction: "bullish" | "bearish" | "neutral";
  weight: number;       // how much this signal matters (0-1)
  conviction: number;   // how strong the signal is (0-1)
  reason: string;
};

export type ComputedVerdict = {
  direction: "YES" | "NO";
  confidence: number;           // 0-100
  bullishScore: number;         // raw bullish points
  bearishScore: number;         // raw bearish points
  netScore: number;             // bullish - bearish (-100 to +100)
  signalAgreement: number;      // % of signals agreeing with verdict (0-100)
  totalSignals: number;
  agreeingSignals: number;
  votes: SignalVote[];
  regimeAdjustment: number;     // confidence modifier from regime
  contrariansFlags: string[];   // signals that disagree with majority
  verdictRationale: string;     // human-readable reasoning chain
};

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
  fibLevels: FibLevel[];
  // EMAs
  ema: EMASet;
  // MACD
  macd: MACDResult;
  // Bollinger Bands
  bollinger: BollingerResult;
  // RSI + divergence
  rsi14: number;
  rsiDivergence: Divergence | null;
  multiTfRsi: { tf4h: number; tf1h: number; tf15m: number; alignment: "all_bullish" | "all_bearish" | "mixed" };
  // Volume
  obv: { trend: "rising" | "falling" | "flat"; divergence: Divergence | null };
  volumeProfile: "increasing" | "decreasing" | "flat";
  // VWAP + ATR
  vwapDistance: number;
  volatilityPct: number;
  // External data
  funding: FundingData | null;
  fearGreed: FearGreedData | null;
  openInterest: OpenInterestData | null;
  longShort: LongShortData | null;
  takerRatio: TakerRatioData | null;
  // Regime
  regime: Regime;
  // Conviction
  confluenceScore: number; // 0-100
  confluenceFactors: string[];
  // Deterministic verdict — computed from math, not AI
  verdict: ComputedVerdict;
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

// ─── Supported assets (top 100 by Binance liquidity) ─────────────────────────
// Every asset here has a USDT spot pair + Binance Futures perpetual contract.
// detectCryptoSymbol also has a dynamic fallback that validates any uppercase
// ticker directly against Binance, so unlisted assets auto-resolve too.

const BINANCE_SYMBOLS: Record<string, string> = {
  // Tier 1 — mega cap
  BTC: "BTCUSDT", ETH: "ETHUSDT", BNB: "BNBUSDT", SOL: "SOLUSDT",
  XRP: "XRPUSDT", DOGE: "DOGEUSDT", ADA: "ADAUSDT", TRX: "TRXUSDT",
  TON: "TONUSDT", AVAX: "AVAXUSDT",

  // Tier 2 — large cap
  LINK: "LINKUSDT", DOT: "DOTUSDT", MATIC: "MATICUSDT", SHIB: "SHIBUSDT",
  LTC: "LTCUSDT", BCH: "BCHUSDT", UNI: "UNIUSDT", NEAR: "NEARUSDT",
  ICP: "ICPUSDT", APT: "APTUSDT", SUI: "SUIUSDT", ATOM: "ATOMUSDT",
  XLM: "XLMUSDT", HBAR: "HBARUSDT", ARB: "ARBUSDT", OP: "OPUSDT",
  VET: "VETUSDT", FIL: "FILUSDT", ALGO: "ALGOUSDT", AAVE: "AAVEUSDT",

  // Tier 3 — mid cap
  INJ: "INJUSDT", TIA: "TIAUSDT", SEI: "SEIUSDT", FET: "FETUSDT",
  RENDER: "RENDERUSDT", PEPE: "PEPEUSDT", WIF: "WIFUSDT", BONK: "BONKUSDT",
  JUP: "JUPUSDT", W: "WUSDT", PYTH: "PYTHUSDT", JTO: "JTOUSDT",
  BLUR: "BLURUSDT", IMX: "IMXUSDT", SAND: "SANDUSDT", MANA: "MANAUSDT",
  AXS: "AXSUSDT", GALA: "GALAUSDT", ENS: "ENSUSDT", LDO: "LDOUSDT",
  RUNE: "RUNEUSDT", THETA: "THETAUSDT", EGLD: "EGLDUSDT", FTM: "FTMUSDT",
  CAKE: "CAKEUSDT", GMT: "GMTUSDT", GRT: "GRTUSDT", STX: "STXUSDT",
  FLOW: "FLOWUSDT", ROSE: "ROSEUSDT", ZIL: "ZILUSDT", CHZ: "CHZUSDT",

  // Tier 4 — trending / Polymarket-relevant
  NOT: "NOTUSDT", EIGEN: "EIGENUSDT", STRK: "STRKUSDT", MANTA: "MANTAUSDT",
  ALT: "ALTUSDT", PIXEL: "PIXELUSDT", PORTAL: "PORTALUSDT", DYM: "DYMUSDT",
  ZETA: "ZETAUSDT", ETHFI: "ETHFIUSDT", REZ: "REZUSDT", BB: "BBUSDT",
  IO: "IOUSDT", ZK: "ZKUSDT", LISTA: "LISTAUSDT", ZRO: "ZROUSDT",
  DOGS: "DOGSUSDT", CATI: "CATIUSDT", HMSTR: "HMSTRUSDT", MAJOR: "MAJORUSDT",
  TAO: "TAOUSDT", WLD: "WLDUSDT", PNUT: "PNUTUSDT", ACT: "ACTUSDT",
  TURBO: "TURBOUSDT", MOODENG: "MOODENGUSDT", NEIRO: "NEIROUSDT",
  PENGU: "PENGUUSDT", TRUMP: "TRUMPUSDT", MELANIA: "MELANIAUSDT",
  KAITO: "KAITOUSDT", IP: "IPUSDT", VINE: "VINEUSDT", TST: "TSTUSDT",

  // Alt tickers / legacy names
  POL: "POLUSDT",   // Polygon's rebranded ticker
  RNDR: "RENDERUSDT",
};

// ─── Dynamic Binance symbol validator ────────────────────────────────────────
// Caches the full list of valid Binance USDT spot symbols so we can validate
// any ticker without a hardcoded map entry.

let binanceSymbolCache: Set<string> | null = null;
let binanceSymbolCacheTime = 0;
const BINANCE_SYMBOL_CACHE_TTL = 3_600_000; // 1 hour

async function getBinanceSymbols(): Promise<Set<string>> {
  const now = Date.now();
  if (binanceSymbolCache && now - binanceSymbolCacheTime < BINANCE_SYMBOL_CACHE_TTL) {
    return binanceSymbolCache;
  }
  try {
    const res = await fetch(
      "https://api.binance.com/api/v3/exchangeInfo?permissions=SPOT",
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return binanceSymbolCache ?? new Set();
    const data = await res.json() as { symbols: Array<{ symbol: string; status: string }> };
    const symbols = new Set(
      data.symbols
        .filter((s) => s.status === "TRADING" && s.symbol.endsWith("USDT"))
        .map((s) => s.symbol)
    );
    binanceSymbolCache = symbols;
    binanceSymbolCacheTime = now;
    return symbols;
  } catch {
    return binanceSymbolCache ?? new Set();
  }
}

// ─── Binance kline fetcher ───────────────────────────────────────────────────

type BinanceKline = [number, string, string, string, string, string, number, string, number, string, string, string];

async function fetchCandles(symbol: string, interval: string, limit: number): Promise<Candle[]> {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
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

// ─── Funding rate from Binance Futures ──────────────────────────────────────

async function fetchFundingRate(symbol: string): Promise<FundingData | null> {
  try {
    const url = `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}&limit=1`;
    const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = await res.json() as Array<{ fundingRate: string }>;
    if (!data.length) return null;
    const rate = Number(data[0].fundingRate);
    const annualized = rate * 3 * 365 * 100; // 3 funding periods per day
    return {
      rate,
      annualized: Math.round(annualized * 100) / 100,
      sentiment: rate > 0.0005 ? "long_heavy" : rate < -0.0005 ? "short_heavy" : "neutral",
    };
  } catch {
    return null;
  }
}

// ─── Fear & Greed Index ─────────────────────────────────────────────────────

async function fetchFearGreed(): Promise<FearGreedData | null> {
  try {
    const res = await fetch("https://api.alternative.me/fng/?limit=1", {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { data: Array<{ value: string; value_classification: string }> };
    if (!data.data?.length) return null;
    return {
      value: Number(data.data[0].value),
      classification: data.data[0].value_classification,
    };
  } catch {
    return null;
  }
}

// ─── Open Interest from Binance Futures ──────────────────────────────────────

async function fetchOpenInterest(symbol: string, currentPrice: number): Promise<OpenInterestData | null> {
  try {
    // Current OI
    const [curRes, histRes] = await Promise.all([
      fetch(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`, {
        signal: AbortSignal.timeout(5000),
      }),
      // 24h OI history at 1h intervals — last 25 candles gives us 24h change
      fetch(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${symbol}&period=1h&limit=25`, {
        signal: AbortSignal.timeout(5000),
      }),
    ]);

    if (!curRes.ok) return null;
    const curData = await curRes.json() as { openInterest: string };
    const currentOI = Number(curData.openInterest) * currentPrice; // convert to USD

    let change24h = 0;
    if (histRes.ok) {
      const histData = await histRes.json() as Array<{ sumOpenInterest: string }>;
      if (histData.length >= 2) {
        const oldest = Number(histData[0].sumOpenInterest) * currentPrice;
        const newest = Number(histData[histData.length - 1].sumOpenInterest) * currentPrice;
        change24h = oldest > 0 ? ((newest - oldest) / oldest) * 100 : 0;
      }
    }

    const trend = change24h > 2 ? "rising" as const : change24h < -2 ? "falling" as const : "flat" as const;

    // OI + price direction combo signal
    // Rising OI + rising price = longs adding = bullish
    // Rising OI + falling price = shorts adding = bearish
    // Falling OI = deleveraging (squeeze or capitulation) = neutral/warning
    let signal: OpenInterestData["signal"];
    let interpretation: string;

    if (trend === "rising" && change24h > 3) {
      signal = "bullish"; // assume with price context — will be refined in verdict engine
      interpretation = `OI up ${change24h.toFixed(1)}% in 24h — new money entering, positioning building`;
    } else if (trend === "falling" && change24h < -3) {
      signal = "neutral";
      interpretation = `OI down ${Math.abs(change24h).toFixed(1)}% in 24h — deleveraging/liquidations, market resetting`;
    } else {
      signal = "neutral";
      interpretation = `OI relatively stable (${change24h > 0 ? "+" : ""}${change24h.toFixed(1)}%) — no significant positioning shift`;
    }

    return {
      current: Math.round(currentOI),
      change24h: Math.round(change24h * 100) / 100,
      trend,
      signal,
      interpretation,
    };
  } catch {
    return null;
  }
}

// ─── Long/Short Ratio from Binance Futures ────────────────────────────────────

async function fetchLongShortRatio(symbol: string): Promise<LongShortData | null> {
  try {
    const [globalRes, topRes] = await Promise.all([
      fetch(`https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=1h&limit=1`, {
        signal: AbortSignal.timeout(5000),
      }),
      fetch(`https://fapi.binance.com/futures/data/topLongShortAccountRatio?symbol=${symbol}&period=1h&limit=1`, {
        signal: AbortSignal.timeout(5000),
      }),
    ]);

    if (!globalRes.ok) return null;
    const globalData = await globalRes.json() as Array<{ longAccount: string; shortAccount: string }>;
    if (!globalData.length) return null;

    const globalLongPct = Number(globalData[0].longAccount) * 100;
    const globalShortPct = Number(globalData[0].shortAccount) * 100;

    let topTraderLongPct = 50;
    let topTraderShortPct = 50;
    if (topRes.ok) {
      const topData = await topRes.json() as Array<{ longAccount: string; shortAccount: string }>;
      if (topData.length) {
        topTraderLongPct = Number(topData[0].longAccount) * 100;
        topTraderShortPct = Number(topData[0].shortAccount) * 100;
      }
    }

    const retailBias: LongShortData["retailBias"] =
      globalLongPct > 60 ? "long_heavy" : globalLongPct < 40 ? "short_heavy" : "balanced";
    const smartMoneyBias: LongShortData["smartMoneyBias"] =
      topTraderLongPct > 60 ? "long_heavy" : topTraderLongPct < 40 ? "short_heavy" : "balanced";

    // Contrarian read on retail: when retail crowds one side, fade them
    // Also factor in smart money: if smart money disagrees with retail = stronger contrarian signal
    let contrarian: LongShortData["contrarian"];
    let interpretation: string;

    if (retailBias === "long_heavy" && smartMoneyBias === "short_heavy") {
      contrarian = "bearish";
      interpretation = `Retail ${globalLongPct.toFixed(0)}% long, smart money ${topTraderLongPct.toFixed(0)}% long — classic divergence, fade retail longs`;
    } else if (retailBias === "short_heavy" && smartMoneyBias === "long_heavy") {
      contrarian = "bullish";
      interpretation = `Retail ${globalLongPct.toFixed(0)}% long (crowded short), smart money ${topTraderLongPct.toFixed(0)}% long — short squeeze setup`;
    } else if (retailBias === "long_heavy") {
      contrarian = "bearish";
      interpretation = `Retail crowded long (${globalLongPct.toFixed(0)}%) — crowded positioning, pullback risk`;
    } else if (retailBias === "short_heavy") {
      contrarian = "bullish";
      interpretation = `Retail crowded short (${globalShortPct.toFixed(0)}%) — short squeeze potential`;
    } else {
      contrarian = "neutral";
      interpretation = `Balanced positioning — retail ${globalLongPct.toFixed(0)}% long, no extreme crowding`;
    }

    return {
      globalLongPct: Math.round(globalLongPct * 10) / 10,
      globalShortPct: Math.round(globalShortPct * 10) / 10,
      topTraderLongPct: Math.round(topTraderLongPct * 10) / 10,
      topTraderShortPct: Math.round(topTraderShortPct * 10) / 10,
      retailBias,
      smartMoneyBias,
      contrarian,
      interpretation,
    };
  } catch {
    return null;
  }
}

// ─── Taker Buy/Sell Ratio from Binance Futures ────────────────────────────────

async function fetchTakerRatio(symbol: string): Promise<TakerRatioData | null> {
  try {
    // Get last 4 hours of taker ratio data (4 × 1h periods)
    const res = await fetch(
      `https://fapi.binance.com/futures/data/takerlongshortRatio?symbol=${symbol}&period=1h&limit=4`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return null;
    const data = await res.json() as Array<{ buySellRatio: string; buyVol: string; sellVol: string }>;
    if (!data.length) return null;

    // Average the buy ratio over last 4 periods for a smoother signal
    const avgBuyRatio = data.reduce((s, d) => {
      const buy = Number(d.buyVol);
      const sell = Number(d.sellVol);
      return s + (buy / (buy + sell || 1));
    }, 0) / data.length;

    const sellRatio = 1 - avgBuyRatio;

    let trend: TakerRatioData["trend"];
    let strength: TakerRatioData["strength"];
    let interpretation: string;

    if (avgBuyRatio >= 0.58) {
      trend = "buyers_dominant";
      strength = avgBuyRatio >= 0.65 ? "strong" : "moderate";
      interpretation = `Taker buy ratio ${(avgBuyRatio * 100).toFixed(1)}% — aggressive buyers dominating, ${strength} bullish pressure`;
    } else if (avgBuyRatio <= 0.42) {
      trend = "sellers_dominant";
      strength = avgBuyRatio <= 0.35 ? "strong" : "moderate";
      interpretation = `Taker sell ratio ${(sellRatio * 100).toFixed(1)}% — aggressive sellers dominating, ${strength} bearish pressure`;
    } else {
      trend = "balanced";
      strength = "weak";
      interpretation = `Taker ratio balanced (buy ${(avgBuyRatio * 100).toFixed(1)}%) — no aggressive directional pressure`;
    }

    return {
      buyRatio: Math.round(avgBuyRatio * 1000) / 1000,
      sellRatio: Math.round(sellRatio * 1000) / 1000,
      trend,
      strength,
      interpretation,
    };
  } catch {
    return null;
  }
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
      existing.price = (existing.price + price) / 2;
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

// ─── EMA calculation ────────────────────────────────────────────────────────

function computeEMA(candles: Candle[], period: number): number[] {
  if (candles.length < period) return [];
  const k = 2 / (period + 1);
  const emaValues: number[] = [];
  // Seed with SMA
  let sum = 0;
  for (let i = 0; i < period; i++) sum += candles[i].close;
  emaValues.push(sum / period);
  for (let i = period; i < candles.length; i++) {
    emaValues.push(candles[i].close * k + emaValues[emaValues.length - 1] * (1 - k));
  }
  return emaValues;
}

function computeEMARibbon(candles: Candle[]): EMASet {
  const ema9arr = computeEMA(candles, 9);
  const ema21arr = computeEMA(candles, 21);
  const ema50arr = computeEMA(candles, 50);
  const ema200arr = computeEMA(candles, 200);

  const ema9 = ema9arr.length ? ema9arr[ema9arr.length - 1] : 0;
  const ema21 = ema21arr.length ? ema21arr[ema21arr.length - 1] : 0;
  const ema50 = ema50arr.length ? ema50arr[ema50arr.length - 1] : 0;
  const ema200 = ema200arr.length ? ema200arr[ema200arr.length - 1] : 0;

  const price = candles[candles.length - 1].close;

  // Determine ribbon state
  let ribbonState: EMASet["ribbonState"];
  if (ema9 > ema21 && ema21 > ema50 && ema50 > ema200) {
    ribbonState = "bullish_stack";
  } else if (ema9 < ema21 && ema21 < ema50 && ema50 < ema200) {
    ribbonState = "bearish_stack";
  } else {
    // Check compression
    const spread = Math.abs(ema9 - ema50) / price * 100;
    ribbonState = spread < 0.5 ? "compressed" : "mixed";
  }

  const dist200 = ema200 > 0 ? ((price - ema200) / ema200) * 100 : 0;
  const priceVsEma200: EMASet["priceVsEma200"] = dist200 > 0.3 ? "above" : dist200 < -0.3 ? "below" : "at";

  return { ema9, ema21, ema50, ema200, ribbonState, priceVsEma200 };
}

// ─── MACD ───────────────────────────────────────────────────────────────────

function computeMACD(candles: Candle[]): MACDResult {
  const ema12 = computeEMA(candles, 12);
  const ema26 = computeEMA(candles, 26);

  if (!ema12.length || !ema26.length) {
    return { macdLine: 0, signalLine: 0, histogram: 0, trend: "neutral", crossover: "none", histogramDirection: "contracting" };
  }

  // MACD line = EMA12 - EMA26 (aligned from the back)
  const offset = ema12.length - ema26.length;
  const macdValues: number[] = [];
  for (let i = 0; i < ema26.length; i++) {
    macdValues.push(ema12[i + offset] - ema26[i]);
  }

  // Signal line = 9-period EMA of MACD
  const signalK = 2 / 10;
  const signalValues: number[] = [];
  if (macdValues.length >= 9) {
    let seedSum = 0;
    for (let i = 0; i < 9; i++) seedSum += macdValues[i];
    signalValues.push(seedSum / 9);
    for (let i = 9; i < macdValues.length; i++) {
      signalValues.push(macdValues[i] * signalK + signalValues[signalValues.length - 1] * (1 - signalK));
    }
  }

  const macdLine = macdValues[macdValues.length - 1] ?? 0;
  const signalLine = signalValues[signalValues.length - 1] ?? 0;
  const histogram = macdLine - signalLine;
  const prevHistogram = macdValues.length >= 2 && signalValues.length >= 2
    ? macdValues[macdValues.length - 2] - signalValues[signalValues.length - 2]
    : 0;

  // Crossover detection (last 2 bars)
  let crossover: MACDResult["crossover"] = "none";
  if (macdValues.length >= 2 && signalValues.length >= 2) {
    const prevMacd = macdValues[macdValues.length - 2];
    const prevSignal = signalValues[signalValues.length - 2];
    if (prevMacd <= prevSignal && macdLine > signalLine) crossover = "bullish_cross";
    if (prevMacd >= prevSignal && macdLine < signalLine) crossover = "bearish_cross";
  }

  return {
    macdLine: Math.round(macdLine * 10000) / 10000,
    signalLine: Math.round(signalLine * 10000) / 10000,
    histogram: Math.round(histogram * 10000) / 10000,
    trend: macdLine > 0 ? "bullish" : macdLine < 0 ? "bearish" : "neutral",
    crossover,
    histogramDirection: Math.abs(histogram) > Math.abs(prevHistogram) ? "expanding" : "contracting",
  };
}

// ─── Bollinger Bands ────────────────────────────────────────────────────────

function computeBollinger(candles: Candle[], period: number = 20, stdDevMult: number = 2): BollingerResult {
  const price = candles[candles.length - 1]?.close ?? 0;
  if (candles.length < period) {
    return { upper: price, middle: price, lower: price, bandwidth: 0, percentB: 50, squeeze: false, priceZone: "upper_half" };
  }

  const slice = candles.slice(-period);
  const closes = slice.map((c) => c.close);
  const sma = closes.reduce((s, v) => s + v, 0) / period;
  const variance = closes.reduce((s, v) => s + Math.pow(v - sma, 2), 0) / period;
  const stdDev = Math.sqrt(variance);

  const upper = sma + stdDevMult * stdDev;
  const lower = sma - stdDevMult * stdDev;
  const bandwidth = sma > 0 ? ((upper - lower) / sma) * 100 : 0;
  const percentB = (upper - lower) > 0 ? ((price - lower) / (upper - lower)) * 100 : 50;

  // Squeeze detection: compare current bandwidth to average bandwidth over last 120 candles
  let squeeze = false;
  if (candles.length >= 120) {
    const bwValues: number[] = [];
    for (let i = period; i <= candles.length; i++) {
      const s = candles.slice(i - period, i);
      const m = s.reduce((sum, c) => sum + c.close, 0) / period;
      const v = s.reduce((sum, c) => sum + Math.pow(c.close - m, 2), 0) / period;
      const sd = Math.sqrt(v);
      bwValues.push(m > 0 ? ((2 * stdDevMult * sd) / m) * 100 : 0);
    }
    const avgBw = bwValues.reduce((s, v) => s + v, 0) / bwValues.length;
    squeeze = bandwidth < avgBw * 0.6;
  }

  let priceZone: BollingerResult["priceZone"];
  if (price > upper) priceZone = "above_upper";
  else if (price > sma) priceZone = "upper_half";
  else if (price > lower) priceZone = "lower_half";
  else priceZone = "below_lower";

  return {
    upper: Math.round(upper * 100) / 100,
    middle: Math.round(sma * 100) / 100,
    lower: Math.round(lower * 100) / 100,
    bandwidth: Math.round(bandwidth * 100) / 100,
    percentB: Math.round(percentB * 100) / 100,
    squeeze,
    priceZone,
  };
}

// ─── RSI calculation (returns full series for divergence detection) ──────────

function computeRSISeries(candles: Candle[], period: number = 14): number[] {
  if (candles.length < period + 1) return [50];
  const rsiValues: number[] = [];

  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  rsiValues.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));

  for (let i = period + 1; i < candles.length; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    rsiValues.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }

  return rsiValues;
}

function computeRSI(candles: Candle[], period: number = 14): number {
  const series = computeRSISeries(candles, period);
  return Math.round(series[series.length - 1]);
}

// ─── RSI Divergence Detection ───────────────────────────────────────────────

function detectRSIDivergence(candles: Candle[], rsiSeries: number[], lookback: number = 30): Divergence | null {
  if (candles.length < lookback || rsiSeries.length < lookback) return null;

  // Align RSI series with candle indices
  const rsiOffset = candles.length - rsiSeries.length;
  const recentCandles = candles.slice(-lookback);
  const recentRsi = rsiSeries.slice(-lookback);

  // Find price swing lows and RSI swing lows (for bullish divergence)
  const priceLows: Array<{ idx: number; price: number; rsi: number }> = [];
  const priceHighs: Array<{ idx: number; price: number; rsi: number }> = [];

  for (let i = 2; i < recentCandles.length - 2; i++) {
    const c = recentCandles[i];
    if (c.low < recentCandles[i - 1].low && c.low < recentCandles[i - 2].low &&
        c.low < recentCandles[i + 1].low && c.low < recentCandles[i + 2].low) {
      priceLows.push({ idx: i, price: c.low, rsi: recentRsi[i] });
    }
    if (c.high > recentCandles[i - 1].high && c.high > recentCandles[i - 2].high &&
        c.high > recentCandles[i + 1].high && c.high > recentCandles[i + 2].high) {
      priceHighs.push({ idx: i, price: c.high, rsi: recentRsi[i] });
    }
  }

  // Bullish divergence: price makes lower low, RSI makes higher low
  if (priceLows.length >= 2) {
    const last = priceLows[priceLows.length - 1];
    const prev = priceLows[priceLows.length - 2];
    if (last.price < prev.price && last.rsi > prev.rsi) {
      return {
        type: "bullish",
        description: `Bullish RSI divergence: price made lower low ($${last.price.toFixed(2)} vs $${prev.price.toFixed(2)}) but RSI made higher low (${last.rsi.toFixed(0)} vs ${prev.rsi.toFixed(0)}) — potential reversal signal`,
      };
    }
  }

  // Bearish divergence: price makes higher high, RSI makes lower high
  if (priceHighs.length >= 2) {
    const last = priceHighs[priceHighs.length - 1];
    const prev = priceHighs[priceHighs.length - 2];
    if (last.price > prev.price && last.rsi < prev.rsi) {
      return {
        type: "bearish",
        description: `Bearish RSI divergence: price made higher high ($${last.price.toFixed(2)} vs $${prev.price.toFixed(2)}) but RSI made lower high (${last.rsi.toFixed(0)} vs ${prev.rsi.toFixed(0)}) — potential reversal signal`,
      };
    }
  }

  return null;
}

// ─── On-Balance Volume (OBV) ────────────────────────────────────────────────

function computeOBV(candles: Candle[]): { trend: "rising" | "falling" | "flat"; divergence: Divergence | null } {
  if (candles.length < 20) return { trend: "flat", divergence: null };

  const obvValues: number[] = [0];
  for (let i = 1; i < candles.length; i++) {
    const prev = obvValues[obvValues.length - 1];
    if (candles[i].close > candles[i - 1].close) obvValues.push(prev + candles[i].volume);
    else if (candles[i].close < candles[i - 1].close) obvValues.push(prev - candles[i].volume);
    else obvValues.push(prev);
  }

  // OBV trend: compare last 10 to previous 10
  const recentObv = obvValues.slice(-10);
  const priorObv = obvValues.slice(-20, -10);
  const recentAvg = recentObv.reduce((s, v) => s + v, 0) / recentObv.length;
  const priorAvg = priorObv.reduce((s, v) => s + v, 0) / priorObv.length;
  const ratio = priorAvg !== 0 ? recentAvg / priorAvg : 1;

  const trend = ratio > 1.1 ? "rising" as const : ratio < 0.9 ? "falling" as const : "flat" as const;

  // OBV divergence: price up but OBV down, or vice versa
  let divergence: Divergence | null = null;
  const priceChange = candles[candles.length - 1].close - candles[candles.length - 20].close;
  const obvChange = obvValues[obvValues.length - 1] - obvValues[obvValues.length - 20];
  if (priceChange > 0 && obvChange < 0) {
    divergence = { type: "bearish", description: "Bearish OBV divergence: price rising but volume flow declining — smart money may be distributing" };
  } else if (priceChange < 0 && obvChange > 0) {
    divergence = { type: "bullish", description: "Bullish OBV divergence: price falling but volume flow rising — smart money may be accumulating" };
  }

  return { trend, divergence };
}

// ─── Fibonacci retracements ─────────────────────────────────────────────────

function computeFibLevels(swingHigh: number | null, swingLow: number | null, currentPrice: number): FibLevel[] {
  if (!swingHigh || !swingLow || swingHigh <= swingLow) return [];

  const range = swingHigh - swingLow;
  const fibs = [
    { level: "0.0 (Low)", ratio: 0 },
    { level: "0.236", ratio: 0.236 },
    { level: "0.382", ratio: 0.382 },
    { level: "0.5", ratio: 0.5 },
    { level: "0.618 (Golden)", ratio: 0.618 },
    { level: "0.786", ratio: 0.786 },
    { level: "1.0 (High)", ratio: 1.0 },
    { level: "1.272 Ext", ratio: 1.272 },
    { level: "1.618 Ext", ratio: 1.618 },
  ];

  return fibs.map((f) => {
    const price = swingLow + range * f.ratio;
    return {
      level: f.level,
      price: Math.round(price * 100) / 100,
      distance: Math.round(((currentPrice - price) / currentPrice) * 10000) / 100,
    };
  });
}

// ─── VWAP ───────────────────────────────────────────────────────────────────

function computeVWAP(candles: Candle[]): number {
  let cumTypicalVol = 0;
  let cumVol = 0;
  const session = candles.slice(-24);
  for (const c of session) {
    const typical = (c.high + c.low + c.close) / 3;
    cumTypicalVol += typical * c.volume;
    cumVol += c.volume;
  }
  return cumVol > 0 ? cumTypicalVol / cumVol : session[session.length - 1]?.close ?? 0;
}

// ─── ATR ────────────────────────────────────────────────────────────────────

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

// ─── Volume profile ─────────────────────────────────────────────────────────

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

// ─── Regime detection ───────────────────────────────────────────────────────

function detectRegime(candles: Candle[], atr: number, structure: MarketStructure): Regime {
  if (candles.length < 20) return "ranging";
  const price = candles[candles.length - 1].close;
  const atrPct = (atr / price) * 100;
  if (atrPct > 3.5) return "volatile";
  if (structure === "uptrend" || structure === "downtrend") return "trending";
  return "ranging";
}

// ─── Upgraded Confluence Scoring (12 axes) ──────────────────────────────────

function scoreConfluence(params: {
  htfStructure: MarketStructure;
  trendStrength: number;
  rsi: number;
  rsiDiv: Divergence | null;
  vwapDist: number;
  volProfile: "increasing" | "decreasing" | "flat";
  nearSupport: boolean;
  nearResistance: boolean;
  regime: Regime;
  ema: EMASet;
  macd: MACDResult;
  bollinger: BollingerResult;
  obv: { trend: "rising" | "falling" | "flat"; divergence: Divergence | null };
  funding: FundingData | null;
  fearGreed: FearGreedData | null;
  multiTfRsiAlignment: "all_bullish" | "all_bearish" | "mixed";
}): { score: number; factors: string[] } {
  const {
    htfStructure, trendStrength, rsi, rsiDiv, vwapDist, volProfile,
    nearSupport, nearResistance, regime, ema, macd, bollinger, obv,
    funding, fearGreed, multiTfRsiAlignment,
  } = params;

  let score = 0;
  const factors: string[] = [];

  // 1. HTF structure alignment (15%)
  if ((htfStructure === "uptrend" || htfStructure === "downtrend") && trendStrength > 60) {
    score += 15;
    factors.push(`4H ${htfStructure} (strength ${Math.round(trendStrength)}) — strong directional bias`);
  } else if (trendStrength > 40) {
    score += 8;
    factors.push(`4H ${htfStructure} (moderate ${Math.round(trendStrength)})`);
  } else {
    score += 3;
    factors.push(`4H ranging — low directional conviction`);
  }

  // 2. EMA ribbon (12%)
  if (ema.ribbonState === "bullish_stack") {
    score += 12;
    factors.push("EMA ribbon fully bullish stacked (9>21>50>200)");
  } else if (ema.ribbonState === "bearish_stack") {
    score += 12;
    factors.push("EMA ribbon fully bearish stacked (9<21<50<200)");
  } else if (ema.ribbonState === "compressed") {
    score += 6;
    factors.push("EMAs compressed — breakout imminent");
  } else {
    score += 4;
    factors.push("EMA ribbon mixed — transitional phase");
  }

  // 3. MACD signal (10%)
  if (macd.crossover === "bullish_cross") {
    score += 10;
    factors.push("MACD bullish crossover — fresh momentum shift");
  } else if (macd.crossover === "bearish_cross") {
    score += 10;
    factors.push("MACD bearish crossover — momentum reversal");
  } else if (macd.trend === "bullish" && macd.histogramDirection === "expanding") {
    score += 8;
    factors.push("MACD bullish with expanding histogram");
  } else if (macd.trend === "bearish" && macd.histogramDirection === "expanding") {
    score += 8;
    factors.push("MACD bearish with expanding histogram");
  } else {
    score += 4;
    factors.push(`MACD ${macd.trend} (${macd.histogramDirection})`);
  }

  // 4. Bollinger Bands (8%)
  if (bollinger.squeeze) {
    score += 8;
    factors.push(`Bollinger squeeze active (BW ${bollinger.bandwidth.toFixed(2)}%) — volatility expansion imminent`);
  } else if (bollinger.priceZone === "below_lower") {
    score += 7;
    factors.push(`Price below lower Bollinger Band — extreme oversold`);
  } else if (bollinger.priceZone === "above_upper") {
    score += 7;
    factors.push(`Price above upper Bollinger Band — extreme overbought`);
  } else {
    score += 4;
    factors.push(`Bollinger %B at ${bollinger.percentB.toFixed(0)}%`);
  }

  // 5. RSI + divergence (10%)
  if (rsiDiv) {
    score += 10;
    factors.push(rsiDiv.description);
  } else if (rsi <= 30) {
    score += 8;
    factors.push(`RSI deeply oversold (${rsi}) — bounce setup`);
  } else if (rsi >= 70) {
    score += 8;
    factors.push(`RSI overbought (${rsi}) — pullback risk`);
  } else if (rsi >= 45 && rsi <= 55) {
    score += 3;
    factors.push(`RSI neutral (${rsi})`);
  } else {
    score += 5;
    factors.push(`RSI ${rsi > 55 ? "bullish" : "bearish"} (${rsi})`);
  }

  // 6. Multi-TF RSI alignment (5%)
  if (multiTfRsiAlignment === "all_bullish") {
    score += 5;
    factors.push("RSI aligned bullish across 4H/1H/15m");
  } else if (multiTfRsiAlignment === "all_bearish") {
    score += 5;
    factors.push("RSI aligned bearish across 4H/1H/15m");
  } else {
    score += 2;
    factors.push("RSI divergent across timeframes — conflicting signals");
  }

  // 7. OBV (8%)
  if (obv.divergence) {
    score += 8;
    factors.push(obv.divergence.description);
  } else if (obv.trend === "rising") {
    score += 6;
    factors.push("OBV rising — volume confirms price trend");
  } else if (obv.trend === "falling") {
    score += 3;
    factors.push("OBV falling — volume not confirming price");
  } else {
    score += 4;
    factors.push("OBV flat — accumulation/distribution unclear");
  }

  // 8. Volume confirmation (7%)
  if (volProfile === "increasing") {
    score += 7;
    factors.push("Volume increasing — conviction building");
  } else if (volProfile === "flat") {
    score += 4;
    factors.push("Volume flat — awaiting catalyst");
  } else {
    score += 2;
    factors.push("Volume declining — momentum fading");
  }

  // 9. Key level proximity (8%)
  if (nearSupport) {
    score += 8;
    factors.push("Price at key support level — high-probability reaction zone");
  } else if (nearResistance) {
    score += 7;
    factors.push("Price at key resistance — potential rejection or breakout");
  } else {
    score += 3;
    factors.push("Price between key levels — no immediate reaction zone");
  }

  // 10. VWAP (5%)
  if (Math.abs(vwapDist) < 0.5) {
    score += 5;
    factors.push(`Price at VWAP (${vwapDist > 0 ? "+" : ""}${vwapDist.toFixed(2)}%) — institutional magnet`);
  } else if (vwapDist > 1.5) {
    score += 3;
    factors.push(`Price extended above VWAP (+${vwapDist.toFixed(2)}%) — mean reversion risk`);
  } else if (vwapDist < -1.5) {
    score += 3;
    factors.push(`Price extended below VWAP (${vwapDist.toFixed(2)}%) — snap-back potential`);
  } else {
    score += 4;
    factors.push(`VWAP proximity ${vwapDist > 0 ? "+" : ""}${vwapDist.toFixed(2)}%`);
  }

  // 11. Funding rate (6%)
  if (funding) {
    if (funding.sentiment === "long_heavy") {
      score += 6;
      factors.push(`Funding heavily positive (${(funding.rate * 100).toFixed(4)}%, ${funding.annualized.toFixed(0)}% ann.) — crowded long, squeeze risk`);
    } else if (funding.sentiment === "short_heavy") {
      score += 6;
      factors.push(`Funding negative (${(funding.rate * 100).toFixed(4)}%, ${funding.annualized.toFixed(0)}% ann.) — crowded short, squeeze potential`);
    } else {
      score += 3;
      factors.push(`Funding neutral (${(funding.rate * 100).toFixed(4)}%) — balanced positioning`);
    }
  } else {
    score += 2;
    factors.push("Funding rate unavailable");
  }

  // 12. Fear & Greed (4%)
  if (fearGreed) {
    if (fearGreed.value <= 20) {
      score += 4;
      factors.push(`Extreme Fear (${fearGreed.value}/100) — contrarian buy signal historically`);
    } else if (fearGreed.value >= 80) {
      score += 4;
      factors.push(`Extreme Greed (${fearGreed.value}/100) — contrarian sell signal historically`);
    } else if (fearGreed.value <= 35) {
      score += 3;
      factors.push(`Fear (${fearGreed.value}/100) — sentiment depressed`);
    } else if (fearGreed.value >= 65) {
      score += 3;
      factors.push(`Greed (${fearGreed.value}/100) — euphoria building`);
    } else {
      score += 2;
      factors.push(`Neutral sentiment (${fearGreed.value}/100)`);
    }
  } else {
    score += 1;
    factors.push("Fear & Greed index unavailable");
  }

  // Regime modifier (bonus/penalty ±2)
  if (regime === "trending") {
    score += 2;
    factors.push("Trending regime — setups higher probability");
  } else if (regime === "volatile") {
    score -= 2;
    factors.push("Volatile regime — elevated whipsaw risk");
  }

  return { score: Math.max(0, Math.min(100, score)), factors };
}

// ─── Risk/reward pre-calc ───────────────────────────────────────────────────

function computeRiskReward(price: number, levels: KeyLevel[]) {
  const supports = levels.filter((l) => l.type === "support" && l.price < price).sort((a, b) => b.price - a.price);
  const resistances = levels.filter((l) => l.type === "resistance" && l.price > price).sort((a, b) => a.price - b.price);

  if (!supports.length || !resistances.length) return null;

  const nearestSup = supports[0].price;
  const nearestRes = resistances[0].price;

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

// ─── Deterministic Verdict Engine ────────────────────────────────────────────
//
// Every indicator casts a directional vote (bullish/bearish/neutral) with a
// weight (importance) and conviction (signal strength). The engine tallies
// weighted scores, computes signal agreement %, applies regime-based
// adjustments, and outputs a YES/NO verdict with confidence 0-100.
//
// This runs BEFORE the AI. The AI's job is to EXPLAIN the verdict, not decide.

function computeVerdict(params: {
  htfStructure: MarketStructure;
  trendStrength: number;
  ema: EMASet;
  macd: MACDResult;
  bollinger: BollingerResult;
  rsi: number;
  rsiDiv: Divergence | null;
  multiTfRsiAlignment: "all_bullish" | "all_bearish" | "mixed";
  obv: { trend: "rising" | "falling" | "flat"; divergence: Divergence | null };
  volProfile: "increasing" | "decreasing" | "flat";
  vwapDist: number;
  nearSupport: boolean;
  nearResistance: boolean;
  regime: Regime;
  funding: FundingData | null;
  fearGreed: FearGreedData | null;
  openInterest: OpenInterestData | null;
  longShort: LongShortData | null;
  takerRatio: TakerRatioData | null;
  currentPrice: number;
  riskReward: ReturnType<typeof computeRiskReward>;
}): ComputedVerdict {
  const {
    htfStructure, trendStrength, ema, macd, bollinger, rsi, rsiDiv,
    multiTfRsiAlignment, obv, volProfile, vwapDist, nearSupport,
    nearResistance, regime, funding, fearGreed, openInterest, longShort,
    takerRatio, currentPrice: price, riskReward,
  } = params;

  const votes: SignalVote[] = [];

  // ── 1. HTF Structure (weight: 0.18 — the king) ──
  {
    const w = 0.18;
    if (htfStructure === "uptrend") {
      const c = Math.min(1, trendStrength / 100);
      votes.push({ name: "HTF Structure", direction: "bullish", weight: w, conviction: c, reason: `4H uptrend, strength ${Math.round(trendStrength)}/100` });
    } else if (htfStructure === "downtrend") {
      const c = Math.min(1, trendStrength / 100);
      votes.push({ name: "HTF Structure", direction: "bearish", weight: w, conviction: c, reason: `4H downtrend, strength ${Math.round(trendStrength)}/100` });
    } else {
      votes.push({ name: "HTF Structure", direction: "neutral", weight: w, conviction: 0.3, reason: "4H ranging — no directional edge" });
    }
  }

  // ── 2. EMA Ribbon (weight: 0.14) ──
  {
    const w = 0.14;
    if (ema.ribbonState === "bullish_stack") {
      votes.push({ name: "EMA Ribbon", direction: "bullish", weight: w, conviction: 0.9, reason: "Full bullish stack: 9>21>50>200" });
    } else if (ema.ribbonState === "bearish_stack") {
      votes.push({ name: "EMA Ribbon", direction: "bearish", weight: w, conviction: 0.9, reason: "Full bearish stack: 9<21<50<200" });
    } else if (ema.ribbonState === "compressed") {
      // Compressed = about to break out, lean toward HTF bias
      const dir = htfStructure === "uptrend" ? "bullish" as const : htfStructure === "downtrend" ? "bearish" as const : "neutral" as const;
      votes.push({ name: "EMA Ribbon", direction: dir, weight: w, conviction: 0.4, reason: "EMAs compressed — breakout pending, leaning HTF bias" });
    } else {
      // Mixed — check price vs EMA200 as tie-breaker
      const dir = ema.priceVsEma200 === "above" ? "bullish" as const : ema.priceVsEma200 === "below" ? "bearish" as const : "neutral" as const;
      votes.push({ name: "EMA Ribbon", direction: dir, weight: w, conviction: 0.5, reason: `Mixed ribbon, price ${ema.priceVsEma200} EMA200` });
    }
  }

  // ── 3. MACD (weight: 0.12) ──
  {
    const w = 0.12;
    if (macd.crossover === "bullish_cross") {
      votes.push({ name: "MACD", direction: "bullish", weight: w, conviction: 0.85, reason: "Fresh bullish crossover" });
    } else if (macd.crossover === "bearish_cross") {
      votes.push({ name: "MACD", direction: "bearish", weight: w, conviction: 0.85, reason: "Fresh bearish crossover" });
    } else if (macd.trend === "bullish" && macd.histogramDirection === "expanding") {
      votes.push({ name: "MACD", direction: "bullish", weight: w, conviction: 0.75, reason: "Bullish with expanding histogram — accelerating" });
    } else if (macd.trend === "bearish" && macd.histogramDirection === "expanding") {
      votes.push({ name: "MACD", direction: "bearish", weight: w, conviction: 0.75, reason: "Bearish with expanding histogram — accelerating" });
    } else if (macd.trend === "bullish") {
      votes.push({ name: "MACD", direction: "bullish", weight: w, conviction: 0.5, reason: "Bullish but histogram contracting — losing steam" });
    } else if (macd.trend === "bearish") {
      votes.push({ name: "MACD", direction: "bearish", weight: w, conviction: 0.5, reason: "Bearish but histogram contracting — losing steam" });
    } else {
      votes.push({ name: "MACD", direction: "neutral", weight: w, conviction: 0.2, reason: "MACD flat at zero line" });
    }
  }

  // ── 4. Bollinger Bands (weight: 0.08) ──
  {
    const w = 0.08;
    if (bollinger.squeeze) {
      // Squeeze = no directional signal, but high conviction that a move is coming
      const dir = htfStructure === "uptrend" ? "bullish" as const : htfStructure === "downtrend" ? "bearish" as const : "neutral" as const;
      votes.push({ name: "Bollinger", direction: dir, weight: w, conviction: 0.6, reason: "Squeeze — breakout imminent, leaning HTF" });
    } else if (bollinger.priceZone === "below_lower") {
      votes.push({ name: "Bollinger", direction: "bullish", weight: w, conviction: 0.7, reason: "Price below lower band — mean reversion buy" });
    } else if (bollinger.priceZone === "above_upper") {
      votes.push({ name: "Bollinger", direction: "bearish", weight: w, conviction: 0.7, reason: "Price above upper band — mean reversion sell" });
    } else if (bollinger.percentB > 70) {
      votes.push({ name: "Bollinger", direction: "bullish", weight: w, conviction: 0.5, reason: `%B at ${bollinger.percentB.toFixed(0)}% — riding upper band` });
    } else if (bollinger.percentB < 30) {
      votes.push({ name: "Bollinger", direction: "bearish", weight: w, conviction: 0.5, reason: `%B at ${bollinger.percentB.toFixed(0)}% — riding lower band` });
    } else {
      votes.push({ name: "Bollinger", direction: "neutral", weight: w, conviction: 0.3, reason: "Price in middle of Bollinger range" });
    }
  }

  // ── 5. RSI (weight: 0.10) ──
  {
    const w = 0.10;
    if (rsiDiv) {
      // Divergence overrides raw RSI — it's a higher-conviction reversal signal
      votes.push({
        name: "RSI Divergence",
        direction: rsiDiv.type === "bullish" ? "bullish" : "bearish",
        weight: w + 0.03, // divergence gets bonus weight
        conviction: 0.85,
        reason: rsiDiv.description,
      });
    } else if (rsi <= 25) {
      votes.push({ name: "RSI", direction: "bullish", weight: w, conviction: 0.8, reason: `RSI deeply oversold at ${rsi}` });
    } else if (rsi <= 35) {
      votes.push({ name: "RSI", direction: "bullish", weight: w, conviction: 0.6, reason: `RSI oversold at ${rsi}` });
    } else if (rsi >= 75) {
      votes.push({ name: "RSI", direction: "bearish", weight: w, conviction: 0.8, reason: `RSI deeply overbought at ${rsi}` });
    } else if (rsi >= 65) {
      votes.push({ name: "RSI", direction: "bearish", weight: w, conviction: 0.6, reason: `RSI overbought at ${rsi}` });
    } else if (rsi > 55) {
      votes.push({ name: "RSI", direction: "bullish", weight: w, conviction: 0.4, reason: `RSI mildly bullish at ${rsi}` });
    } else if (rsi < 45) {
      votes.push({ name: "RSI", direction: "bearish", weight: w, conviction: 0.4, reason: `RSI mildly bearish at ${rsi}` });
    } else {
      votes.push({ name: "RSI", direction: "neutral", weight: w, conviction: 0.2, reason: `RSI neutral at ${rsi}` });
    }
  }

  // ── 6. Multi-TF RSI Alignment (weight: 0.07) ──
  {
    const w = 0.07;
    if (multiTfRsiAlignment === "all_bullish") {
      votes.push({ name: "Multi-TF RSI", direction: "bullish", weight: w, conviction: 0.8, reason: "RSI >50 across 4H/1H/15m — full alignment" });
    } else if (multiTfRsiAlignment === "all_bearish") {
      votes.push({ name: "Multi-TF RSI", direction: "bearish", weight: w, conviction: 0.8, reason: "RSI <50 across 4H/1H/15m — full alignment" });
    } else {
      votes.push({ name: "Multi-TF RSI", direction: "neutral", weight: w, conviction: 0.3, reason: "RSI mixed across timeframes" });
    }
  }

  // ── 7. OBV (weight: 0.09) ──
  {
    const w = 0.09;
    if (obv.divergence) {
      // OBV divergence = smart money signal, high weight
      votes.push({
        name: "OBV",
        direction: obv.divergence.type === "bullish" ? "bullish" : "bearish",
        weight: w + 0.02,
        conviction: 0.8,
        reason: obv.divergence.description,
      });
    } else if (obv.trend === "rising") {
      votes.push({ name: "OBV", direction: "bullish", weight: w, conviction: 0.6, reason: "OBV rising — volume flow supports price" });
    } else if (obv.trend === "falling") {
      votes.push({ name: "OBV", direction: "bearish", weight: w, conviction: 0.6, reason: "OBV falling — volume flow contradicts price" });
    } else {
      votes.push({ name: "OBV", direction: "neutral", weight: w, conviction: 0.3, reason: "OBV flat — no clear accumulation/distribution" });
    }
  }

  // ── 8. Volume Profile (weight: 0.05) ──
  {
    const w = 0.05;
    // Volume alone isn't directional — it confirms the prevailing structure
    if (volProfile === "increasing") {
      const dir = htfStructure === "uptrend" ? "bullish" as const : htfStructure === "downtrend" ? "bearish" as const : "neutral" as const;
      votes.push({ name: "Volume", direction: dir, weight: w, conviction: 0.7, reason: "Volume increasing — confirms trend momentum" });
    } else if (volProfile === "decreasing") {
      // Declining volume in a trend = weakening
      const dir = htfStructure === "uptrend" ? "bearish" as const : htfStructure === "downtrend" ? "bullish" as const : "neutral" as const;
      votes.push({ name: "Volume", direction: dir, weight: w, conviction: 0.5, reason: "Volume declining — trend losing conviction" });
    } else {
      votes.push({ name: "Volume", direction: "neutral", weight: w, conviction: 0.2, reason: "Volume flat — market waiting" });
    }
  }

  // ── 9. VWAP (weight: 0.05) ──
  {
    const w = 0.05;
    if (vwapDist > 1.0) {
      votes.push({ name: "VWAP", direction: "bearish", weight: w, conviction: 0.5, reason: `Extended +${vwapDist.toFixed(2)}% above VWAP — mean reversion risk` });
    } else if (vwapDist < -1.0) {
      votes.push({ name: "VWAP", direction: "bullish", weight: w, conviction: 0.5, reason: `Extended ${vwapDist.toFixed(2)}% below VWAP — snap-back potential` });
    } else if (vwapDist > 0) {
      votes.push({ name: "VWAP", direction: "bullish", weight: w, conviction: 0.4, reason: `Price above VWAP (+${vwapDist.toFixed(2)}%) — buyers in control` });
    } else {
      votes.push({ name: "VWAP", direction: "bearish", weight: w, conviction: 0.4, reason: `Price below VWAP (${vwapDist.toFixed(2)}%) — sellers in control` });
    }
  }

  // ── 10. Key Level Proximity (weight: 0.06) ──
  {
    const w = 0.06;
    if (nearSupport) {
      votes.push({ name: "Key Level", direction: "bullish", weight: w, conviction: 0.7, reason: "Price at key support — high-probability bounce zone" });
    } else if (nearResistance) {
      votes.push({ name: "Key Level", direction: "bearish", weight: w, conviction: 0.7, reason: "Price at key resistance — high-probability rejection zone" });
    } else {
      votes.push({ name: "Key Level", direction: "neutral", weight: w, conviction: 0.2, reason: "Price between levels — no immediate edge" });
    }
  }

  // ── 11. Funding Rate (weight: 0.04 — contrarian) ──
  if (funding) {
    const w = 0.04;
    if (funding.sentiment === "long_heavy") {
      // Crowded longs = contrarian bearish (squeeze the longs)
      votes.push({ name: "Funding", direction: "bearish", weight: w, conviction: 0.65, reason: `Funding heavily positive (${funding.annualized.toFixed(0)}% ann.) — crowded longs, squeeze risk` });
    } else if (funding.sentiment === "short_heavy") {
      // Crowded shorts = contrarian bullish (squeeze the shorts)
      votes.push({ name: "Funding", direction: "bullish", weight: w, conviction: 0.65, reason: `Funding negative (${funding.annualized.toFixed(0)}% ann.) — crowded shorts, squeeze potential` });
    } else {
      votes.push({ name: "Funding", direction: "neutral", weight: w, conviction: 0.2, reason: "Funding neutral — balanced positioning" });
    }
  }

  // ── 12. Fear & Greed (weight: 0.03 — contrarian) ──
  if (fearGreed) {
    const w = 0.03;
    if (fearGreed.value <= 20) {
      votes.push({ name: "Fear & Greed", direction: "bullish", weight: w, conviction: 0.7, reason: `Extreme Fear (${fearGreed.value}) — historically a buy signal` });
    } else if (fearGreed.value >= 80) {
      votes.push({ name: "Fear & Greed", direction: "bearish", weight: w, conviction: 0.7, reason: `Extreme Greed (${fearGreed.value}) — historically a sell signal` });
    } else if (fearGreed.value <= 35) {
      votes.push({ name: "Fear & Greed", direction: "bullish", weight: w, conviction: 0.4, reason: `Fear zone (${fearGreed.value})` });
    } else if (fearGreed.value >= 65) {
      votes.push({ name: "Fear & Greed", direction: "bearish", weight: w, conviction: 0.4, reason: `Greed zone (${fearGreed.value})` });
    } else {
      votes.push({ name: "Fear & Greed", direction: "neutral", weight: w, conviction: 0.2, reason: `Neutral sentiment (${fearGreed.value})` });
    }
  }

  // ── 13. R:R Asymmetry (weight: 0.04) ──
  if (riskReward) {
    const w = 0.04;
    if (riskReward.longRR > 2.0 && riskReward.shortRR < 1.0) {
      votes.push({ name: "Risk/Reward", direction: "bullish", weight: w, conviction: 0.7, reason: `Long R:R ${riskReward.longRR}:1 vs Short ${riskReward.shortRR}:1 — asymmetric long` });
    } else if (riskReward.shortRR > 2.0 && riskReward.longRR < 1.0) {
      votes.push({ name: "Risk/Reward", direction: "bearish", weight: w, conviction: 0.7, reason: `Short R:R ${riskReward.shortRR}:1 vs Long ${riskReward.longRR}:1 — asymmetric short` });
    } else if (riskReward.longRR > riskReward.shortRR) {
      votes.push({ name: "Risk/Reward", direction: "bullish", weight: w, conviction: 0.5, reason: `Long R:R ${riskReward.longRR}:1 slightly favored` });
    } else if (riskReward.shortRR > riskReward.longRR) {
      votes.push({ name: "Risk/Reward", direction: "bearish", weight: w, conviction: 0.5, reason: `Short R:R ${riskReward.shortRR}:1 slightly favored` });
    } else {
      votes.push({ name: "Risk/Reward", direction: "neutral", weight: w, conviction: 0.2, reason: "Symmetric R:R — no edge from levels" });
    }
  }

  // ── 14. Open Interest (weight: 0.06) ──
  if (openInterest) {
    const w = 0.06;
    // OI rising + price above VWAP = longs piling in = bullish
    // OI rising + price below VWAP = shorts piling in = bearish
    // OI falling = deleveraging = reduce confidence (neutral)
    if (openInterest.trend === "rising" && openInterest.change24h > 3) {
      const dir = vwapDist >= 0 ? "bullish" as const : "bearish" as const;
      const reason = dir === "bullish"
        ? `OI up ${openInterest.change24h.toFixed(1)}% + price above VWAP — longs building`
        : `OI up ${openInterest.change24h.toFixed(1)}% + price below VWAP — shorts building`;
      votes.push({ name: "Open Interest", direction: dir, weight: w, conviction: 0.7, reason });
    } else if (openInterest.trend === "falling" && openInterest.change24h < -3) {
      votes.push({ name: "Open Interest", direction: "neutral", weight: w, conviction: 0.3,
        reason: `OI down ${Math.abs(openInterest.change24h).toFixed(1)}% — deleveraging, market resetting` });
    } else {
      votes.push({ name: "Open Interest", direction: "neutral", weight: w, conviction: 0.2,
        reason: `OI stable (${openInterest.change24h > 0 ? "+" : ""}${openInterest.change24h.toFixed(1)}%)` });
    }
  }

  // ── 15. Long/Short Ratio (weight: 0.06 — contrarian) ──
  if (longShort) {
    const w = 0.06;
    if (longShort.contrarian === "bullish") {
      // Retail crowded short / smart money long = squeeze fuel
      const c = longShort.smartMoneyBias === "long_heavy" ? 0.8 : 0.65;
      votes.push({ name: "L/S Ratio", direction: "bullish", weight: w, conviction: c, reason: longShort.interpretation });
    } else if (longShort.contrarian === "bearish") {
      // Retail crowded long / smart money short = dump fuel
      const c = longShort.smartMoneyBias === "short_heavy" ? 0.8 : 0.65;
      votes.push({ name: "L/S Ratio", direction: "bearish", weight: w, conviction: c, reason: longShort.interpretation });
    } else {
      votes.push({ name: "L/S Ratio", direction: "neutral", weight: w, conviction: 0.2, reason: longShort.interpretation });
    }
  }

  // ── 16. Taker Buy/Sell Ratio (weight: 0.07 — highest real-time signal) ──
  if (takerRatio) {
    const w = 0.07;
    const convMap = { strong: 0.85, moderate: 0.65, weak: 0.35 };
    const c = convMap[takerRatio.strength];
    if (takerRatio.trend === "buyers_dominant") {
      votes.push({ name: "Taker Ratio", direction: "bullish", weight: w, conviction: c, reason: takerRatio.interpretation });
    } else if (takerRatio.trend === "sellers_dominant") {
      votes.push({ name: "Taker Ratio", direction: "bearish", weight: w, conviction: c, reason: takerRatio.interpretation });
    } else {
      votes.push({ name: "Taker Ratio", direction: "neutral", weight: w, conviction: 0.2, reason: takerRatio.interpretation });
    }
  }

  // ─── Tally weighted scores ───
  let bullishScore = 0;
  let bearishScore = 0;
  let totalWeight = 0;

  for (const v of votes) {
    const pts = v.weight * v.conviction * 100;
    if (v.direction === "bullish") bullishScore += pts;
    else if (v.direction === "bearish") bearishScore += pts;
    // Neutral adds to neither
    totalWeight += v.weight;
  }

  // Normalize to 0-100 scale
  const maxPossible = totalWeight * 100;
  bullishScore = maxPossible > 0 ? (bullishScore / maxPossible) * 100 : 50;
  bearishScore = maxPossible > 0 ? (bearishScore / maxPossible) * 100 : 50;
  const netScore = bullishScore - bearishScore; // -100 to +100

  // ─── Signal agreement ───
  const majorityDir = netScore >= 0 ? "bullish" : "bearish";
  const directionalVotes = votes.filter((v) => v.direction !== "neutral");
  const agreeingSignals = directionalVotes.filter((v) => v.direction === majorityDir).length;
  const totalSignals = directionalVotes.length;
  const signalAgreement = totalSignals > 0 ? Math.round((agreeingSignals / totalSignals) * 100) : 50;

  // Contrarian flags — signals that disagree with the majority
  const contrariansFlags = directionalVotes
    .filter((v) => v.direction !== majorityDir)
    .map((v) => `${v.name}: ${v.direction} — ${v.reason}`);

  // ─── Regime-based confidence adjustment ───
  let regimeAdjustment = 0;
  if (regime === "trending") {
    // Trending regimes make directional signals more reliable
    regimeAdjustment = 8;
  } else if (regime === "volatile") {
    // Volatile regimes make everything less reliable
    regimeAdjustment = -12;
  } else {
    // Ranging reduces confidence slightly
    regimeAdjustment = -5;
  }

  // ─── Compute final confidence ───
  // Base confidence from how far apart bull vs bear scores are
  const separation = Math.abs(netScore);
  let confidence = Math.min(95, Math.max(15, separation * 1.2 + 20));

  // Signal agreement multiplier: if 80%+ agree, boost; if <50%, penalize
  if (signalAgreement >= 80) confidence += 10;
  else if (signalAgreement >= 65) confidence += 5;
  else if (signalAgreement < 45) confidence -= 10;

  // Regime adjustment
  confidence += regimeAdjustment;

  // High-conviction divergences add extra confidence
  const hasDivergence = rsiDiv || obv.divergence;
  if (hasDivergence) confidence += 5;

  // Clamp
  confidence = Math.max(10, Math.min(95, Math.round(confidence)));

  // ─── Direction ───
  const direction: "YES" | "NO" = netScore >= 0 ? "YES" : "NO";

  // ─── Build rationale ───
  const topBullish = votes
    .filter((v) => v.direction === "bullish")
    .sort((a, b) => b.weight * b.conviction - a.weight * a.conviction)
    .slice(0, 3);
  const topBearish = votes
    .filter((v) => v.direction === "bearish")
    .sort((a, b) => b.weight * b.conviction - a.weight * a.conviction)
    .slice(0, 3);

  const rationale = [
    `Verdict: ${direction} with ${confidence}% confidence.`,
    `${agreeingSignals}/${totalSignals} directional signals agree (${signalAgreement}% alignment).`,
    `Net score: ${netScore > 0 ? "+" : ""}${netScore.toFixed(1)} (bull ${bullishScore.toFixed(1)} vs bear ${bearishScore.toFixed(1)}).`,
    ``,
    `Top bullish signals:`,
    ...topBullish.map((v) => `  • ${v.name} (${(v.conviction * 100).toFixed(0)}% conviction): ${v.reason}`),
    ``,
    `Top bearish signals:`,
    ...topBearish.map((v) => `  • ${v.name} (${(v.conviction * 100).toFixed(0)}% conviction): ${v.reason}`),
    ...(contrariansFlags.length > 0 ? [``, `Contrarian warnings:`, ...contrariansFlags.map((f) => `  ⚠ ${f}`)] : []),
    ``,
    `Regime: ${regime} (adjustment: ${regimeAdjustment > 0 ? "+" : ""}${regimeAdjustment}pts)`,
  ].join("\n");

  return {
    direction,
    confidence,
    bullishScore: Math.round(bullishScore * 10) / 10,
    bearishScore: Math.round(bearishScore * 10) / 10,
    netScore: Math.round(netScore * 10) / 10,
    signalAgreement,
    totalSignals,
    agreeingSignals,
    votes,
    regimeAdjustment,
    contrariansFlags,
    verdictRationale: rationale,
  };
}

// ─── Summary builder ────────────────────────────────────────────────────────

function buildSummary(ta: Omit<TechnicalAnalysis, "summary">): string {
  const {
    htf, rsi14, rsiDivergence, vwapDistance, volumeProfile, regime,
    confluenceScore, confluenceFactors, levels, nearestSupport,
    nearestResistance, riskReward, currentPrice, volatilityPct,
    ema, macd, bollinger, obv, funding, fearGreed, fibLevels,
    multiTfRsi, verdict,
  } = ta;

  const fmtPrice = (p: number) => `$${p.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

  const lines: string[] = [
    `TECHNICAL ANALYSIS — ${ta.symbol} @ ${fmtPrice(currentPrice)}`,
    ``,
    `═══════════════════════════════════════════════`,
    `  COMPUTED VERDICT: ${verdict.direction} (${verdict.confidence}% confidence)`,
    `  Signal Agreement: ${verdict.agreeingSignals}/${verdict.totalSignals} signals (${verdict.signalAgreement}%)`,
    `  Net Score: ${verdict.netScore > 0 ? "+" : ""}${verdict.netScore} (bull ${verdict.bullishScore} / bear ${verdict.bearishScore})`,
    `  Regime Adjustment: ${verdict.regimeAdjustment > 0 ? "+" : ""}${verdict.regimeAdjustment}pts (${regime})`,
    `═══════════════════════════════════════════════`,
    ``,
    `STRUCTURE:`,
    `  4H: ${htf.structure.toUpperCase()} (strength ${htf.trendStrength}/100)`,
    `  Bias: ${htf.bias}`,
    ...(htf.swingHigh ? [`  4H Swing High: ${fmtPrice(htf.swingHigh)}`] : []),
    ...(htf.swingLow ? [`  4H Swing Low: ${fmtPrice(htf.swingLow)}`] : []),
    `  Regime: ${regime}`,
    ``,
    `EMA RIBBON:`,
    `  EMA9: ${fmtPrice(ema.ema9)} | EMA21: ${fmtPrice(ema.ema21)} | EMA50: ${fmtPrice(ema.ema50)} | EMA200: ${fmtPrice(ema.ema200)}`,
    `  State: ${ema.ribbonState.replace("_", " ")} | Price vs EMA200: ${ema.priceVsEma200}`,
    ``,
    `MACD:`,
    `  Line: ${macd.macdLine} | Signal: ${macd.signalLine} | Histogram: ${macd.histogram}`,
    `  Trend: ${macd.trend} | Crossover: ${macd.crossover.replace("_", " ")} | Histogram: ${macd.histogramDirection}`,
    ``,
    `BOLLINGER BANDS:`,
    `  Upper: ${fmtPrice(bollinger.upper)} | Middle: ${fmtPrice(bollinger.middle)} | Lower: ${fmtPrice(bollinger.lower)}`,
    `  Bandwidth: ${bollinger.bandwidth.toFixed(2)}% | %B: ${bollinger.percentB.toFixed(1)}% | Squeeze: ${bollinger.squeeze ? "YES — breakout imminent" : "no"}`,
    `  Price zone: ${bollinger.priceZone.replace(/_/g, " ")}`,
    ``,
    `INDICATORS:`,
    `  RSI(14): ${rsi14} | Multi-TF: 4H=${multiTfRsi.tf4h} / 1H=${multiTfRsi.tf1h} / 15m=${multiTfRsi.tf15m} (${multiTfRsi.alignment})`,
    ...(rsiDivergence ? [`  ⚠ ${rsiDivergence.description}`] : []),
    `  VWAP distance: ${vwapDistance > 0 ? "+" : ""}${vwapDistance.toFixed(2)}%`,
    `  OBV: ${obv.trend}${obv.divergence ? ` — ⚠ ${obv.divergence.description}` : ""}`,
    `  Volume: ${volumeProfile}`,
    `  Volatility (ATR%): ${volatilityPct.toFixed(2)}%`,
  ];

  // Funding, sentiment & market microstructure
  if (funding) {
    lines.push(`  Funding rate: ${(funding.rate * 100).toFixed(4)}% (${funding.annualized.toFixed(0)}% ann.) — ${funding.sentiment.replace("_", " ")}`);
  }
  if (fearGreed) {
    lines.push(`  Fear & Greed: ${fearGreed.value}/100 (${fearGreed.classification})`);
  }
  if (ta.openInterest) {
    const oi = ta.openInterest;
    lines.push(`  Open Interest: $${(oi.current / 1e9).toFixed(2)}B (${oi.change24h > 0 ? "+" : ""}${oi.change24h.toFixed(1)}% 24h) — ${oi.interpretation}`);
  }
  if (ta.longShort) {
    const ls = ta.longShort;
    lines.push(`  Long/Short: retail ${ls.globalLongPct.toFixed(0)}%L/${ls.globalShortPct.toFixed(0)}%S | smart money ${ls.topTraderLongPct.toFixed(0)}%L — ${ls.interpretation}`);
  }
  if (ta.takerRatio) {
    const tr = ta.takerRatio;
    lines.push(`  Taker Ratio: ${(tr.buyRatio * 100).toFixed(1)}% buy / ${(tr.sellRatio * 100).toFixed(1)}% sell — ${tr.interpretation}`);
  }

  // Key levels
  lines.push(``, `KEY LEVELS:`);
  const topLevels = levels.slice(0, 8);
  for (const level of topLevels) {
    const dist = ((level.price - currentPrice) / currentPrice * 100).toFixed(2);
    lines.push(`  ${fmtPrice(level.price)} — ${level.type} (${level.tested}x tested, ${dist}%)`);
  }
  if (nearestSupport) lines.push(`  Nearest support: ${fmtPrice(nearestSupport)}`);
  if (nearestResistance) lines.push(`  Nearest resistance: ${fmtPrice(nearestResistance)}`);

  // Fibonacci
  if (fibLevels.length > 0) {
    lines.push(``, `FIBONACCI RETRACEMENTS:`);
    for (const fib of fibLevels) {
      const marker = Math.abs(fib.distance) < 1 ? " ← PRICE HERE" : "";
      lines.push(`  ${fib.level}: ${fmtPrice(fib.price)} (${fib.distance > 0 ? "+" : ""}${fib.distance}%)${marker}`);
    }
  }

  // Confluence
  lines.push(``, `CONFLUENCE SCORE: ${confluenceScore}/100`);
  for (const f of confluenceFactors) lines.push(`  ✓ ${f}`);

  // Risk/reward
  if (riskReward) {
    lines.push(``, `RISK/REWARD:`);
    lines.push(`  Long: entry ${fmtPrice(riskReward.longEntry)}, stop ${fmtPrice(riskReward.longStop)}, target ${fmtPrice(riskReward.longTarget)} — R:R ${riskReward.longRR}:1`);
    lines.push(`  Short: entry ${fmtPrice(riskReward.shortEntry)}, stop ${fmtPrice(riskReward.shortStop)}, target ${fmtPrice(riskReward.shortTarget)} — R:R ${riskReward.shortRR}:1`);
  }

  // Full verdict breakdown
  lines.push(``, `SIGNAL VOTES:`);
  for (const v of verdict.votes) {
    const arrow = v.direction === "bullish" ? "▲" : v.direction === "bearish" ? "▼" : "—";
    lines.push(`  ${arrow} ${v.name} [${v.direction}] (w:${v.weight.toFixed(2)} c:${(v.conviction * 100).toFixed(0)}%): ${v.reason}`);
  }

  if (verdict.contrariansFlags.length > 0) {
    lines.push(``, `CONTRARIAN WARNINGS:`);
    for (const flag of verdict.contrariansFlags) {
      lines.push(`  ⚠ ${flag}`);
    }
  }

  return lines.filter(Boolean).join("\n");
}

// ─── Main entry point ───────────────────────────────────────────────────────

// Full name → ticker mappings for common project names not obvious from ticker
const NAME_TO_SYMBOL: Record<string, string> = {
  bitcoin: "BTC", ethereum: "ETH", ether: "ETH", solana: "SOL",
  ripple: "XRP", dogecoin: "DOGE", cardano: "ADA", avalanche: "AVAX",
  polkadot: "DOT", polygon: "MATIC", pol: "POL", chainlink: "LINK",
  uniswap: "UNI", arbitrum: "ARB", optimism: "OP", aptos: "APT",
  celestia: "TIA", injective: "INJ", dogwifhat: "WIF", "fetch.ai": "FET",
  render: "RENDER", tron: "TRX", toncoin: "TON", shiba: "SHIB",
  litecoin: "LTC", "bitcoin cash": "BCH", cosmos: "ATOM", hedera: "HBAR",
  stellar: "XLM", "internet computer": "ICP", vechain: "VET", filecoin: "FIL",
  algorand: "ALGO", aave: "AAVE", "near protocol": "NEAR",
  immutable: "IMX", "the sandbox": "SAND", decentraland: "MANA",
  "axie infinity": "AXS", "the graph": "GRT", lido: "LDO", thorchain: "RUNE",
  theta: "THETA", "elrond": "EGLD", multiversx: "EGLD", fantom: "FTM",
  pancakeswap: "CAKE", stepn: "GMT", blur: "BLUR", stacks: "STX",
  flow: "FLOW", chiliz: "CHZ", zilliqa: "ZIL", "world coin": "WLD",
  worldcoin: "WLD", "bittensor": "TAO", pendle: "PENDLE",
  "notcoin": "NOT", eigenlayer: "EIGEN", starknet: "STRK",
};

export function detectCryptoSymbol(text: string): string | null {
  const haystack = text.toLowerCase();
  const matches: Array<{ sym: string; pos: number }> = [];

  // 1. Full name lookup (longest match first to avoid partial hits)
  const sortedNames = Object.keys(NAME_TO_SYMBOL).sort((a, b) => b.length - a.length);
  for (const name of sortedNames) {
    const idx = haystack.indexOf(name);
    if (idx !== -1) {
      matches.push({ sym: NAME_TO_SYMBOL[name], pos: idx });
    }
  }

  // 2. Ticker scan — look for ALL-CAPS 2-10 char tokens that match our symbol map
  // e.g. "Will HBAR hit $1?" — extracts HBAR
  const tickerRe = /\b([A-Z]{2,10})\b/g;
  let m: RegExpExecArray | null;
  while ((m = tickerRe.exec(text)) !== null) {
    const ticker = m[1];
    if (BINANCE_SYMBOLS[ticker]) {
      matches.push({ sym: ticker, pos: m.index });
    }
  }

  // 3. Some common tickers that are ambiguous as words — explicit patterns
  const explicit: Array<[string, RegExp]> = [
    ["BTC", /\bbtc\b/i], ["ETH", /\beth\b/i], ["BNB", /\bbnb\b/i],
    ["SOL", /\bsol\b/i], ["XRP", /\bxrp\b/i], ["ADA", /\bada\b/i],
    ["DOT", /\bdot\b/i], ["UNI", /\buni\b/i], ["SEI", /\bsei\b/i],
    ["SUI", /\bsui\b/i], ["OP", /\bop\b/i], ["INJ", /\binj\b/i],
    ["ARB", /\barb\b/i], ["FET", /\bfet\b/i], ["TIA", /\btia\b/i],
    ["WIF", /\bwif\b/i], ["NOT", /\bnot\b/i], ["TAO", /\btao\b/i],
    ["WLD", /\bwld\b/i], ["STX", /\bstx\b/i], ["GRT", /\bgrt\b/i],
    ["LDO", /\bldo\b/i], ["IMX", /\bimx\b/i], ["FTM", /\bftm\b/i],
    ["RNDR", /\brndr\b/i],
  ];
  for (const [sym, re] of explicit) {
    const ex = re.exec(haystack);
    if (ex) matches.push({ sym: sym === "RNDR" ? "RENDER" : sym, pos: ex.index });
  }

  if (!matches.length) return null;

  // Return FIRST mentioned crypto — it's the subject of the question
  matches.sort((a, b) => a.pos - b.pos);
  return matches[0].sym;
}

export async function runTechnicalAnalysis(asset: string): Promise<TechnicalAnalysis | null> {
  const upperAsset = asset.toUpperCase();

  // Resolve binance symbol — first check static map, then dynamic Binance validation
  let binanceSymbol = BINANCE_SYMBOLS[upperAsset];

  if (!binanceSymbol) {
    // Try XXXUSDT directly against Binance exchange info
    const candidate = `${upperAsset}USDT`;
    try {
      const validSymbols = await getBinanceSymbols();
      if (validSymbols.has(candidate)) {
        binanceSymbol = candidate;
      }
    } catch {
      // ignore, will fall through to null
    }
  }

  if (!binanceSymbol) return null;

  // Check cache (5 minute TTL) — key on binanceSymbol so dynamic lookups share cache
  const cacheKey = buildCacheKey("ta:analysis:v2", { asset: binanceSymbol });
  const cached = await getJsonCache(cacheKey);
  if (cached) return cached as TechnicalAnalysis;

  try {
    // Fetch multi-timeframe candles + all external data in parallel
    const [candles4h, candles1h, candles15m, fundingData, fearGreedData] = await Promise.all([
      fetchCandles(binanceSymbol, "4h", 200),   // ~33 days (need 200 for EMA200)
      fetchCandles(binanceSymbol, "1h", 250),   // ~10 days
      fetchCandles(binanceSymbol, "15m", 96),   // ~24 hours
      fetchFundingRate(binanceSymbol),
      fetchFearGreed(),
    ]);

    if (!candles4h.length || !candles1h.length) return null;

    const price = (candles15m.length ? candles15m[candles15m.length - 1] : candles1h[candles1h.length - 1]).close;

    // Fetch market microstructure data now that we have price (OI needs price for USD conversion)
    const [oiData, lsData, takerData] = await Promise.all([
      fetchOpenInterest(binanceSymbol, price).catch(() => null),
      fetchLongShortRatio(binanceSymbol).catch(() => null),
      fetchTakerRatio(binanceSymbol).catch(() => null),
    ]);

    // ─── HTF structure from 4H ───
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

    // ─── Key levels from combined 4H + 1H swings ───
    const oneHSwings = findSwingPoints(candles1h, 4);
    const allSwings = [...htfSwings, ...oneHSwings];
    const levels = buildKeyLevels(allSwings, price);

    const supports = levels.filter((l) => l.type === "support").sort((a, b) => b.price - a.price);
    const resistances = levels.filter((l) => l.type === "resistance").sort((a, b) => a.price - b.price);
    const nearestSupport = supports[0]?.price ?? null;
    const nearestResistance = resistances[0]?.price ?? null;

    // ─── Fibonacci ───
    const fibLevels = computeFibLevels(swingHigh, swingLow, price);

    // ─── EMA Ribbon from 1H ───
    const ema = computeEMARibbon(candles1h);

    // ─── MACD from 1H ───
    const macd = computeMACD(candles1h);

    // ─── Bollinger Bands from 1H ───
    const bollinger = computeBollinger(candles1h);

    // ─── RSI series + divergence from 1H ───
    const rsiSeries1h = computeRSISeries(candles1h, 14);
    const rsi14 = Math.round(rsiSeries1h[rsiSeries1h.length - 1]);
    const rsiDivergence = detectRSIDivergence(candles1h, rsiSeries1h, 40);

    // ─── Multi-TF RSI ───
    const rsi4h = computeRSI(candles4h, 14);
    const rsi15m = computeRSI(candles15m, 14);
    const allAbove50 = rsi4h > 50 && rsi14 > 50 && rsi15m > 50;
    const allBelow50 = rsi4h < 50 && rsi14 < 50 && rsi15m < 50;
    const multiTfRsi = {
      tf4h: rsi4h,
      tf1h: rsi14,
      tf15m: rsi15m,
      alignment: allAbove50 ? "all_bullish" as const : allBelow50 ? "all_bearish" as const : "mixed" as const,
    };

    // ─── OBV from 1H ───
    const obv = computeOBV(candles1h);

    // ─── VWAP + ATR from 1H ───
    const vwap = computeVWAP(candles1h);
    const vwapDistance = vwap > 0 ? ((price - vwap) / vwap) * 100 : 0;
    const atr = computeATR(candles1h, 14);
    const volatilityPct = price > 0 ? (atr / price) * 100 : 0;
    const volumeProfile = analyzeVolumeProfile(candles1h);

    // ─── Regime ───
    const regime = detectRegime(candles1h, atr, structure);

    // ─── Confluence scoring ───
    const nearSup = nearestSupport ? Math.abs((price - nearestSupport) / price) < 0.015 : false;
    const nearRes = nearestResistance ? Math.abs((price - nearestResistance) / price) < 0.015 : false;
    const { score, factors } = scoreConfluence({
      htfStructure: structure,
      trendStrength,
      rsi: rsi14,
      rsiDiv: rsiDivergence,
      vwapDist: vwapDistance,
      volProfile: volumeProfile,
      nearSupport: nearSup,
      nearResistance: nearRes,
      regime,
      ema,
      macd,
      bollinger,
      obv,
      funding: fundingData,
      fearGreed: fearGreedData,
      multiTfRsiAlignment: multiTfRsi.alignment,
    });

    // ─── Risk/reward ───
    const riskReward = computeRiskReward(price, levels);

    // ─── Deterministic verdict ───
    const verdict = computeVerdict({
      htfStructure: structure,
      trendStrength,
      ema,
      macd,
      bollinger,
      rsi: rsi14,
      rsiDiv: rsiDivergence,
      multiTfRsiAlignment: multiTfRsi.alignment,
      obv,
      volProfile: volumeProfile,
      vwapDist: vwapDistance,
      nearSupport: nearSup,
      nearResistance: nearRes,
      regime,
      funding: fundingData,
      fearGreed: fearGreedData,
      openInterest: oiData,
      longShort: lsData,
      takerRatio: takerData,
      currentPrice: price,
      riskReward,
    });

    const ta: Omit<TechnicalAnalysis, "summary"> = {
      symbol: binanceSymbol,
      currentPrice: price,
      htf: { structure, trendStrength: Math.round(trendStrength), bias, swingHigh, swingLow },
      levels,
      nearestSupport,
      nearestResistance,
      fibLevels,
      ema,
      macd,
      bollinger,
      rsi14,
      rsiDivergence,
      multiTfRsi,
      obv,
      volumeProfile,
      vwapDistance: Math.round(vwapDistance * 100) / 100,
      volatilityPct: Math.round(volatilityPct * 100) / 100,
      funding: fundingData,
      fearGreed: fearGreedData,
      openInterest: oiData,
      longShort: lsData,
      takerRatio: takerData,
      regime,
      confluenceScore: Math.round(score),
      confluenceFactors: factors,
      verdict,
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
