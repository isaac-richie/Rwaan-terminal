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

// ─── V3 indicator types ─────────────────────────────────────────────────────

export type VolumeProfileData = {
  poc: number;           // Point of Control — price with highest volume
  vah: number;           // Value Area High (70% volume)
  val: number;           // Value Area Low (70% volume)
  priceVsPoc: "above" | "below" | "at";
  pocDistance: number;   // % from current price
  interpretation: string;
};

export type IchimokuData = {
  tenkan: number;        // 9-period midpoint (conversion line)
  kijun: number;         // 26-period midpoint (base line)
  senkouA: number;       // Senkou Span A (leading — (tenkan+kijun)/2 shifted 26)
  senkouB: number;       // Senkou Span B (leading — 52-period midpoint shifted 26)
  chikou: number;        // Chikou Span (close shifted back 26)
  cloudColor: "green" | "red";
  priceVsCloud: "above" | "in" | "below";
  tkCross: "bullish" | "bearish" | "none";
  cloudTwist: boolean;   // Senkou A crossed Senkou B recently — trend change
  signal: "strong_bullish" | "bullish" | "neutral" | "bearish" | "strong_bearish";
  interpretation: string;
};

export type ADXData = {
  adx: number;           // 0-100 — trend strength regardless of direction
  plusDI: number;         // +DI — bullish directional index
  minusDI: number;       // -DI — bearish directional index
  trendStrength: "strong" | "moderate" | "weak" | "no_trend";
  diCross: "bullish" | "bearish" | "none"; // recent DI crossover
  interpretation: string;
};

export type StochRSIData = {
  k: number;             // %K (fast stochastic of RSI)
  d: number;             // %D (3-period SMA of %K)
  zone: "overbought" | "oversold" | "neutral";
  crossover: "bullish" | "bearish" | "none";
  interpretation: string;
};

export type CVDData = {
  current: number;       // current cumulative volume delta
  trend: "accumulation" | "distribution" | "neutral";
  divergenceWithPrice: boolean;
  divergenceType: "bullish" | "bearish" | null;
  interpretation: string;
};

export type OrderBookData = {
  bidDepth1pct: number;  // total bid volume within 1% of price
  askDepth1pct: number;  // total ask volume within 1% of price
  bidDepth2pct: number;
  askDepth2pct: number;
  imbalanceRatio1pct: number; // bid/ask ratio (>1 = buy wall, <1 = sell wall)
  imbalanceRatio2pct: number;
  largestBidWall: { price: number; size: number } | null;
  largestAskWall: { price: number; size: number } | null;
  signal: "buy_wall" | "sell_wall" | "balanced";
  interpretation: string;
};

export type LiquidationData = {
  longLiqClusters: Array<{ price: number; leverage: string; intensity: "high" | "medium" }>;
  shortLiqClusters: Array<{ price: number; leverage: string; intensity: "high" | "medium" }>;
  nearestLongLiq: number | null;  // nearest price where longs get liquidated (below)
  nearestShortLiq: number | null; // nearest price where shorts get liquidated (above)
  magnetDirection: "up" | "down" | "balanced";
  interpretation: string;
};

