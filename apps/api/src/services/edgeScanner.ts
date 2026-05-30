/**
 * Edge Scanner — scans live Polymarket crypto markets for model-vs-market
 * probability divergences. A large edge flags a potential mispricing that a
 * trader can act on. This is the product that justifies a subscription.
 *
 * Architecture:
 *  1. Pull active crypto events from Gamma (cached, fast).
 *  2. For each binary market with a crypto price question, extract the
 *     market-implied P(YES) from outcome prices.
 *  3. Run the TA engine on the underlying asset (deduplicated per symbol
 *     so BTC runs once even if 40 BTC markets exist).
 *  4. Derive the market-aware verdict + blended probability for each market.
 *  5. Rank by |edge| descending and return the top N.
 *
 * The scanner is designed to be called on a cadence (every 60–120s) or
 * on-demand. It's fully best-effort — TA failures for a symbol are skipped,
 * not fatal.
 */

import { getGamma } from "./polymarket.js";
import {
  detectCryptoSymbol,
  classifyCryptoPriceQuestion,
  deriveMarketAwareVerdict,
  runTechnicalAnalysis,
  type TechnicalAnalysis,
  type MarketAwareVerdict,
} from "./ta-engine.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export type EdgeHit = {
  marketId: string;
  question: string;
  category: string;
  slug: string;
  endDate: string | null;
  symbol: string;
  currentPrice: number;
  direction: "YES" | "NO";
  confidence: number;
  modelProbability: number;
  marketProbability: number;
  blendedProbability: number;
  edge: number;             // model − market (positive = market underprices YES)
  absEdge: number;          // |edge| for sorting
  signalAgreement: number;
  netScore: number;
  regime: string;
  mappingNote: string;
};

export type ScanResult = {
  ok: boolean;
  scannedAt: string;
  marketsScanned: number;
  symbolsAnalyzed: number;
  edgeHits: EdgeHit[];
  errors: string[];
};

// ─── Gamma market shape (minimal) ───────────────────────────────────────────

type GammaMarket = {
  id?: string;
  question?: string;
  category?: string;
  slug?: string;
  endDate?: string;
  end_date_iso?: string;
  active?: boolean;
  closed?: boolean;
  outcomes?: string | string[];
  outcomePrices?: string | string[] | number[];
  outcome_prices?: string | string[] | number[];
};

type GammaEvent = {
  id?: string;
  title?: string;
  markets?: GammaMarket[];
};

