/**
 * Prediction calibration / backtest harness.
 *
 * Every premium verdict is logged at generation time. Once the underlying market
 * resolves, we fetch the outcome from Polymarket Gamma and score the prediction
 * (Brier score, log-loss, directional accuracy) — including the market's own
 * implied probability as a baseline, so we can measure whether we beat consensus.
 *
 * All operations are best-effort and must never break the analysis response.
 */

import {
  recordPrediction,
  getPendingPredictions,
  resolvePrediction,
  getAccuracyStats,
  type AccuracyStats,
} from "./db.js";
import { getGamma } from "./polymarket.js";

export type { AccuracyStats };

export async function logPrediction(input: Parameters<typeof recordPrediction>[0]): Promise<void> {
  try {
    await recordPrediction(input);
  } catch (err) {
    console.warn("[smartmarket] prediction log write failed:", err);
  }
}

type GammaResolvedMarket = {
  id?: string | number;
  closed?: boolean;
  outcomes?: string[] | string;
  outcomePrices?: string[] | string;
  umaResolutionStatus?: string;
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

/**
 * Determine whether the market's YES outcome resolved true.
 * Returns 1 (YES), 0 (NO), or null if not yet resolvable / ambiguous.
 */
function resolveYesOutcome(market: GammaResolvedMarket): 0 | 1 | null {
  if (!market || market.closed !== true) return null;
  const outcomes = parseArray(market.outcomes);
  const prices = parseArray(market.outcomePrices).map(Number);
  if (outcomes.length === 0 || outcomes.length !== prices.length) return null;

  // A resolved binary market has one outcome at ~1 and the other at ~0.
  const winnerIdx = prices.findIndex((p) => p >= 0.99);
  const loserResolved = prices.some((p) => p <= 0.01);
  if (winnerIdx < 0 || !loserResolved) return null; // not cleanly resolved yet

  const winnerName = (outcomes[winnerIdx] ?? "").toLowerCase();
  // Map the winning outcome back to YES/NO. For binary markets the YES token is
  // the one whose label contains "yes"; if neither does, assume index 0 = YES.
  const yesIdx = outcomes.findIndex((o) => o.toLowerCase().includes("yes"));
  if (yesIdx >= 0) return winnerIdx === yesIdx ? 1 : 0;
  if (outcomes.length === 2) return winnerName.includes("yes") || winnerIdx === 0 ? 1 : 0;
  return null;
}

async function fetchMarketResolution(marketId: string): Promise<0 | 1 | null> {
  try {
    const data = await getGamma("/markets", { id: marketId });
    const market = (Array.isArray(data) ? data[0] : data) as GammaResolvedMarket | undefined;
    if (!market) return null;
    return resolveYesOutcome(market);
  } catch {
    return null;
  }
}

let lastScoreRun = 0;
const SCORE_THROTTLE_MS = 60_000;

/**
 * Score any predictions whose markets have resolved. Throttled so it can be called
 * cheaply (e.g. on each /analysis/accuracy hit) without hammering Gamma.
 */
export async function scoreResolvedPredictions(force = false): Promise<number> {
  const now = Date.now();
  if (!force && now - lastScoreRun < SCORE_THROTTLE_MS) return 0;
  lastScoreRun = now;

  let scored = 0;
  try {
    const pending = await getPendingPredictions(new Date().toISOString(), 50);
    for (const row of pending) {
      const resolvedYes = await fetchMarketResolution(row.market_id);
      if (resolvedYes === null) continue; // still open / unresolvable
      await resolvePrediction(
        row.signal_hash,
        resolvedYes,
        Number(row.blended_prob),
        row.direction === "YES" ? "YES" : "NO",
      );
      scored += 1;
    }
  } catch (err) {
    console.warn("[smartmarket] prediction scoring failed:", err);
  }
  return scored;
}

export async function getAccuracy(): Promise<AccuracyStats> {
  return getAccuracyStats();
}