export type AnchoredVWAPData = {
  swingLowVwap: number | null;   // VWAP anchored to recent swing low
  swingHighVwap: number | null;  // VWAP anchored to recent swing high
  anchorType: "swing_low" | "swing_high"; // which anchor is more relevant
  distance: number;              // % from relevant anchored VWAP
  interpretation: string;
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
  // V3 indicators
  volumeProfileData: VolumeProfileData | null;
  ichimoku: IchimokuData | null;
  adx: ADXData | null;
  stochRsi: StochRSIData | null;
  cvd: CVDData | null;
  orderBook: OrderBookData | null;
  liquidations: LiquidationData | null;
  anchoredVwap: AnchoredVWAPData | null;
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

// ─── Volume Profile (POC / VAH / VAL) ──────────────────────────────────────

function computeVolumeProfile(candles: Candle[], currentPrice: number, numBins: number = 50): VolumeProfileData | null {
  if (candles.length < 20) return null;

  const allHighs = candles.map((c) => c.high);
  const allLows = candles.map((c) => c.low);
  const rangeHigh = Math.max(...allHighs);
  const rangeLow = Math.min(...allLows);
  const binSize = (rangeHigh - rangeLow) / numBins;
  if (binSize <= 0) return null;

  // Build histogram: distribute each candle's volume across the price bins it touches
  const bins = new Array(numBins).fill(0);
  const binPrices = new Array(numBins).fill(0).map((_, i) => rangeLow + binSize * (i + 0.5));

  for (const c of candles) {
    const lowBin = Math.max(0, Math.floor((c.low - rangeLow) / binSize));
    const highBin = Math.min(numBins - 1, Math.floor((c.high - rangeLow) / binSize));
    const spread = highBin - lowBin + 1;
    const volPerBin = c.volume / spread;
    for (let b = lowBin; b <= highBin; b++) bins[b] += volPerBin;
  }

  // POC = bin with max volume
  let pocIdx = 0;
  let maxVol = 0;
  for (let i = 0; i < numBins; i++) {
    if (bins[i] > maxVol) { maxVol = bins[i]; pocIdx = i; }
  }
  const poc = binPrices[pocIdx];

  // Value Area: expand from POC until 70% of total volume is captured
  const totalVol = bins.reduce((s, v) => s + v, 0);
  const vaTarget = totalVol * 0.70;
  let vaVol = bins[pocIdx];
  let vaLow = pocIdx;
  let vaHigh = pocIdx;

  while (vaVol < vaTarget && (vaLow > 0 || vaHigh < numBins - 1)) {
    const addBelow = vaLow > 0 ? bins[vaLow - 1] : 0;
    const addAbove = vaHigh < numBins - 1 ? bins[vaHigh + 1] : 0;
    if (addBelow >= addAbove && vaLow > 0) {
      vaLow--;
      vaVol += bins[vaLow];
    } else if (vaHigh < numBins - 1) {
      vaHigh++;
      vaVol += bins[vaHigh];
    } else {
      break;
    }
  }

  const vah = binPrices[vaHigh] + binSize / 2;
  const val = binPrices[vaLow] - binSize / 2;
  const pocDist = poc > 0 ? ((currentPrice - poc) / poc) * 100 : 0;
  const priceVsPoc: VolumeProfileData["priceVsPoc"] =
    pocDist > 0.3 ? "above" : pocDist < -0.3 ? "below" : "at";

  let interpretation: string;
  if (priceVsPoc === "at") {
    interpretation = `Price at Point of Control ($${poc.toFixed(2)}) — fair value zone, expect mean reversion`;
  } else if (currentPrice > vah) {
    interpretation = `Price above Value Area High ($${vah.toFixed(2)}) — extended, may revert to POC $${poc.toFixed(2)}`;
  } else if (currentPrice < val) {
    interpretation = `Price below Value Area Low ($${val.toFixed(2)}) — oversold vs volume profile, potential snap to POC $${poc.toFixed(2)}`;
  } else if (priceVsPoc === "above") {
    interpretation = `Price in upper Value Area, above POC $${poc.toFixed(2)} — slight bullish positioning`;
  } else {
    interpretation = `Price in lower Value Area, below POC $${poc.toFixed(2)} — slight bearish positioning`;
  }

  return {
    poc: Math.round(poc * 100) / 100,
    vah: Math.round(vah * 100) / 100,
    val: Math.round(val * 100) / 100,
    priceVsPoc,
    pocDistance: Math.round(pocDist * 100) / 100,
    interpretation,
  };
}

// ─── Ichimoku Cloud ────────────────────────────────────────────────────────

function midpoint(candles: Candle[], period: number): number {
  const slice = candles.slice(-period);
  if (!slice.length) return 0;
  const high = Math.max(...slice.map((c) => c.high));
  const low = Math.min(...slice.map((c) => c.low));
  return (high + low) / 2;
}

function computeIchimoku(candles: Candle[], currentPrice: number): IchimokuData | null {
  if (candles.length < 52) return null;

  const tenkan = midpoint(candles, 9);                   // Conversion line
  const kijun = midpoint(candles, 26);                   // Base line
  const senkouA = (tenkan + kijun) / 2;                  // Leading Span A (current, not shifted for display)
  const senkouB = midpoint(candles, 52);                  // Leading Span B
  const chikou = candles[candles.length - 1].close;       // Current close (would be plotted 26 bars back)

  const cloudTop = Math.max(senkouA, senkouB);
  const cloudBottom = Math.min(senkouA, senkouB);
  const cloudColor: IchimokuData["cloudColor"] = senkouA >= senkouB ? "green" : "red";
  const priceVsCloud: IchimokuData["priceVsCloud"] =
    currentPrice > cloudTop ? "above" : currentPrice < cloudBottom ? "below" : "in";

  // TK Cross: compare current vs 1 candle ago
  const prevTenkan = midpoint(candles.slice(0, -1), 9);
  const prevKijun = midpoint(candles.slice(0, -1), 26);
  let tkCross: IchimokuData["tkCross"] = "none";
  if (prevTenkan <= prevKijun && tenkan > kijun) tkCross = "bullish";
  if (prevTenkan >= prevKijun && tenkan < kijun) tkCross = "bearish";

  // Cloud twist: Senkou A crossed Senkou B in last 5 candles
  let cloudTwist = false;
  for (let i = Math.max(0, candles.length - 5); i < candles.length; i++) {
    const slice = candles.slice(0, i + 1);
    if (slice.length < 52) continue;
    const prevA = (midpoint(slice.slice(0, -1), 9) + midpoint(slice.slice(0, -1), 26)) / 2;
    const prevB = midpoint(slice.slice(0, -1), 52);
    const curA = (midpoint(slice, 9) + midpoint(slice, 26)) / 2;
    const curB = midpoint(slice, 52);
    if ((prevA <= prevB && curA > curB) || (prevA >= prevB && curA < curB)) {
      cloudTwist = true;
      break;
    }
  }

  // Overall signal
  let signal: IchimokuData["signal"];
  if (priceVsCloud === "above" && cloudColor === "green" && tkCross === "bullish") {
    signal = "strong_bullish";
  } else if (priceVsCloud === "above" && (cloudColor === "green" || tenkan > kijun)) {
    signal = "bullish";
  } else if (priceVsCloud === "below" && cloudColor === "red" && tkCross === "bearish") {
    signal = "strong_bearish";
  } else if (priceVsCloud === "below" && (cloudColor === "red" || tenkan < kijun)) {
    signal = "bearish";
  } else {
    signal = "neutral";
  }

  const interpretation = [
    `Price ${priceVsCloud} ${cloudColor} cloud`,
    `Tenkan ${tenkan > kijun ? ">" : "<"} Kijun`,
    tkCross !== "none" ? `TK ${tkCross} cross` : null,
    cloudTwist ? "Cloud twist detected — trend change signal" : null,
  ].filter(Boolean).join(" | ");

  return {
    tenkan: Math.round(tenkan * 100) / 100,
    kijun: Math.round(kijun * 100) / 100,
    senkouA: Math.round(senkouA * 100) / 100,
    senkouB: Math.round(senkouB * 100) / 100,
    chikou: Math.round(chikou * 100) / 100,
    cloudColor,
    priceVsCloud,
    tkCross,
    cloudTwist,
    signal,
    interpretation,
  };
}

// ─── ADX (Average Directional Index) ───────────────────────────────────────

function computeADX(candles: Candle[], period: number = 14): ADXData | null {
  if (candles.length < period * 2 + 1) return null;

  // Compute +DM, -DM, TR series
  const plusDMs: number[] = [];
  const minusDMs: number[] = [];
  const trs: number[] = [];

  for (let i = 1; i < candles.length; i++) {
    const upMove = candles[i].high - candles[i - 1].high;
    const downMove = candles[i - 1].low - candles[i].low;
    plusDMs.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDMs.push(downMove > upMove && downMove > 0 ? downMove : 0);
    trs.push(Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close),
    ));
  }

  // Wilder smoothing: first value = sum of first `period` values, then smooth
  function wilderSmooth(arr: number[]): number[] {
    if (arr.length < period) return [];
    const result: number[] = [];
    let sum = 0;
    for (let i = 0; i < period; i++) sum += arr[i];
    result.push(sum);
    for (let i = period; i < arr.length; i++) {
      result.push(result[result.length - 1] - result[result.length - 1] / period + arr[i]);
    }
    return result;
  }

  const smoothPlusDM = wilderSmooth(plusDMs);
  const smoothMinusDM = wilderSmooth(minusDMs);
  const smoothTR = wilderSmooth(trs);

  if (!smoothPlusDM.length || !smoothTR.length) return null;

  // DI+ and DI- series
  const plusDISeries = smoothPlusDM.map((v, i) => smoothTR[i] > 0 ? (v / smoothTR[i]) * 100 : 0);
  const minusDISeries = smoothMinusDM.map((v, i) => smoothTR[i] > 0 ? (v / smoothTR[i]) * 100 : 0);

  // DX series
  const dxSeries = plusDISeries.map((pdi, i) => {
    const sum = pdi + minusDISeries[i];
    return sum > 0 ? (Math.abs(pdi - minusDISeries[i]) / sum) * 100 : 0;
  });

  // ADX = Wilder smoothed DX
  if (dxSeries.length < period) return null;
  let adx = dxSeries.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < dxSeries.length; i++) {
    adx = (adx * (period - 1) + dxSeries[i]) / period;
  }

  const plusDI = plusDISeries[plusDISeries.length - 1];
  const minusDI = minusDISeries[minusDISeries.length - 1];

  const trendStrength: ADXData["trendStrength"] =
    adx >= 40 ? "strong" : adx >= 25 ? "moderate" : adx >= 15 ? "weak" : "no_trend";

  // DI crossover (last 3 bars)
  let diCross: ADXData["diCross"] = "none";
  if (plusDISeries.length >= 2 && minusDISeries.length >= 2) {
    const prevPlus = plusDISeries[plusDISeries.length - 2];
    const prevMinus = minusDISeries[minusDISeries.length - 2];
    if (prevPlus <= prevMinus && plusDI > minusDI) diCross = "bullish";
    if (prevPlus >= prevMinus && plusDI < minusDI) diCross = "bearish";
  }

  const interpretation = [
    `ADX ${adx.toFixed(1)} — ${trendStrength.replace("_", " ")} trend`,
    `+DI ${plusDI.toFixed(1)} / -DI ${minusDI.toFixed(1)}`,
    diCross !== "none" ? `${diCross} DI crossover` : null,
  ].filter(Boolean).join(" | ");

  return {
    adx: Math.round(adx * 10) / 10,
    plusDI: Math.round(plusDI * 10) / 10,
    minusDI: Math.round(minusDI * 10) / 10,
    trendStrength,
    diCross,
    interpretation,
  };
}

