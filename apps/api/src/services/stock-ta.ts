/**
 * Stock Technical Analysis — real market data for tokenized-stock premium analysis.
 *
 * Fetches 1 year of daily OHLCV from Yahoo Finance (the same upstream the
 * /rwa/quotes endpoint already uses) and computes a deterministic technical
 * read: trend structure vs SMA50/200, RSI, MACD, momentum, 52-week position,
 * realized volatility, and volume trend.
 *
 * The output is shaped as FundamentalSignal[] so it merges directly into the
 * fundamental verdict engine's weighted scoring — the stock verdict then rests
 * on hard price data first and news sentiment second, instead of news alone.
 */

import { buildCacheKey, getJsonCache, setJsonCache } from "./cache.js";
import type { FundamentalSignal } from "./fundamental-engine.js";

type DailyCandle = { close: number; high: number; low: number; volume: number };

export type StockTechnicals = {
  symbol: string;
  price: number;
  sma50: number | null;
  sma200: number | null;
  rsi14: number | null;
  macd: { line: number; signal: number; histogram: number } | null;
  ret1mPct: number | null;
  ret3mPct: number | null;
  realizedVolAnnualPct: number | null;
  high52w: number | null;
  low52w: number | null;
  pctFrom52wHigh: number | null;
  signals: FundamentalSignal[];
  summary: string;
};

async function fetchDailyCandles(symbol: string): Promise<DailyCandle[]> {
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  url.searchParams.set("range", "1y");
  url.searchParams.set("interval", "1d");
  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json", "User-Agent": "Rawli/1.0" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`stock_candles_upstream_${res.status}`);
  const payload = (await res.json()) as any;
  const result = payload?.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0] ?? {};
  const closes: Array<number | null> = quote.close ?? [];
  const highs: Array<number | null> = quote.high ?? [];
  const lows: Array<number | null> = quote.low ?? [];
  const volumes: Array<number | null> = quote.volume ?? [];
  const candles: DailyCandle[] = [];
  for (let i = 0; i < closes.length; i++) {
    const c = Number(closes[i]);
    if (!Number.isFinite(c) || c <= 0) continue;
    candles.push({
      close: c,
      high: Number.isFinite(Number(highs[i])) ? Number(highs[i]) : c,
      low: Number.isFinite(Number(lows[i])) ? Number(lows[i]) : c,
      volume: Number.isFinite(Number(volumes[i])) ? Number(volumes[i]) : 0,
    });
  }
  return candles;
}

function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const window = values.slice(-period);
  return window.reduce((a, b) => a + b, 0) / period;
}

function emaSeries(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const out = [values[0]];
  for (let i = 1; i < values.length; i++) out.push(values[i] * k + out[i - 1] * (1 - k));
  return out;
}

function rsi14(closes: number[]): number | null {
  if (closes.length < 15) return null;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= 14; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) avgGain += d / 14;
    else avgLoss -= d / 14;
  }
  for (let i = 15; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * 13 + Math.max(0, d)) / 14;
    avgLoss = (avgLoss * 13 + Math.max(0, -d)) / 14;
  }
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function macd(closes: number[]): { line: number; signal: number; histogram: number } | null {
  if (closes.length < 35) return null;
  const ema12 = emaSeries(closes, 12);
  const ema26 = emaSeries(closes, 26);
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const signalLine = emaSeries(macdLine.slice(26), 9);
  const line = macdLine[macdLine.length - 1];
  const signal = signalLine[signalLine.length - 1];
  return { line, signal, histogram: line - signal };
}

