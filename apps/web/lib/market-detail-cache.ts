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

function firstIdentifier(...values: unknown[]) {
  for (const value of values) {
    const normalized = normalizeIdentifier(value)
    if (normalized) return normalized
  }
  return null
}

function parseStringList(raw: unknown): string[] {
  if (!raw) return []
  if (Array.isArray(raw)) return raw.map(String).map((value) => value.trim()).filter(Boolean)
  if (typeof raw !== "string") return []

  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(String).map((value) => value.trim()).filter(Boolean) : []
  } catch {
    return []
  }
}

function normalizeDetailPrice(raw: unknown): number | null {
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0) return null
  return value > 1 ? value / 100 : value
}

function portfolioPositionOutcomes(position: any): string[] {
  const listed = parseStringList(position?.outcomes ?? position?.marketOutcomes ?? position?.market_outcomes)
  if (listed.length) return listed

  const heldOutcome = firstIdentifier(
    position?.outcome,
    position?.outcomeName,
    position?.outcome_name,
    position?.assetName,
    position?.asset_name
  )
  return heldOutcome ? [heldOutcome] : ["Yes", "No"]
}

function portfolioPositionPrices(position: any, outcomes: string[]): number[] {
  const listed = parseStringList(position?.outcomePrices ?? position?.outcome_prices ?? position?.prices)
    .map(normalizeDetailPrice)
    .filter((price): price is number => price !== null)
  if (listed.length) return listed

  const currentPrice = normalizeDetailPrice(position?.curPrice ?? position?.cur_price ?? position?.current_price ?? position?.price)
  if (currentPrice === null) return outcomes.length > 1 ? [0.5, 0.5] : [0.5]
  if (outcomes.length > 1) return [currentPrice, Math.max(0, Math.min(1, 1 - currentPrice))]
  return [currentPrice]
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
    prices: market.outcomes
      ?.map((outcome) => normalizeDetailPrice(outcome.price))
      .filter((price): price is number => price !== null) ?? [],
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

export function cachePortfolioPositionForDetail(position: any, routeIdentifier?: string) {
  if (typeof window === "undefined") return
  if (!position) return

  const tokenIds = parseStringList(
    position?.clobTokenIds ??
    position?.clob_token_ids ??
    position?.tokenIds ??
    position?.token_ids
  )
  const heldTokenId = firstIdentifier(
    position?.asset,
    position?.assetId,
    position?.asset_id,
    position?.tokenId,
    position?.token_id
  )
  if (heldTokenId && !tokenIds.includes(heldTokenId)) tokenIds.unshift(heldTokenId)

  const id = firstIdentifier(
    position?.marketId,
    position?.market_id,
    routeIdentifier,
    position?.conditionId,
    position?.condition_id,
    heldTokenId,
    position?.slug,
    position?.marketSlug,
    position?.market_slug,
    position?.eventSlug,
    position?.event_slug,
    position?.eventId,
    position?.id
  )
  if (!id) return

  const outcomes = portfolioPositionOutcomes(position)
  const payload: CachedMarketDetail = {
    cachedAt: Date.now(),
    id,
    title: firstIdentifier(
      position?.title,
      position?.market,
      position?.question,
      position?.event,
      position?.marketTitle,
      position?.market_title
    ) ?? "Portfolio position",
    category: firstIdentifier(position?.category, position?.marketCategory, position?.market_category) ?? "Events",
    outcomes,
    prices: portfolioPositionPrices(position, outcomes),
    tokenIds,
    image: firstIdentifier(position?.image, position?.marketImage, position?.market_image, position?.icon) ?? undefined,
    icon: firstIdentifier(position?.icon, position?.marketIcon, position?.market_icon) ?? undefined,
    endsAt: firstIdentifier(
      position?.endDate,
      position?.end_date,
      position?.endDateIso,
      position?.end_date_iso,
      position?.marketEndDate,
      position?.market_end_date,
      position?.expiration,
      position?.expiry
    ) ?? undefined,
    volume24h: firstIdentifier(position?.volume24h, position?.volume_24hr, position?.volume, position?.marketVolume) ?? undefined,
    liquidity: firstIdentifier(position?.liquidity, position?.marketLiquidity, position?.market_liquidity) ?? undefined,
    description: firstIdentifier(position?.description, position?.marketDescription, position?.market_description) ?? undefined,
    slug: firstIdentifier(position?.slug, position?.marketSlug, position?.market_slug) ?? undefined,
    conditionId: firstIdentifier(position?.conditionId, position?.condition_id) ?? undefined,
  }

  const keys = [
    routeIdentifier,
    id,
    heldTokenId,
    ...tokenIds,
    position?.marketId,
    position?.market_id,
    position?.slug,
    position?.marketSlug,
    position?.market_slug,
    position?.conditionId,
    position?.condition_id,
    position?.eventSlug,
    position?.event_slug,
    position?.eventId,
    position?.id,
  ]
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