// ─── Stochastic RSI ────────────────────────────────────────────────────────

function computeStochRSI(rsiSeries: number[], kPeriod: number = 14, dPeriod: number = 3): StochRSIData | null {
  if (rsiSeries.length < kPeriod + dPeriod) return null;

  // Stochastic of RSI: %K = (RSI - RSI_Low) / (RSI_High - RSI_Low)
  const kValues: number[] = [];
  for (let i = kPeriod - 1; i < rsiSeries.length; i++) {
    const window = rsiSeries.slice(i - kPeriod + 1, i + 1);
    const high = Math.max(...window);
    const low = Math.min(...window);
    const range = high - low;
    kValues.push(range > 0 ? ((rsiSeries[i] - low) / range) * 100 : 50);
  }

  // %D = SMA of %K
  const dValues: number[] = [];
  for (let i = dPeriod - 1; i < kValues.length; i++) {
    const sum = kValues.slice(i - dPeriod + 1, i + 1).reduce((s, v) => s + v, 0);
    dValues.push(sum / dPeriod);
  }

  const k = kValues[kValues.length - 1];
  const d = dValues[dValues.length - 1];

  const zone: StochRSIData["zone"] = k >= 80 ? "overbought" : k <= 20 ? "oversold" : "neutral";

  // Crossover: %K crosses %D
  let crossover: StochRSIData["crossover"] = "none";
  if (kValues.length >= 2 && dValues.length >= 2) {
    const prevK = kValues[kValues.length - 2];
    const prevD = dValues[dValues.length - 2];
    if (prevK <= prevD && k > d) crossover = "bullish";
    if (prevK >= prevD && k < d) crossover = "bearish";
  }

  const interpretation = [
    `StochRSI %K ${k.toFixed(1)} / %D ${d.toFixed(1)}`,
    zone !== "neutral" ? zone : null,
    crossover !== "none" ? `${crossover} crossover` : null,
  ].filter(Boolean).join(" — ");

  return {
    k: Math.round(k * 10) / 10,
    d: Math.round(d * 10) / 10,
    zone,
    crossover,
    interpretation,
  };
}

// ─── CVD (Cumulative Volume Delta) ─────────────────────────────────────────
// Approximated from candle data: split volume into buy/sell using
// (close - open) / (high - low) ratio. This is the standard approximation
// when tick-level data isn't available.

function computeCVD(candles: Candle[], currentPrice: number): CVDData | null {
  if (candles.length < 20) return null;

  const deltaValues: number[] = [];
  const cvdValues: number[] = [];
  let cumDelta = 0;

  for (const c of candles) {
    const range = c.high - c.low;
    // Buy ratio: how much of the candle body is bullish
    const buyRatio = range > 0 ? (c.close - c.low) / range : 0.5;
    const buyVol = c.volume * buyRatio;
    const sellVol = c.volume * (1 - buyRatio);
    const delta = buyVol - sellVol;
    deltaValues.push(delta);
    cumDelta += delta;
    cvdValues.push(cumDelta);
  }

  // Trend: compare last 10 CVD values to prior 10
  const recentCVD = cvdValues.slice(-10);
  const priorCVD = cvdValues.slice(-20, -10);
  const recentAvg = recentCVD.reduce((s, v) => s + v, 0) / recentCVD.length;
  const priorAvg = priorCVD.reduce((s, v) => s + v, 0) / priorCVD.length;

  const trend: CVDData["trend"] =
    recentAvg > priorAvg * 1.1 ? "accumulation" :
    recentAvg < priorAvg * 0.9 ? "distribution" : "neutral";

  // Divergence: price direction vs CVD direction over last 20 candles
  const priceChange = candles[candles.length - 1].close - candles[candles.length - 20].close;
  const cvdChange = cvdValues[cvdValues.length - 1] - cvdValues[cvdValues.length - 20];
  const divergenceWithPrice = (priceChange > 0 && cvdChange < 0) || (priceChange < 0 && cvdChange > 0);
  const divergenceType: CVDData["divergenceType"] =
    priceChange > 0 && cvdChange < 0 ? "bearish" :
    priceChange < 0 && cvdChange > 0 ? "bullish" : null;

  let interpretation: string;
  if (divergenceWithPrice && divergenceType === "bullish") {
    interpretation = `CVD bullish divergence — price falling but buy pressure building (smart money accumulating)`;
  } else if (divergenceWithPrice && divergenceType === "bearish") {
    interpretation = `CVD bearish divergence — price rising but sell pressure dominant (distribution)`;
  } else if (trend === "accumulation") {
    interpretation = `CVD trending up — net buying pressure, accumulation phase`;
  } else if (trend === "distribution") {
    interpretation = `CVD trending down — net selling pressure, distribution phase`;
  } else {
    interpretation = `CVD neutral — balanced buying and selling pressure`;
  }

  return {
    current: Math.round(cumDelta),
    trend,
    divergenceWithPrice,
    divergenceType,
    interpretation,
  };
}

// ─── Order Book Depth (Binance Spot) ───────────────────────────────────────

