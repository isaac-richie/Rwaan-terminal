import { fetchKalshiMarkets } from "./kalshi"
import { fetchPolymarketMarkets, type PolymarketMarket } from "./polymarket"

// ─── Client-side cache ──────────────────────────────────────────────────────
// Prevents shimmer flash when navigating back to '/'. Data is returned instantly
// from cache and a background revalidation refreshes it for the next visit.
const CACHE_TTL_MS = 45_000 // 45s — fresh enough, avoids redundant fetches
const STALE_TTL_MS = 120_000 // 2min — serve stale while revalidating

type CacheEntry = {
  data: PolymarketMarket[]
  fetchedAt: number
}

const marketCache = new Map<string, CacheEntry>()

function cacheKey(
  category?: string,
  limit = 24,
  sortBy = "trending",
  offset = 0,
  search?: string
): string {
  return `${category ?? "all"}:${limit}:${sortBy}:${offset}:${search ?? ""}`
}

/** Return cached data if available (even if stale). Returns null if no cache. */
export function getCachedMarkets(
  category?: string,
  limit = 24,
  sortBy = "trending",
  offset = 0,
  search?: string
): PolymarketMarket[] | null {
  const key = cacheKey(category, limit, sortBy, offset, search)
  const entry = marketCache.get(key)
  if (!entry) return null
  // Expired beyond stale window — treat as miss
  if (Date.now() - entry.fetchedAt > STALE_TTL_MS) {
    marketCache.delete(key)
    return null
  }
  return entry.data
}

function volumeToNumber(volume: string): number {
  const normalized = volume.replace(/\$/g, "").trim().toUpperCase()
  if (!normalized) return 0
  if (normalized.endsWith("M")) return Number.parseFloat(normalized) * 1_000_000
  if (normalized.endsWith("K")) return Number.parseFloat(normalized) * 1_000
  return Number.parseFloat(normalized)
}

function dedupeMarkets(markets: PolymarketMarket[]) {
  const seen = new Set<string>()
  const out: PolymarketMarket[] = []
  for (const market of markets) {
    const key = `${market.question.toLowerCase().trim()}::${(market.endDate ?? "").slice(0, 10)}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(market)
  }
  return out
}

function timeToNumber(value?: string): number {
  if (!value) return 0
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : 0
}

export async function fetchMarkets(
  category?: string,
  limit = 24,
  sortBy = "trending",
  offset = 0,
  search?: string
): Promise<PolymarketMarket[]> {
  const key = cacheKey(category, limit, sortBy, offset, search)
  const cached = marketCache.get(key)

  // If cache is fresh, return immediately — no network at all
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.data
  }

  const includeKalshi = (process.env.NEXT_PUBLIC_ENABLE_KALSHI ?? "false") === "true"
  const requests = [
    fetchPolymarketMarkets(category, limit, sortBy, offset, search),
    includeKalshi ? fetchKalshiMarkets(category ?? "all", limit, sortBy, offset, search) : Promise.resolve([])
  ]

  const [polyResult, kalshiResult] = await Promise.allSettled(requests)
  const poly = polyResult.status === "fulfilled" ? polyResult.value : []
  const kalshi = kalshiResult.status === "fulfilled" ? kalshiResult.value : []

  const merged = dedupeMarkets([...poly, ...kalshi])
  if (sortBy === "volume") {
    merged.sort((a, b) => volumeToNumber(b.volume) - volumeToNumber(a.volume))
  } else if (sortBy === "newest") {
    merged.sort((a, b) => timeToNumber(b.createdAt) - timeToNumber(a.createdAt))
  } else if (sortBy === "daily") {
    merged.sort((a, b) => volumeToNumber(b.liquidity) - volumeToNumber(a.liquidity))
  } else if (sortBy === "ending") {
    merged.sort((a, b) => timeToNumber(a.endDate) - timeToNumber(b.endDate))
  }

  const result = merged.slice(0, limit)

  // Store in module-level cache
  marketCache.set(key, { data: result, fetchedAt: Date.now() })

  return result
}
