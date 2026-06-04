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
} from "./ta-engine.js";
import { computeFundamentalVerdict } from "./fundamental-engine.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export type EdgeHit = {
  marketId: string;
  question: string;
  category: string;
  slug: string;
  endDate: string | null;
  engine: "ta" | "fundamental";  // which engine produced this edge
  symbol: string | null;         // crypto symbol (null for fundamental)
  currentPrice: number | null;   // live spot price (null for fundamental)
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
  category?: string;
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

// ─── Tag IDs — all categories the scanner covers ────────────────────────────
// Crypto (TA engine): BTC, ETH, altcoins, DeFi
const CRYPTO_TAG_IDS = ["21", "235", "101611", "1312"];
// Non-crypto (fundamental engine): these categories produce questions the
// fundamental verdict engine handles well — politics, tech, geopolitics, finance.
const FUNDAMENTAL_TAG_IDS = [
  "2", "144",                        // news / politics
  "100265", "1396", "101970", "366", // geopolitics
  "1401",                            // tech (AI, OpenAI, etc.)
  "120", "600",                      // finance / IPOs
  "439",                             // AI
  "596", "100", "53",                // entertainment
];
const ALL_TAG_IDS = [...new Set([...CRYPTO_TAG_IDS, ...FUNDAMENTAL_TAG_IDS])];

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
  engines?: Array<"ta" | "fundamental">;
} = {}): Promise<ScanResult> {
  const minAbsEdge = opts.minAbsEdge ?? 0.05;    // 5pt minimum to surface
  const maxResults = opts.maxResults ?? 20;
  const engines = opts.engines ?? ["ta", "fundamental"];
  const errors: string[] = [];
  const scannedAt = new Date().toISOString();

  // 1. Fetch active events from Gamma across all covered tags
  const tagIds = engines.includes("fundamental") ? ALL_TAG_IDS : CRYPTO_TAG_IDS;
  let allMarkets: Array<GammaMarket & { eventTitle?: string; eventCategory?: string }> = [];
  try {
    const results = await Promise.allSettled(
      tagIds.map((tagId) =>
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
          allMarkets.push({ ...market, eventTitle: event.title, eventCategory: event.category });
        }
      }
    }
  } catch (err: any) {
    errors.push(`Gamma fetch failed: ${err?.message ?? "unknown"}`);
    return { ok: false, scannedAt, marketsScanned: 0, symbolsAnalyzed: 0, edgeHits: [], errors };
  }

  // 2. Classify every market into a TA candidate or a fundamental candidate
  type TaCandidate = {
    kind: "ta";
    market: GammaMarket & { eventTitle?: string; eventCategory?: string };
    symbol: string;
    marketYes: number;
    question: string;
    endDate: string | null;
  };
  type FundCandidate = {
    kind: "fundamental";
    market: GammaMarket & { eventTitle?: string; eventCategory?: string };
    marketYes: number;
    question: string;
    endDate: string | null;
    category: string;
  };

  const taCandidates: TaCandidate[] = [];
  const fundCandidates: FundCandidate[] = [];

  for (const market of allMarkets) {
    const question = market.question ?? market.eventTitle ?? "";
    const marketYes = marketImpliedYes(market);
    if (marketYes === null) continue;
    // Skip extremes — no edge at 1% or 99%
    if (marketYes < 0.05 || marketYes > 0.95) continue;
    const endDate = market.endDate ?? market.end_date_iso ?? null;
    const category = market.category ?? market.eventCategory ?? "General";

    const symbol = detectCryptoSymbol(question);
    if (symbol && engines.includes("ta")) {
      const pq = classifyCryptoPriceQuestion(question);
      if (pq.isPriceQuestion) {
        taCandidates.push({ kind: "ta", market, symbol, marketYes, question, endDate });
        continue; // TA takes priority
      }
    }
    // Everything else → fundamental (if enabled)
    if (engines.includes("fundamental")) {
      fundCandidates.push({ kind: "fundamental", market, marketYes, question, endDate, category });
    }
  }

  // 3. Run TA engine (deduplicated per symbol)
  const uniqueSymbols = [...new Set(taCandidates.map((c) => c.symbol))];
  const taResults = new Map<string, TechnicalAnalysis | null>();
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
      if (r.status === "rejected") errors.push(`TA batch error: ${r.reason?.message ?? "unknown"}`);
    }
  }

  // 4. Compute edges — TA path
  const hits: EdgeHit[] = [];
  for (const c of taCandidates) {
    const ta = taResults.get(c.symbol);
    if (!ta) continue;
    try {
      const v = deriveMarketAwareVerdict(ta, c.question, c.endDate ?? undefined, c.marketYes);
      if (!v.taRelevant || v.edge === null || v.marketProbability === null) continue;
      const absEdge = Math.abs(v.edge);
      if (absEdge < minAbsEdge) continue;
      hits.push({
        marketId: String(c.market.id ?? ""),
        question: c.question,
        category: c.market.category ?? c.market.eventCategory ?? "Crypto",
        slug: c.market.slug ?? "",
        endDate: c.endDate,
        engine: "ta",
        symbol: c.symbol,
        currentPrice: ta.currentPrice,
        direction: v.verdict.direction,
        confidence: v.verdict.confidence,
        modelProbability: v.modelProbability,
        marketProbability: v.marketProbability,
        blendedProbability: v.probability,
        edge: v.edge,
        absEdge,
        signalAgreement: v.verdict.signalAgreement,
        netScore: v.verdict.netScore,
        regime: ta.regime,
        mappingNote: v.mappingNote,
      });
    } catch (err: any) {
      errors.push(`TA verdict failed: "${c.question.slice(0, 40)}": ${err?.message ?? "unknown"}`);
    }
  }

  // 5. Compute edges — Fundamental path (lightweight: no news fetch, just market data scoring)
  //    The fundamental engine computes an implied probability from the question structure,
  //    category, time-to-resolution, and market liquidity. We compare that to the market price.
  const FUND_BATCH_SIZE = 40; // cap to keep scan fast
  const fundBatch = fundCandidates.slice(0, FUND_BATCH_SIZE);
  for (const c of fundBatch) {
    try {
      const marketObj = {
        id: String(c.market.id ?? ""),
        question: c.question,
        category: c.category,
        endDate: c.endDate ?? undefined,
        outcomes: (() => {
          const outcomes = parseArray(c.market.outcomes);
          const prices = parseArray(c.market.outcomePrices ?? c.market.outcome_prices).map(Number);
          return outcomes.map((name, i) => ({ name, price: prices[i] ?? 0.5 }));
        })(),
      };
      const fv = computeFundamentalVerdict(marketObj, []);
      if (!fv) continue;

      // Compute implied probability from fundamental signals
      const fundPYes = Math.min(0.95, Math.max(0.05, 0.5 + fv.netScore / 200));
      const edge = fundPYes - c.marketYes;
      const absEdge = Math.abs(edge);
      if (absEdge < minAbsEdge) continue;

      hits.push({
        marketId: String(c.market.id ?? ""),
        question: c.question,
        category: c.category,
        slug: c.market.slug ?? "",
        endDate: c.endDate,
        engine: "fundamental",
        symbol: null,
        currentPrice: null,
        direction: fv.direction,
        confidence: fv.confidence,
        modelProbability: fundPYes,
        marketProbability: c.marketYes,
        blendedProbability: fundPYes, // no blend for fundamental (no market-prior merge yet)
        edge,
        absEdge,
        signalAgreement: fv.signals.length > 0 ? (fv.signals.filter((s) => s.direction === fv.direction).length / fv.signals.length) * 100 : 0,
        netScore: fv.netScore,
        regime: fv.category ?? "general",
        mappingNote: fv.verdictRationale ?? "",
      });
    } catch (err: any) {
      errors.push(`Fund verdict failed: "${c.question.slice(0, 40)}": ${err?.message ?? "unknown"}`);
    }
  }

  // 6. Sort by absolute edge descending
  hits.sort((a, b) => b.absEdge - a.absEdge);

  return {
    ok: true,
    scannedAt,
    marketsScanned: taCandidates.length + fundBatch.length,
    symbolsAnalyzed: taResults.size,
    edgeHits: hits.slice(0, maxResults),
    errors,
  };
}