async function fetchOrderBookDepth(symbol: string, currentPrice: number): Promise<OrderBookData | null> {
  try {
    const res = await fetch(
      `https://api.binance.com/api/v3/depth?symbol=${symbol}&limit=100`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return null;
    const data = await res.json() as { bids: string[][]; asks: string[][] };

    const bids = data.bids.map((b) => ({ price: Number(b[0]), qty: Number(b[1]) }));
    const asks = data.asks.map((a) => ({ price: Number(a[0]), qty: Number(a[1]) }));

    // Aggregate volume within 1% and 2% of current price
    const within = (entries: typeof bids, pctRange: number) =>
      entries
        .filter((e) => Math.abs((e.price - currentPrice) / currentPrice) <= pctRange / 100)
        .reduce((sum, e) => sum + e.qty * e.price, 0); // volume in USD

    const bidDepth1pct = within(bids, 1);
    const askDepth1pct = within(asks, 1);
    const bidDepth2pct = within(bids, 2);
    const askDepth2pct = within(asks, 2);

    const imbalanceRatio1pct = askDepth1pct > 0 ? bidDepth1pct / askDepth1pct : 1;
    const imbalanceRatio2pct = askDepth2pct > 0 ? bidDepth2pct / askDepth2pct : 1;

    // Detect largest walls
    const largestBid = bids.length ? bids.reduce((max, b) => b.qty > max.qty ? b : max, bids[0]) : null;
    const largestAsk = asks.length ? asks.reduce((max, a) => a.qty > max.qty ? a : max, asks[0]) : null;

    const signal: OrderBookData["signal"] =
      imbalanceRatio1pct > 1.8 ? "buy_wall" :
      imbalanceRatio1pct < 0.55 ? "sell_wall" : "balanced";

    let interpretation: string;
    if (signal === "buy_wall") {
      interpretation = `Order book bid-heavy (${imbalanceRatio1pct.toFixed(2)}:1 within 1%) — strong buy support, shorts may be trapped`;
    } else if (signal === "sell_wall") {
      interpretation = `Order book ask-heavy (1:${(1 / imbalanceRatio1pct).toFixed(2)} within 1%) — overhead supply, longs face resistance`;
    } else {
      interpretation = `Order book balanced (${imbalanceRatio1pct.toFixed(2)}:1 within 1%) — no strong directional pressure from depth`;
    }

    return {
      bidDepth1pct: Math.round(bidDepth1pct),
      askDepth1pct: Math.round(askDepth1pct),
      bidDepth2pct: Math.round(bidDepth2pct),
      askDepth2pct: Math.round(askDepth2pct),
      imbalanceRatio1pct: Math.round(imbalanceRatio1pct * 100) / 100,
      imbalanceRatio2pct: Math.round(imbalanceRatio2pct * 100) / 100,
      largestBidWall: largestBid ? { price: largestBid.price, size: Math.round(largestBid.qty * largestBid.price) } : null,
      largestAskWall: largestAsk ? { price: largestAsk.price, size: Math.round(largestAsk.qty * largestAsk.price) } : null,
      signal,
      interpretation,
    };
  } catch {
    return null;
  }
}

// ─── Liquidation Level Estimation ──────────────────────────────────────────
// Estimates where cascading liquidations sit based on current price
// and common leverage levels. Markets tend to hunt these clusters.

function estimateLiquidationLevels(
  currentPrice: number,
  openInterest: OpenInterestData | null,
  longShort: LongShortData | null,
): LiquidationData {
  // Common leverage tiers and their approximate maintenance margin %
  const leverageTiers: Array<{ leverage: string; factor: number; intensity: "high" | "medium" }> = [
    { leverage: "50x", factor: 0.02, intensity: "high" },   // 2% move = liquidation
    { leverage: "25x", factor: 0.04, intensity: "high" },   // 4% move
    { leverage: "20x", factor: 0.05, intensity: "high" },   // 5% move
    { leverage: "10x", factor: 0.10, intensity: "medium" }, // 10% move
    { leverage: "5x",  factor: 0.20, intensity: "medium" }, // 20% move
  ];

  // Long liquidations = below current price
  const longLiqClusters = leverageTiers.map((t) => ({
    price: Math.round(currentPrice * (1 - t.factor) * 100) / 100,
    leverage: t.leverage,
    intensity: t.intensity,
  }));

  // Short liquidations = above current price
  const shortLiqClusters = leverageTiers.map((t) => ({
    price: Math.round(currentPrice * (1 + t.factor) * 100) / 100,
    leverage: t.leverage,
    intensity: t.intensity,
  }));

  const nearestLongLiq = longLiqClusters[0]?.price ?? null;
  const nearestShortLiq = shortLiqClusters[0]?.price ?? null;

  // Which direction has more liquidation potential?
  // If retail is crowded long → long liquidations are juicier targets (price goes down)
  // If retail is crowded short → short liquidations are juicier (price goes up)
  let magnetDirection: LiquidationData["magnetDirection"] = "balanced";
  let interpretation: string;

  if (longShort) {
    if (longShort.retailBias === "long_heavy") {
      magnetDirection = "down";
      interpretation = `Retail ${longShort.globalLongPct.toFixed(0)}% long — long liquidation clusters below ($${nearestLongLiq?.toFixed(0)}) are magnet targets`;
    } else if (longShort.retailBias === "short_heavy") {
      magnetDirection = "up";
      interpretation = `Retail ${longShort.globalShortPct.toFixed(0)}% short — short liquidation clusters above ($${nearestShortLiq?.toFixed(0)}) are magnet targets`;
    } else {
      interpretation = `Balanced positioning — liquidation clusters symmetric. Nearest: long liq $${nearestLongLiq?.toFixed(0)} / short liq $${nearestShortLiq?.toFixed(0)}`;
    }
  } else {
    interpretation = `Liquidation estimates: long cascade below $${nearestLongLiq?.toFixed(0)} (50x), short cascade above $${nearestShortLiq?.toFixed(0)} (50x)`;
  }

  return {
    longLiqClusters,
    shortLiqClusters,
    nearestLongLiq,
    nearestShortLiq,
    magnetDirection,
    interpretation,
  };
}

// ─── Anchored VWAP ─────────────────────────────────────────────────────────
// Anchors VWAP to the most recent significant swing point instead of a
// rolling window. This gives institutional-quality mean reversion levels.

function computeAnchoredVWAP(
  candles: Candle[],
  swingPoints: SwingPoint[],
  currentPrice: number,
  structure: MarketStructure,
): AnchoredVWAPData | null {
  if (!swingPoints.length || candles.length < 10) return null;

  function vwapFromIndex(startIdx: number): number {
    let cumTypicalVol = 0;
    let cumVol = 0;
    for (let i = startIdx; i < candles.length; i++) {
      const typical = (candles[i].high + candles[i].low + candles[i].close) / 3;
      cumTypicalVol += typical * candles[i].volume;
      cumVol += candles[i].volume;
    }
    return cumVol > 0 ? cumTypicalVol / cumVol : currentPrice;
  }

  // Find most recent swing low and swing high
  const recentLows = swingPoints.filter((s) => s.type === "low").slice(-3);
  const recentHighs = swingPoints.filter((s) => s.type === "high").slice(-3);

  const lastSwingLow = recentLows.length ? recentLows[recentLows.length - 1] : null;
  const lastSwingHigh = recentHighs.length ? recentHighs[recentHighs.length - 1] : null;

  const swingLowVwap = lastSwingLow ? Math.round(vwapFromIndex(lastSwingLow.index) * 100) / 100 : null;
  const swingHighVwap = lastSwingHigh ? Math.round(vwapFromIndex(lastSwingHigh.index) * 100) / 100 : null;

  // In uptrend, anchor to swing low (support VWAP); in downtrend, anchor to swing high
  const anchorType: AnchoredVWAPData["anchorType"] =
    structure === "downtrend" ? "swing_high" : "swing_low";
  const relevantVwap = anchorType === "swing_low" ? swingLowVwap : swingHighVwap;
  const distance = relevantVwap && relevantVwap > 0
    ? Math.round(((currentPrice - relevantVwap) / relevantVwap) * 10000) / 100
    : 0;

  let interpretation: string;
  if (relevantVwap) {
    if (Math.abs(distance) < 0.5) {
      interpretation = `Price at anchored VWAP ($${relevantVwap.toFixed(2)}) from ${anchorType.replace("_", " ")} — institutional mean reversion magnet`;
    } else if (distance > 2) {
      interpretation = `Price +${distance.toFixed(2)}% above anchored VWAP ($${relevantVwap.toFixed(2)}) — extended, watch for pullback to VWAP`;
    } else if (distance < -2) {
      interpretation = `Price ${distance.toFixed(2)}% below anchored VWAP ($${relevantVwap.toFixed(2)}) — oversold vs institutional reference`;
    } else {
      interpretation = `Price ${distance > 0 ? "+" : ""}${distance.toFixed(2)}% from anchored VWAP ($${relevantVwap.toFixed(2)})`;
    }
  } else {
    interpretation = "Anchored VWAP unavailable — insufficient swing data";
  }

  return {
    swingLowVwap,
    swingHighVwap,
    anchorType,
    distance,
    interpretation,
  };
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
  // V3
  volumeProfileData: VolumeProfileData | null;
  ichimoku: IchimokuData | null;
  adx: ADXData | null;
  stochRsi: StochRSIData | null;
  cvd: CVDData | null;
  orderBook: OrderBookData | null;
  liquidations: LiquidationData | null;
  anchoredVwap: AnchoredVWAPData | null;
}): ComputedVerdict {
  const {
    htfStructure, trendStrength, ema, macd, bollinger, rsi, rsiDiv,
    multiTfRsiAlignment, obv, volProfile, vwapDist, nearSupport,
    nearResistance, regime, funding, fearGreed, openInterest, longShort,
    takerRatio, currentPrice: price, riskReward,
    volumeProfileData, ichimoku, adx, stochRsi, cvd, orderBook,
    liquidations, anchoredVwap,
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

  // ── 17. Ichimoku Cloud (weight: 0.07) ──
  if (ichimoku) {
    const w = 0.07;
    if (ichimoku.signal === "strong_bullish") {
      votes.push({ name: "Ichimoku", direction: "bullish", weight: w, conviction: 0.9, reason: `Price above green cloud + bullish TK cross — ${ichimoku.interpretation}` });
    } else if (ichimoku.signal === "bullish") {
      votes.push({ name: "Ichimoku", direction: "bullish", weight: w, conviction: 0.65, reason: ichimoku.interpretation });
    } else if (ichimoku.signal === "strong_bearish") {
      votes.push({ name: "Ichimoku", direction: "bearish", weight: w, conviction: 0.9, reason: `Price below red cloud + bearish TK cross — ${ichimoku.interpretation}` });
    } else if (ichimoku.signal === "bearish") {
      votes.push({ name: "Ichimoku", direction: "bearish", weight: w, conviction: 0.65, reason: ichimoku.interpretation });
    } else {
      votes.push({ name: "Ichimoku", direction: "neutral", weight: w, conviction: 0.3, reason: `Price in cloud — no directional edge` });
    }
    if (ichimoku.cloudTwist) {
      // Cloud twist is a leading reversal signal — add bonus conviction to last vote
      votes[votes.length - 1].conviction = Math.min(1, votes[votes.length - 1].conviction + 0.15);
    }
  }

  // ── 18. ADX (weight: 0.05) ──
  if (adx) {
    const w = 0.05;
    if (adx.diCross === "bullish" && adx.adx >= 20) {
      votes.push({ name: "ADX", direction: "bullish", weight: w, conviction: 0.75, reason: `Bullish DI crossover with ADX ${adx.adx.toFixed(0)} — trend initiating` });
    } else if (adx.diCross === "bearish" && adx.adx >= 20) {
      votes.push({ name: "ADX", direction: "bearish", weight: w, conviction: 0.75, reason: `Bearish DI crossover with ADX ${adx.adx.toFixed(0)} — trend initiating` });
    } else if (adx.trendStrength === "strong") {
      const dir = adx.plusDI > adx.minusDI ? "bullish" as const : "bearish" as const;
      votes.push({ name: "ADX", direction: dir, weight: w, conviction: 0.7, reason: `ADX ${adx.adx.toFixed(0)} — strong ${dir} trend (+DI ${adx.plusDI.toFixed(0)} / -DI ${adx.minusDI.toFixed(0)})` });
    } else if (adx.trendStrength === "moderate") {
      const dir = adx.plusDI > adx.minusDI ? "bullish" as const : "bearish" as const;
      votes.push({ name: "ADX", direction: dir, weight: w, conviction: 0.5, reason: `ADX ${adx.adx.toFixed(0)} — moderate trend` });
    } else {
      votes.push({ name: "ADX", direction: "neutral", weight: w, conviction: 0.2, reason: `ADX ${adx.adx.toFixed(0)} — no significant trend` });
    }
  }

  // ── 19. Stochastic RSI (weight: 0.04) ──
  if (stochRsi) {
    const w = 0.04;
    if (stochRsi.zone === "oversold" && stochRsi.crossover === "bullish") {
      votes.push({ name: "StochRSI", direction: "bullish", weight: w, conviction: 0.85, reason: `StochRSI bullish cross from oversold (%K ${stochRsi.k.toFixed(0)}) — high-probability bounce` });
    } else if (stochRsi.zone === "overbought" && stochRsi.crossover === "bearish") {
      votes.push({ name: "StochRSI", direction: "bearish", weight: w, conviction: 0.85, reason: `StochRSI bearish cross from overbought (%K ${stochRsi.k.toFixed(0)}) — pullback likely` });
    } else if (stochRsi.zone === "oversold") {
      votes.push({ name: "StochRSI", direction: "bullish", weight: w, conviction: 0.55, reason: `StochRSI oversold (%K ${stochRsi.k.toFixed(0)}) — bounce setup` });
    } else if (stochRsi.zone === "overbought") {
      votes.push({ name: "StochRSI", direction: "bearish", weight: w, conviction: 0.55, reason: `StochRSI overbought (%K ${stochRsi.k.toFixed(0)}) — exhaustion risk` });
    } else {
      votes.push({ name: "StochRSI", direction: "neutral", weight: w, conviction: 0.2, reason: `StochRSI neutral (%K ${stochRsi.k.toFixed(0)})` });
    }
  }

  // ── 20. CVD (weight: 0.06) ──
  if (cvd) {
    const w = 0.06;
    if (cvd.divergenceWithPrice && cvd.divergenceType === "bullish") {
      votes.push({ name: "CVD", direction: "bullish", weight: w + 0.02, conviction: 0.85, reason: cvd.interpretation });
    } else if (cvd.divergenceWithPrice && cvd.divergenceType === "bearish") {
      votes.push({ name: "CVD", direction: "bearish", weight: w + 0.02, conviction: 0.85, reason: cvd.interpretation });
    } else if (cvd.trend === "accumulation") {
      votes.push({ name: "CVD", direction: "bullish", weight: w, conviction: 0.6, reason: cvd.interpretation });
    } else if (cvd.trend === "distribution") {
      votes.push({ name: "CVD", direction: "bearish", weight: w, conviction: 0.6, reason: cvd.interpretation });
    } else {
      votes.push({ name: "CVD", direction: "neutral", weight: w, conviction: 0.2, reason: cvd.interpretation });
    }
  }

  // ── 21. Volume Profile POC (weight: 0.05) ──
  if (volumeProfileData) {
    const w = 0.05;
    if (volumeProfileData.priceVsPoc === "above" && volumeProfileData.pocDistance > 1) {
      votes.push({ name: "Volume POC", direction: "bullish", weight: w, conviction: 0.55, reason: `Price above POC ($${volumeProfileData.poc.toFixed(2)}) — holding above fair value` });
    } else if (volumeProfileData.priceVsPoc === "below" && volumeProfileData.pocDistance < -1) {
      votes.push({ name: "Volume POC", direction: "bearish", weight: w, conviction: 0.55, reason: `Price below POC ($${volumeProfileData.poc.toFixed(2)}) — trading below fair value` });
    } else {
      votes.push({ name: "Volume POC", direction: "neutral", weight: w, conviction: 0.4, reason: `Price at POC ($${volumeProfileData.poc.toFixed(2)}) — mean reversion zone` });
    }
  }

  // ── 22. Order Book (weight: 0.05) ──
  if (orderBook) {
    const w = 0.05;
    if (orderBook.signal === "buy_wall") {
      votes.push({ name: "Order Book", direction: "bullish", weight: w, conviction: 0.7, reason: orderBook.interpretation });
    } else if (orderBook.signal === "sell_wall") {
      votes.push({ name: "Order Book", direction: "bearish", weight: w, conviction: 0.7, reason: orderBook.interpretation });
    } else {
      votes.push({ name: "Order Book", direction: "neutral", weight: w, conviction: 0.2, reason: orderBook.interpretation });
    }
  }

  // ── 23. Liquidation Magnet (weight: 0.04) ──
  if (liquidations) {
    const w = 0.04;
    if (liquidations.magnetDirection === "down") {
      votes.push({ name: "Liq Magnet", direction: "bearish", weight: w, conviction: 0.6, reason: liquidations.interpretation });
    } else if (liquidations.magnetDirection === "up") {
      votes.push({ name: "Liq Magnet", direction: "bullish", weight: w, conviction: 0.6, reason: liquidations.interpretation });
    } else {
      votes.push({ name: "Liq Magnet", direction: "neutral", weight: w, conviction: 0.2, reason: liquidations.interpretation });
    }
  }

  // ── 24. Anchored VWAP (weight: 0.04) ──
  if (anchoredVwap) {
    const w = 0.04;
    if (anchoredVwap.distance > 2) {
      votes.push({ name: "Anchored VWAP", direction: "bearish", weight: w, conviction: 0.5, reason: `Extended above anchored VWAP — mean reversion risk` });
    } else if (anchoredVwap.distance < -2) {
      votes.push({ name: "Anchored VWAP", direction: "bullish", weight: w, conviction: 0.5, reason: `Below anchored VWAP — snap-back potential` });
    } else if (anchoredVwap.distance > 0) {
      votes.push({ name: "Anchored VWAP", direction: "bullish", weight: w, conviction: 0.4, reason: `Above anchored VWAP — holding institutional level` });
    } else {
      votes.push({ name: "Anchored VWAP", direction: "bearish", weight: w, conviction: 0.4, reason: `Below anchored VWAP — under institutional selling` });
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

  // V3 indicators
  if (ta.ichimoku) {
    const ichi = ta.ichimoku;
    lines.push(`  Ichimoku: ${ichi.interpretation}`);
    lines.push(`    Tenkan: ${fmtPrice(ichi.tenkan)} | Kijun: ${fmtPrice(ichi.kijun)} | Cloud: ${ichi.cloudColor} (${ichi.priceVsCloud})`);
  }
  if (ta.adx) {
    lines.push(`  ADX: ${ta.adx.interpretation}`);
  }
  if (ta.stochRsi) {
    lines.push(`  StochRSI: ${ta.stochRsi.interpretation}`);
  }
  if (ta.cvd) {
    lines.push(`  CVD: ${ta.cvd.interpretation}`);
  }
  if (ta.volumeProfileData) {
    const vp = ta.volumeProfileData;
    lines.push(`  Volume Profile: POC ${fmtPrice(vp.poc)} | VAH ${fmtPrice(vp.vah)} | VAL ${fmtPrice(vp.val)} — ${vp.interpretation}`);
  }
  if (ta.orderBook) {
    const ob = ta.orderBook;
    lines.push(`  Order Book: Bid depth $${(ob.bidDepth1pct / 1000).toFixed(0)}K / Ask depth $${(ob.askDepth1pct / 1000).toFixed(0)}K within 1% — ${ob.interpretation}`);
  }
  if (ta.anchoredVwap) {
    lines.push(`  Anchored VWAP: ${ta.anchoredVwap.interpretation}`);
  }
  if (ta.liquidations) {
    const liq = ta.liquidations;
    lines.push(`  Liquidation Map: Long cascade below ${liq.nearestLongLiq ? fmtPrice(liq.nearestLongLiq) : "N/A"} | Short cascade above ${liq.nearestShortLiq ? fmtPrice(liq.nearestShortLiq) : "N/A"} — ${liq.interpretation}`);
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

// ─── Market-question awareness ───────────────────────────────────────────────
// The raw TA verdict answers "is the asset bullish or bearish?" — but a prediction
// market asks a specific question ("will X be ABOVE $Y by Z?"). A bullish asset does
// NOT imply a YES resolution when the market asks about a DROP. These helpers map the
// asset-level directional read onto the actual market question.

const UP_KEYWORDS = [
  "above", "over", "exceed", "surpass", "greater than", "more than", "at least",
  "higher than", "higher", "break above", "breakout above", "new high",
  "all-time high", "all time high", "new ath", "rally to", "climb to", "rise to",
  "rise above", "pump to", "moon", ">=", "≥",
  // directional (no-target) phrasings
  "go up", "going up", "trade higher", "close higher", "end higher", "be up",
  "trend up", "gain", "rally", "rise", "increase", "pump", "surge", "spike",
];
const DOWN_KEYWORDS = [
  "below", "under", "beneath", "dip to", "dip below", "dip", "drop to", "drop below",
  "drop", "fall to", "fall below", "fall", "crash", "decline", "less than",
  "lower than", "lower", "break below", "breakdown", "down to", "sink to",
  "<=", "≤",
  // directional (no-target) phrasings
  "go down", "going down", "trade lower", "close lower", "end lower", "be down",
  "trend down", "lose value", "decrease", "dump", "tank", "plunge", "sell off",
  "sell-off", "selloff",
];
const REACH_KEYWORDS = ["reach", "hit", "touch", "tag", "get to", "trade at", "cross", "flip"];

export type CryptoPriceQuestion = {
  isPriceQuestion: boolean;
  yesMeansUp: boolean | null; // null = ambiguous from text alone (resolve vs current price)
  target: number | null;
  comparator: "above" | "below" | "reach" | null;
};

function parseTargetPrice(question: string): number | null {
  const q = question.replace(/,/g, "");
  // Prefer an explicit $-prefixed figure; otherwise require a k/m suffix so we don't
  // accidentally match years ("2025") or ordinals.
  const dollar = q.match(/\$\s?(\d+(?:\.\d+)?)\s*([kKmM])?/);
  const bare = dollar ? null : q.match(/\b(\d+(?:\.\d+)?)\s*([kKmM])\b/);
  const m = dollar ?? bare;
  if (!m) return null;
  let val = parseFloat(m[1]);
  const suffix = (m[2] ?? "").toLowerCase();
  if (suffix === "k") val *= 1_000;
  else if (suffix === "m") val *= 1_000_000;
  return Number.isFinite(val) && val > 0 ? val : null;
}

// Subjects that mention a crypto asset + directional word but are NOT about the
// asset's spot price. Price technicals are irrelevant here → route to the news engine.
const NON_PRICE_SUBJECTS = [
  "gas fee", "gas fees", "tvl", "total value locked", "revenue", "volume",
  "dominance", "supply", "staking", "stake", "hashrate", "hash rate", "etf",
  "approve", "approval", "list", "listing", "delist", "hack", "exploit", "launch",
  "upgrade", "fork", "halving", "unlock", "airdrop", "governance", "lawsuit", "sec ",
];

export function classifyCryptoPriceQuestion(question: string): CryptoPriceQuestion {
  const q = question.toLowerCase();
  const target = parseTargetPrice(question);
  const hasUp = UP_KEYWORDS.some((k) => q.includes(k));
  const hasDown = DOWN_KEYWORDS.some((k) => q.includes(k));
  const hasReach = REACH_KEYWORDS.some((k) => q.includes(k));
  const hasNonPriceSubject = NON_PRICE_SUBJECTS.some((k) => q.includes(k));

  // A price question references a $ target and/or directional threshold language,
  // and is not really about a non-price metric (fees, TVL, ETF approval, etc.).
  const isPriceQuestion = !hasNonPriceSubject && (Boolean(target) || hasUp || hasDown || hasReach);

  let yesMeansUp: boolean | null = null;
  let comparator: "above" | "below" | "reach" | null = null;
  if (hasDown && !hasUp) {
    yesMeansUp = false;
    comparator = "below";
  } else if (hasUp && !hasDown) {
    yesMeansUp = true;
    comparator = "above";
  } else if (hasReach) {
    comparator = "reach"; // resolve up/down vs current price later
  }

  return { isPriceQuestion, yesMeansUp, target, comparator };
}

function daysUntil(endDate?: string): number | null {
  if (!endDate) return null;
  const t = new Date(endDate).getTime();
  if (!Number.isFinite(t)) return null;
  const d = (t - Date.now()) / 86_400_000;
  return d > 0 ? d : null;
}

export type MarketAwareVerdict = {
  verdict: ComputedVerdict; // .direction now answers the MARKET question (not just asset bias)
  taRelevant: boolean;      // false → question isn't about price; TA must not drive the verdict
  polarity: CryptoPriceQuestion;
  mappingNote: string;
  probability: number;      // calibrated P(YES), 0-1
};

// Standard normal CDF (Abramowitz & Stegun 7.1.26) — no external deps.
function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2);
  const p =
    d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}

/**
 * Calibrated P(YES) for a crypto price question, modelling price as a random walk
 * (geometric Brownian motion) over the remaining horizon, with a small directional
 * drift contributed by the technical read. These threshold questions ARE effectively
 * options, so a volatility-based terminal/barrier distribution is the right base rate;
 * the TA signal only tilts it.
 */
function estimateYesProbability(params: {
  price: number;
  target: number | null;
  yesMeansUp: boolean;
  comparator: "above" | "below" | "reach" | null;
  netScore: number;       // -100..100 technical bias
  volatilityPct: number;  // ATR(1h)/price * 100
  days: number;
  regime: Regime;
  signalAgreement: number; // 0-100
}): { pYes: number; sigmaT: number; gapPct: number | null } {
  const { price, target, yesMeansUp, comparator, netScore, volatilityPct, days, regime, signalAgreement } = params;

  // Daily σ from ATR(1h): scale to a day (√24) and convert ATR→stdev (~÷1.2).
  const sigmaDaily = Math.max(0.005, ((volatilityPct || 1) / 100) * Math.sqrt(24) / 1.2);
  let sigmaT = sigmaDaily * Math.sqrt(Math.max(days, 0.25));
  // Widen the distribution when the read is unreliable (volatile regime / low agreement)
  // so we don't over-state conviction.
  if (regime === "volatile") sigmaT *= 1.25;
  if (signalAgreement < 50) sigmaT *= 1.15;
  sigmaT = Math.max(0.01, sigmaT);

  // TA drift as a fraction of horizon σ (bounded): max read tilts ~0.6σ.
  const drift = (Math.max(-100, Math.min(100, netScore)) / 100) * 0.6 * sigmaT;

  // Directional question with no explicit target → P(end higher/lower than now).
  if (!target || price <= 0) {
    const pUp = normCdf(drift / sigmaT); // P(S_T >= S)
    const pYes = yesMeansUp ? pUp : 1 - pUp;
    return { pYes: Math.min(0.95, Math.max(0.05, pYes)), sigmaT, gapPct: null };
  }

  const logK = Math.log(target / price); // >0 if target above current
  // Endpoint probability the terminal price satisfies the threshold.
  const pAbove = normCdf((drift - logK) / sigmaT); // P(S_T >= target)
  let pYes = yesMeansUp ? pAbove : 1 - pAbove;

  // "reach/hit/touch" = barrier-touch any time before T, not just at expiry.
  // Reflection principle: touch prob ≈ 2× endpoint prob (capped), when not yet crossed.
  if (comparator === "reach") {
    const alreadyThere = (yesMeansUp && price >= target) || (!yesMeansUp && price <= target);
    pYes = alreadyThere ? 0.985 : Math.min(0.985, pYes * 2);
  }

  const gapPct = yesMeansUp ? ((target - price) / price) * 100 : ((price - target) / price) * 100;
  return { pYes: Math.min(0.97, Math.max(0.03, pYes)), sigmaT, gapPct };
}

/**
 * Translate the asset-level TA verdict into an answer to the actual market question.
 *
 * Handles three things the raw engine ignores:
 *  1. Polarity — "below/dip/drop" questions invert the YES/NO meaning of a bullish read.
 *  2. Threshold reachability — a far-away strike relative to expected move over the
 *     remaining time makes YES less likely regardless of short-term drift.
 *  3. Relevance — non-price crypto questions (ETF approvals, hacks, listings) should not
 *     be answered by price technicals at all.
 */
export function deriveMarketAwareVerdict(
  ta: TechnicalAnalysis,
  question: string,
  endDate?: string
): MarketAwareVerdict {
  const pq = classifyCryptoPriceQuestion(question);
  const base = ta.verdict;
  const price = ta.currentPrice;

  // Not a price question → technicals are contextual colour only.
  if (!pq.isPriceQuestion) {
    return {
      verdict: base,
      taRelevant: false,
      polarity: pq,
      mappingNote:
        "This is not a direct price-threshold question, so live technicals are contextual only and should not determine the YES/NO verdict.",
      probability: 0.5,
    };
  }

  // Resolve ambiguous polarity (e.g. "reach $X") using target vs current price.
  let yesMeansUp = pq.yesMeansUp;
  if (yesMeansUp === null && pq.target && price > 0) {
    if (pq.target > price * 1.003) yesMeansUp = true;
    else if (pq.target < price * 0.997) yesMeansUp = false;
  }
  const ambiguousPolarity = yesMeansUp === null;
  if (yesMeansUp === null) yesMeansUp = true; // safe default; confidence is capped below

  const netScore = base.netScore; // -100..100, + = bullish asset
  const assetBias: "bullish" | "bearish" | "neutral" =
    netScore > 8 ? "bullish" : netScore < -8 ? "bearish" : "neutral";

  const days = daysUntil(endDate) ?? 7; // default ~1-week horizon when unknown

  // ── Calibrated P(YES) from a volatility-based terminal/barrier model + TA drift ──
  const { pYes, sigmaT, gapPct } = estimateYesProbability({
    price,
    target: pq.target,
    yesMeansUp,
    comparator: pq.comparator,
    netScore,
    volatilityPct: ta.volatilityPct,
    days,
    regime: ta.regime,
    signalAgreement: base.signalAgreement,
  });

  // When we had to guess polarity, pull the estimate toward 50/50.
  const adjustedPYes = ambiguousPolarity ? 0.5 + (pYes - 0.5) * 0.5 : pYes;

  const direction: "YES" | "NO" = adjustedPYes >= 0.5 ? "YES" : "NO";
  // Confidence = probability of the side we're calling (calibrated, not vanity).
  const winningProb = Math.max(adjustedPYes, 1 - adjustedPYes);
  const confidence = Math.max(50, Math.min(95, Math.round(winningProb * 100)));

  const polarityText = ambiguousPolarity
    ? "Question polarity is ambiguous"
    : yesMeansUp
    ? "Market YES requires price to rise to / stay above the target"
    : "Market YES requires price to fall to / stay below the target";
  const distanceNote =
    gapPct !== null && pq.target
      ? ` Target ${pq.target.toLocaleString()} is ${gapPct >= 0 ? gapPct.toFixed(1) + "% away" : Math.abs(gapPct).toFixed(1) + "% already in-the-money"}; horizon σ ≈ ${(sigmaT * 100).toFixed(1)}% over ${days.toFixed(1)}d.`
      : "";
  const mappingNote =
    `${polarityText}. Asset technicals read ${assetBias} (net ${netScore > 0 ? "+" : ""}${netScore.toFixed(0)}). ` +
    `Modelled P(YES) ≈ ${(adjustedPYes * 100).toFixed(0)}%.${distanceNote}`;

  const verdict: ComputedVerdict = {
    ...base,
    direction,
    confidence,
    verdictRationale: `Market-aware verdict: ${direction} (${confidence}% ≈ P(${direction})). ${mappingNote}\n\nUnderlying asset read:\n${base.verdictRationale}`,
  };

  return { verdict, taRelevant: true, polarity: { ...pq, yesMeansUp }, mappingNote, probability: adjustedPYes };
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
    const [oiData, lsData, takerData, orderBookData] = await Promise.all([
      fetchOpenInterest(binanceSymbol, price).catch(() => null),
      fetchLongShortRatio(binanceSymbol).catch(() => null),
      fetchTakerRatio(binanceSymbol).catch(() => null),
      fetchOrderBookDepth(binanceSymbol, price).catch(() => null),
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

    // ─── V3 indicators ───
    const volumeProfileData = computeVolumeProfile(candles1h, price);
    const ichimoku = computeIchimoku(candles1h, price);
    const adxData = computeADX(candles1h);
    const stochRsiData = computeStochRSI(rsiSeries1h);
    const cvdData = computeCVD(candles1h, price);
    const liquidationData = estimateLiquidationLevels(price, oiData, lsData);
    const anchoredVwapData = computeAnchoredVWAP(candles1h, oneHSwings, price, structure);

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
      // V3 signals
      volumeProfileData,
      ichimoku,
      adx: adxData,
      stochRsi: stochRsiData,
      cvd: cvdData,
      orderBook: orderBookData,
      liquidations: liquidationData,
      anchoredVwap: anchoredVwapData,
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
      // V3
      volumeProfileData,
      ichimoku,
      adx: adxData,
      stochRsi: stochRsiData,
      cvd: cvdData,
      orderBook: orderBookData,
      liquidations: liquidationData,
      anchoredVwap: anchoredVwapData,
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