export async function computeStockTechnicals(symbol: string): Promise<StockTechnicals | null> {
  const normalized = symbol.toUpperCase();
  const cacheKey = buildCacheKey("stock:ta", { symbol: normalized });
  const cached = await getJsonCache<StockTechnicals>(cacheKey);
  if (cached) return cached;

  const candles = await fetchDailyCandles(normalized);
  if (candles.length < 60) return null;
  const closes = candles.map((c) => c.close);
  const price = closes[closes.length - 1];

  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);
  const rsi = rsi14(closes);
  const macdRes = macd(closes);
  const ret1mPct = closes.length > 21 ? ((price - closes[closes.length - 22]) / closes[closes.length - 22]) * 100 : null;
  const ret3mPct = closes.length > 63 ? ((price - closes[closes.length - 64]) / closes[closes.length - 64]) * 100 : null;
  const high52w = Math.max(...candles.map((c) => c.high));
  const low52w = Math.min(...candles.map((c) => c.low));
  const pctFrom52wHigh = high52w > 0 ? ((price - high52w) / high52w) * 100 : null;

  // 20-day close-to-close realized vol, annualized
  let realizedVolAnnualPct: number | null = null;
  if (closes.length > 21) {
    const rets = [];
    for (let i = closes.length - 20; i < closes.length; i++) rets.push(Math.log(closes[i] / closes[i - 1]));
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
    realizedVolAnnualPct = Math.sqrt(variance * 252) * 100;
  }

  // ── Signal votes — direction YES = bullish on the stock ──────────────────
  const signals: FundamentalSignal[] = [];

  if (sma200 !== null && sma50 !== null) {
    const aboveBoth = price > sma200 && sma50 > sma200;
    const belowBoth = price < sma200 && sma50 < sma200;
    signals.push({
      name: "Trend Structure",
      direction: aboveBoth ? "YES" : belowBoth ? "NO" : "neutral",
      weight: 0.2,
      conviction: aboveBoth || belowBoth ? 0.75 : 0.3,
      reason: aboveBoth
        ? `Price $${price.toFixed(2)} above SMA200 ($${sma200.toFixed(2)}) with SMA50 > SMA200 — established uptrend`
        : belowBoth
        ? `Price $${price.toFixed(2)} below SMA200 ($${sma200.toFixed(2)}) with SMA50 < SMA200 — established downtrend`
        : `Price between SMA50 ($${sma50.toFixed(2)}) and SMA200 ($${sma200.toFixed(2)}) — transitional structure`,
    });
  }

  if (sma50 !== null) {
    const gapPct = ((price - sma50) / sma50) * 100;
    signals.push({
      name: "SMA50 Momentum",
      direction: gapPct > 1.5 ? "YES" : gapPct < -1.5 ? "NO" : "neutral",
      weight: 0.12,
      conviction: Math.min(0.7, 0.3 + Math.abs(gapPct) / 12),
      reason: `Price ${gapPct >= 0 ? "+" : ""}${gapPct.toFixed(1)}% vs 50-day average`,
    });
  }

  if (rsi !== null) {
    signals.push({
      name: "RSI(14)",
      direction: rsi >= 58 ? "YES" : rsi <= 42 ? "NO" : "neutral",
      weight: 0.1,
      conviction: rsi >= 70 || rsi <= 30 ? 0.7 : 0.45,
      reason:
        rsi >= 70
          ? `RSI ${rsi.toFixed(0)} — strong momentum, but watch overbought reversion`
          : rsi <= 30
          ? `RSI ${rsi.toFixed(0)} — heavy selling pressure, oversold territory`
          : `RSI ${rsi.toFixed(0)} — ${rsi >= 58 ? "bullish lean" : rsi <= 42 ? "bearish lean" : "neutral zone"}`,
    });
  }

  if (macdRes !== null) {
    const bullish = macdRes.histogram > 0;
    signals.push({
      name: "MACD",
      direction: Math.abs(macdRes.histogram) < price * 0.0005 ? "neutral" : bullish ? "YES" : "NO",
      weight: 0.12,
      conviction: 0.55,
      reason: `MACD ${bullish ? "above" : "below"} signal line (histogram ${macdRes.histogram >= 0 ? "+" : ""}${macdRes.histogram.toFixed(2)})`,
    });
  }

  if (ret3mPct !== null) {
    signals.push({
      name: "3-Month Momentum",
      direction: ret3mPct > 8 ? "YES" : ret3mPct < -8 ? "NO" : "neutral",
      weight: 0.12,
      conviction: Math.min(0.75, 0.35 + Math.abs(ret3mPct) / 50),
      reason: `${ret3mPct >= 0 ? "+" : ""}${ret3mPct.toFixed(1)}% over the last quarter`,
    });
  }

  if (pctFrom52wHigh !== null) {
    signals.push({
      name: "52-Week Position",
      direction: pctFrom52wHigh > -5 ? "YES" : pctFrom52wHigh < -25 ? "NO" : "neutral",
      weight: 0.1,
      conviction: 0.5,
      reason:
        pctFrom52wHigh > -5
          ? `Within ${Math.abs(pctFrom52wHigh).toFixed(1)}% of its 52-week high — leadership behavior`
          : pctFrom52wHigh < -25
          ? `${Math.abs(pctFrom52wHigh).toFixed(1)}% below its 52-week high — deep drawdown`
          : `${Math.abs(pctFrom52wHigh).toFixed(1)}% below its 52-week high — mid-range`,
    });
  }

  const summary = [
    `${normalized} at $${price.toFixed(2)}.`,
    sma50 !== null && sma200 !== null
      ? `SMA50 $${sma50.toFixed(2)} / SMA200 $${sma200.toFixed(2)} (${price > (sma200 ?? 0) ? "above" : "below"} long-term trend).`
      : null,
    rsi !== null ? `RSI(14) ${rsi.toFixed(0)}.` : null,
    ret1mPct !== null ? `1M ${ret1mPct >= 0 ? "+" : ""}${ret1mPct.toFixed(1)}%.` : null,
    ret3mPct !== null ? `3M ${ret3mPct >= 0 ? "+" : ""}${ret3mPct.toFixed(1)}%.` : null,
    pctFrom52wHigh !== null ? `${Math.abs(pctFrom52wHigh).toFixed(1)}% from 52w high.` : null,
    realizedVolAnnualPct !== null ? `Realized vol ${realizedVolAnnualPct.toFixed(0)}% annualized.` : null,
  ]
    .filter(Boolean)
    .join(" ");

  const result: StockTechnicals = {
    symbol: normalized,
    price,
    sma50,
    sma200,
    rsi14: rsi,
    macd: macdRes,
    ret1mPct,
    ret3mPct,
    realizedVolAnnualPct,
    high52w,
    low52w,
    pctFrom52wHigh,
    signals,
    summary,
  };

  await setJsonCache(cacheKey, result, 300, { staleTtlSeconds: 1800 });
  return result;
}