function parseArray(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function marketImpliedYes(market: GammaMarket): number | null {
  const outcomes = parseArray(market.outcomes);
  const prices = parseArray(market.outcomePrices ?? market.outcome_prices).map(Number);
  if (outcomes.length !== prices.length || outcomes.length < 2) return null;

  const yesIdx = outcomes.findIndex((o) => o.toLowerCase().includes("yes"));
  const idx = yesIdx >= 0 ? yesIdx : 0;
  const p = prices[idx];
  if (!Number.isFinite(p)) return null;
  const frac = p > 1 ? p / 100 : p;
  return frac > 0.01 && frac < 0.99 ? frac : null;
}

// ─── Crypto tag IDs (same set the prewarm uses) ────────────────────────────

const CRYPTO_TAG_IDS = ["21", "235", "101611", "1312"];

// ─── Scanner ────────────────────────────────────────────────────────────────

/** In-flight TA lookups, deduplicated per symbol. */
const taCache = new Map<string, { ta: TechnicalAnalysis | null; at: number }>();
const TA_CACHE_TTL_MS = 90_000; // 90s — fresh enough, avoids hammering Binance

async function getTAForSymbol(symbol: string): Promise<TechnicalAnalysis | null> {
  const cached = taCache.get(symbol);
  if (cached && Date.now() - cached.at < TA_CACHE_TTL_MS) return cached.ta;

  const ta = await runTechnicalAnalysis(symbol).catch((err) => {
    console.warn(`[edgeScanner] TA failed for ${symbol}:`, err?.message ?? err);
    return null;
  });
  taCache.set(symbol, { ta, at: Date.now() });
  return ta;
}

export async function scanForEdges(opts: {
  minAbsEdge?: number;
  maxResults?: number;
} = {}): Promise<ScanResult> {
  const minAbsEdge = opts.minAbsEdge ?? 0.05;    // 5pt minimum to surface
  const maxResults = opts.maxResults ?? 20;
  const errors: string[] = [];
  const scannedAt = new Date().toISOString();

  // 1. Fetch active crypto events from Gamma (all crypto tags in one batch)
  let allMarkets: Array<GammaMarket & { eventTitle?: string }> = [];
  try {
    const results = await Promise.allSettled(
      CRYPTO_TAG_IDS.map((tagId) =>
        getGamma("/events", {
          tag_id: tagId,
          active: "true",
          closed: "false",
          limit: 60,
          order: "volume_24hr",
          ascending: "false",
          related_tags: "true",
        }) as Promise<GammaEvent[]>
      )
    );

    const seenIds = new Set<string>();
    for (const result of results) {
      if (result.status !== "fulfilled" || !Array.isArray(result.value)) continue;
      for (const event of result.value) {
        for (const market of event.markets ?? []) {
          if (market.closed || market.active === false) continue;
          const id = String(market.id ?? "");
          if (!id || seenIds.has(id)) continue;
          seenIds.add(id);
          allMarkets.push({ ...market, eventTitle: event.title });
        }
      }
    }
  } catch (err: any) {
    errors.push(`Gamma fetch failed: ${err?.message ?? "unknown"}`);
    return { ok: false, scannedAt, marketsScanned: 0, symbolsAnalyzed: 0, edgeHits: [], errors };
  }

  // 2. Filter to crypto price questions with valid market prices
  type Candidate = {
    market: GammaMarket & { eventTitle?: string };
    symbol: string;
    marketYes: number;
    question: string;
    endDate: string | null;
  };

  const candidates: Candidate[] = [];
  for (const market of allMarkets) {
    const question = market.question ?? market.eventTitle ?? "";
    const symbol = detectCryptoSymbol(question);
    if (!symbol) continue;
    const pq = classifyCryptoPriceQuestion(question);
    if (!pq.isPriceQuestion) continue;
    const marketYes = marketImpliedYes(market);
    if (marketYes === null) continue;
    // Skip markets near the extremes — no edge to find at 1% or 99%
    if (marketYes < 0.05 || marketYes > 0.95) continue;
    candidates.push({
      market,
      symbol,
      marketYes,
      question,
      endDate: market.endDate ?? market.end_date_iso ?? null,
    });
  }

  // 3. Deduplicate TA runs per symbol
  const uniqueSymbols = [...new Set(candidates.map((c) => c.symbol))];
  const taResults = new Map<string, TechnicalAnalysis | null>();

  // Run TA in parallel (max 6 concurrent to avoid Binance rate limits)
  const CONCURRENCY = 6;
  for (let i = 0; i < uniqueSymbols.length; i += CONCURRENCY) {
    const batch = uniqueSymbols.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (sym) => {
        const ta = await getTAForSymbol(sym);
        taResults.set(sym, ta);
      })
    );
    for (const r of results) {
      if (r.status === "rejected") {
        errors.push(`TA batch error: ${r.reason?.message ?? "unknown"}`);
      }
    }
  }

  // 4. Derive verdicts and compute edges
  const hits: EdgeHit[] = [];
  for (const candidate of candidates) {
    const ta = taResults.get(candidate.symbol);
    if (!ta) continue;

    try {
      const verdict = deriveMarketAwareVerdict(
        ta,
        candidate.question,
        candidate.endDate ?? undefined,
        candidate.marketYes
      );
      if (!verdict.taRelevant) continue;
      if (verdict.edge === null || verdict.marketProbability === null) continue;

      const absEdge = Math.abs(verdict.edge);
      if (absEdge < minAbsEdge) continue;

      hits.push({
        marketId: String(candidate.market.id ?? ""),
        question: candidate.question,
        category: candidate.market.category ?? "Crypto",
        slug: candidate.market.slug ?? "",
        endDate: candidate.endDate,
        symbol: candidate.symbol,
        currentPrice: ta.currentPrice,
        direction: verdict.verdict.direction,
        confidence: verdict.verdict.confidence,
        modelProbability: verdict.modelProbability,
        marketProbability: verdict.marketProbability,
        blendedProbability: verdict.probability,
        edge: verdict.edge,
        absEdge,
        signalAgreement: verdict.verdict.signalAgreement,
        netScore: verdict.verdict.netScore,
        regime: ta.regime,
        mappingNote: verdict.mappingNote,
      });
    } catch (err: any) {
      errors.push(`Verdict failed for "${candidate.question.slice(0, 50)}": ${err?.message ?? "unknown"}`);
    }
  }

  // 5. Sort by absolute edge descending
  hits.sort((a, b) => b.absEdge - a.absEdge);

  return {
    ok: true,
    scannedAt,
    marketsScanned: candidates.length,
    symbolsAnalyzed: taResults.size,
    edgeHits: hits.slice(0, maxResults),
    errors,
  };
}
