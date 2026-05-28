import type { PolymarketMarket } from "./polymarket"

const MARKET_DETAIL_CACHE_PREFIX = "rawli:market-detail:"
const MARKET_DETAIL_CACHE_TTL_MS = 10 * 60_000

export type CachedMarketDetail = {
  cachedAt: number
  id: string
  title: string
  category: string
  outcomes: string[]
  prices: number[]
  tokenIds: string[]
  image?: string
  icon?: string
  endsAt?: string
  volume24h?: string
  liquidity?: string
  description?: string
  slug?: string
  conditionId?: string
}

function cacheKey(identifier: string) {
  return `${MARKET_DETAIL_CACHE_PREFIX}${identifier}`
}

function normalizeIdentifier(value: unknown): string | null {
  const normalized = String(value ?? "").trim()
  return normalized ? normalized : null
}

export function cacheMarketForDetail(market: PolymarketMarket) {
  if (typeof window === "undefined") return
  const id = normalizeIdentifier(market.id)
  if (!id) return

  const payload: CachedMarketDetail = {
    cachedAt: Date.now(),
    id,
    title: market.question,
    category: market.category ?? market.tags?.[0] ?? "Events",
    outcomes: market.outcomes?.map((outcome) => outcome.name).filter(Boolean) ?? ["Yes", "No"],
    prices: market.outcomes?.map((outcome) => outcome.price).filter((price) => Number.isFinite(price)) ?? [],
    tokenIds: market.tokenIds ?? [],
    image: market.image,
    icon: market.icon,
    endsAt: market.endDate,
    volume24h: market.volume,
    liquidity: market.liquidity,
    description: market.description,
    slug: market.slug,
    conditionId: market.conditionId,
  }

  const keys = [id, market.slug, market.conditionId]
    .map(normalizeIdentifier)
    .filter((value): value is string => Boolean(value))

  for (const key of new Set(keys)) {
    try {
      window.sessionStorage.setItem(cacheKey(key), JSON.stringify(payload))
    } catch {
      // Best-effort navigation cache only.
    }
  }
}

export function readCachedMarketDetail(identifier: string): CachedMarketDetail | null {
  if (typeof window === "undefined") return null
  const key = normalizeIdentifier(identifier)
  if (!key) return null

  try {
    const raw = window.sessionStorage.getItem(cacheKey(key))
    if (!raw) return null
    const parsed = JSON.parse(raw) as CachedMarketDetail
    if (!parsed?.id || !parsed.title || !Array.isArray(parsed.tokenIds)) return null
    if (!parsed.cachedAt || Date.now() - parsed.cachedAt > MARKET_DETAIL_CACHE_TTL_MS) {
      window.sessionStorage.removeItem(cacheKey(key))
      return null
    }
    return parsed
  } catch {
    return null
  }
}
