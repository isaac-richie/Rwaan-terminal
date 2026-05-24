// Polymarket Gamma API integration
// Docs: https://docs.polymarket.com

export interface PolymarketMarket {
  id: string
  source?: "polymarket" | "kalshi"
  question: string
  description?: string
  image?: string
  icon?: string
  category?: string
  volume: string
  liquidity: string
  endDate: string
  outcomes: PolymarketOutcome[]
  tokenIds?: string[]
  active: boolean
  new: boolean
  featured: boolean
  slug: string
  conditionId?: string
  tags?: string[]
  createdAt?: string
  feedBadges?: string[]
}

export interface PolymarketOutcome {
  name: string
  price: number
}

export interface GammaMarketRaw {
  id: string
  question: string
  description?: string
  image?: string
  icon?: string
  category?: string
  volume: number | string
  volume24hr?: number | string
  volume_24hr?: number | string
  liquidity: number | string
  endDate?: string
  end_date_iso?: string
  closed?: boolean
  active?: boolean
  new?: boolean
  featured?: boolean
  slug?: string
  conditionId?: string
  tokens?: { outcome: string; price: number }[]
  tags?: { id: string; label: string; slug: string }[]
  outcomes?: string[] | string
  outcomePrices?: number[] | string[]
  outcome_prices?: number[] | string[]
  clobTokenIds?: string[] | string
  clob_token_ids?: string[] | string
  createdAt?: string
  startDate?: string
}

export interface GammaEventRaw {
  id: string
  title: string
  description?: string
  image?: string
  icon?: string
  category?: string
  volume?: number | string
  volume24hr?: number | string
  volume_24hr?: number | string
  liquidity?: number | string
  endDate?: string
  endDateIso?: string
  active?: boolean
  closed?: boolean
  new?: boolean
  featured?: boolean
  slug?: string
  tags?: { id: string; label: string; slug: string }[]
  markets?: GammaMarketRaw[]
  createdAt?: string
  startDate?: string
}

const GAMMA_API = "https://gamma-api.polymarket.com"
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000"
const DAILY_MARKET_WINDOW_MS = 24 * 60 * 60 * 1000
const QUICK_SETTLE_WINDOW_MS = DAILY_MARKET_WINDOW_MS
const DAILY_MARKET_MIN_LIQUIDITY = 100
const NICE_MARKET_MIN_LIQUIDITY = 250
const NICE_MARKET_MIN_VOLUME = 50

type FeedGammaMarket = GammaMarketRaw & {
  feedBadges?: string[]
  smartScore?: number
}

const categoryNeedles: Record<string, string[]> = {
  entertainment: [
    "entertainment",
    "music",
    "album",
    "song",
    "movie",
    "film",
    "tv",
    "television",
    "streaming",
    "celebrity",
    "awards",
    "oscars",
    "grammys",
    "box office",
    "gta",
  ],
  sports: [
    "sport",
    "sports",
    "nba",
    "nfl",
    "mlb",
    "nhl",
    "soccer",
    "football",
    "ufc",
    "mma",
    "boxing",
    "tennis",
    "f1",
    "formula 1",
    "olympics",
    "world cup",
    "champions league",
  ],
  news: [
    "news",
    "breaking",
    "live",
    "headline",
    "politics",
    "political",
    "president",
    "senate",
    "election",
    "elections",
    "government",
    "policy",
    "court",
    "supreme court",
    "congress",
    "white house",
    "fed",
    "rate",
    "inflation",
    "tariff",
  ],
  crypto: [
    "crypto",
    "bitcoin",
    "btc",
    "ethereum",
    "eth",
    "bnb",
    "binance",
    "solana",
    "sol",
    "xrp",
    "doge",
    "memecoin",
    "defi",
    "altcoin",
    "stablecoin",
    "usdt",
    "usdc",
    "etf",
    "coinbase",
    "kraken",
    "microstrategy",
  ],
  geopolitics: [
    "geopolitics",
    "geopolitical",
    "war",
    "ceasefire",
    "sanctions",
    "nato",
    "united nations",
    "iran",
    "china",
    "russia",
    "ukraine",
    "israel",
    "gaza",
    "taiwan",
    "korea",
    "military",
    "border",
    "treaty",
  ],
}

const targetCategoryIds = ["entertainment", "sports", "news", "crypto", "geopolitics"] as const
const targetCategoryNeedles = targetCategoryIds.flatMap((id) => categoryNeedles[id])
const categoryFeedTagIds: Record<(typeof targetCategoryIds)[number], string[]> = {
  entertainment: ["596", "100", "53"],
  sports: ["1"],
  news: ["2", "144"],
  crypto: ["21", "235", "101611", "1312"],
  geopolitics: ["100265", "1396", "101970", "366"],
}
const categoryExclusionNeedles: Record<string, string[]> = {
  entertainment: [
    ...categoryNeedles.sports,
    ...categoryNeedles.crypto,
    ...categoryNeedles.geopolitics,
    "science",
    "spacex",
    "alien",
    "aliens",
    "mh370",
    "wreckage",
    "business",
    "election",
    "government",
    "senate",
    "congress",
  ],
  news: [
    ...categoryNeedles.entertainment,
    ...categoryNeedles.sports,
    ...categoryNeedles.crypto,
  ],
  geopolitics: [
    ...categoryNeedles.entertainment,
    ...categoryNeedles.sports,
    ...categoryNeedles.crypto,
    "business",
    "tech",
    "big tech",
    "tiktok",
    "acquire",
    "acquisition",
    "stock",
    "box office",
    "album",
    "sales",
  ],
}

function normalizeCategory(category?: string) {
  return (category ?? "all").trim().toLowerCase()
}

function getCategoryNeedles(category?: string): string[] {
  const normalized = normalizeCategory(category)
  if (normalized === "all") return targetCategoryNeedles
  return categoryNeedles[normalized] ?? [normalized]
}

function getCategoryFeedTagIds(category?: string): string[] {
  const normalized = normalizeCategory(category)
  if (normalized === "all") {
    return Array.from(new Set(targetCategoryIds.flatMap((id) => categoryFeedTagIds[id])))
  }
  if (normalized === "sport") return categoryFeedTagIds.sports
  const tagIds = categoryFeedTagIds[normalized as (typeof targetCategoryIds)[number]]
  return tagIds ? Array.from(new Set(tagIds)) : []
}

function includesNeedle(haystack: string, needle: string) {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(haystack)
}

function formatVolume(v: number | string): string {
  const n = typeof v === "string" ? parseFloat(v) : v
  if (isNaN(n)) return "$0"
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`
  return `$${n.toFixed(0)}`
}

function numberValue(v: number | string | undefined): number {
  if (v === undefined || v === null) return 0
  const parsed = typeof v === "string" ? parseFloat(v) : v
  return Number.isFinite(parsed) ? parsed : 0
}

function timeValue(v?: string): number {
  if (!v) return 0
  const parsed = new Date(v).getTime()
  return Number.isNaN(parsed) ? 0 : parsed
}

function logScore(value: number, divisor = 6): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.min(1, Math.log10(value + 1) / divisor)
}

function hoursUntil(endDate: string | undefined, now: number): number | null {
  if (!endDate) return null
  const endMs = new Date(endDate).getTime()
  if (!Number.isFinite(endMs)) return null
  return (endMs - now) / (60 * 60 * 1000)
}

function isQuickSettle(endDate: string | undefined, now: number): boolean {
  const hours = hoursUntil(endDate, now)
  return hours !== null && hours >= 0 && hours <= QUICK_SETTLE_WINDOW_MS / (60 * 60 * 1000)
}

function marketText(event: GammaEventRaw, market: GammaMarketRaw): string {
  const eventTags = event.tags?.map((t) => t.label) ?? []
  const marketTags = market.tags?.map((t) => t.label) ?? []
  return [
    ...eventTags,
    ...marketTags,
    event.category ?? "",
    event.title ?? "",
    market.category ?? "",
    market.question ?? "",
    market.description ?? "",
    market.slug ?? "",
  ].join(" ").toLowerCase()
}

function isCryptoMarket(text: string): boolean {
  return categoryNeedles.crypto.some((needle) => includesNeedle(text, needle.toLowerCase()))
}

function priceOpportunityScore(market: GammaMarketRaw): number {
  const outcomes = parseOutcomes(market)
  const yes = outcomes.find((o) => o.name.toLowerCase().includes("yes"))?.price ?? outcomes[0]?.price ?? 50
  const centered = 1 - Math.min(Math.abs(yes - 50), 50) / 50
  return Math.max(0, Math.min(1, centered))
}

function qualityBadges(input: {
  market: GammaMarketRaw
  event: GammaEventRaw
  now: number
  text: string
  volume: number
  liquidity: number
  endDate?: string
}) {
  const badges: string[] = []
  if (isQuickSettle(input.endDate, input.now)) badges.push("Closes today")
  if (isCryptoMarket(input.text)) badges.push("Crypto")
  if (input.liquidity >= 10_000) badges.push("Deep liquidity")
  else if (input.liquidity >= NICE_MARKET_MIN_LIQUIDITY) badges.push("Tradable")
  if (input.volume >= 5_000) badges.push("Hot volume")
  if (input.market.new ?? input.event.new) badges.push("New")
  if (parseTokenIds(input.market).length) badges.push("CLOB ready")
  return badges.slice(0, 3)
}

function smartMarketScore(input: {
  market: GammaMarketRaw
  event: GammaEventRaw
  now: number
  text: string
  volume: number
  liquidity: number
  endDate?: string
  normalizedCategory: string
}) {
  const quick = isQuickSettle(input.endDate, input.now)
  const crypto = isCryptoMarket(input.text)
  const hasVisual = Boolean(input.market.image || input.market.icon || input.event.image || input.event.icon)
  const hasTokens = parseTokenIds(input.market).length > 0
  const hours = hoursUntil(input.endDate, input.now)
  const urgency =
    hours === null || hours < 0
      ? 0
      : hours <= 24
      ? 1 - hours / 48
      : hours <= 72
      ? 0.25
      : 0

  return (
    logScore(input.liquidity) * 32 +
    logScore(input.volume) * 24 +
    (quick ? 24 : urgency * 12) +
    (crypto ? (input.normalizedCategory === "crypto" ? 28 : 18) : 0) +
    priceOpportunityScore(input.market) * 10 +
    (hasTokens ? 8 : 0) +
    (hasVisual ? 5 : 0) +
    (input.market.featured || input.event.featured ? 3 : 0)
  )
}

function marketKey(market: GammaMarketRaw, event: GammaEventRaw) {
  return market.id ?? market.slug ?? market.conditionId ?? `${event.id}:${market.question}`
}

function blendSmartMarkets(markets: FeedGammaMarket[], limit: number, now: number): FeedGammaMarket[] {
  const used = new Set<string>()
  const pick = (pool: FeedGammaMarket[], count: number) => {
    const selected: FeedGammaMarket[] = []
    for (const market of pool) {
      const key = market.id ?? market.slug ?? market.conditionId ?? market.question
      if (key && used.has(key)) continue
      if (key) used.add(key)
      selected.push(market)
      if (selected.length >= count) break
    }
    return selected
  }

  const sorted = [...markets].sort((a, b) => (b.smartScore ?? 0) - (a.smartScore ?? 0))
  const quickCount = Math.max(2, Math.round(limit * 0.35))
  const cryptoCount = Math.max(3, Math.round(limit * 0.35))
  const quick = pick(
    sorted.filter((market) => isQuickSettle(market.endDate ?? market.end_date_iso, now)),
    quickCount
  )
  const crypto = pick(
    sorted.filter((market) => market.feedBadges?.includes("Crypto")),
    cryptoCount
  )
  const rest = pick(sorted, limit - quick.length - crypto.length)

  return [...quick, ...crypto, ...rest]
    .sort((a, b) => (b.smartScore ?? 0) - (a.smartScore ?? 0))
    .slice(0, limit)
}

function sortGammaEvents(events: GammaEventRaw[], sortBy: string): GammaEventRaw[] {
  return [...events].sort((a, b) => {
    if (sortBy === "newest") {
      return timeValue(b.createdAt ?? b.startDate) - timeValue(a.createdAt ?? a.startDate)
    }
    if (sortBy === "ending") {
      return timeValue(a.endDate ?? a.endDateIso) - timeValue(b.endDate ?? b.endDateIso)
    }
    if (sortBy === "daily") {
      const liquidityDelta = numberValue(b.liquidity) - numberValue(a.liquidity)
      if (liquidityDelta !== 0) return liquidityDelta
      return (
        numberValue(b.volume24hr ?? b.volume_24hr ?? b.volume) -
        numberValue(a.volume24hr ?? a.volume_24hr ?? a.volume)
      )
    }
    return (
      numberValue(b.volume24hr ?? b.volume_24hr ?? b.volume) -
      numberValue(a.volume24hr ?? a.volume_24hr ?? a.volume)
    )
  })
}

function parseOutcomes(raw: GammaMarketRaw): PolymarketOutcome[] {
  const rawOutcomes = raw.outcomes
  const rawPrices = raw.outcomePrices ?? raw.outcome_prices
  try {
    const outcomes = Array.isArray(rawOutcomes) ? rawOutcomes : rawOutcomes ? JSON.parse(rawOutcomes) : null
    const prices = Array.isArray(rawPrices) ? rawPrices : rawPrices ? JSON.parse(rawPrices as any) : null
    if (outcomes && prices && outcomes.length === prices.length) {
      return outcomes.map((name: string, idx: number) => ({
        name,
        price: parseFloat((Number(prices[idx]) * 100).toFixed(1)),
      }))
    }
  } catch {
    // fall through to tokens
  }
  if (raw.tokens && raw.tokens.length > 0) {
    return raw.tokens.map((t) => ({
      name: t.outcome,
      price: parseFloat((t.price * 100).toFixed(1)),
    }))
  }
  // Fallback binary
  return [
    { name: "Yes", price: 50 },
    { name: "No", price: 50 },
  ]
}

function parseTokenIds(raw: GammaMarketRaw): string[] {
  const rawIds = raw.clobTokenIds ?? raw.clob_token_ids
  if (!rawIds) return []
  if (Array.isArray(rawIds)) return rawIds.map(String)
  try {
    const parsed = JSON.parse(rawIds)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

export async function fetchPolymarketMarkets(
  category?: string,
  limit = 24,
  sortBy = "volume",
  offset = 0,
  search?: string
): Promise<PolymarketMarket[]> {
  try {
    const fetchLimit =
      sortBy === "daily"
        ? Math.max(limit * 24, 240)
        : Math.max(limit * 4, 48)
    const baseParams = new URLSearchParams({
      active: "true",
      closed: "false",
      limit: fetchLimit.toString(),
      offset: Math.max(offset * 4, 0).toString(),
      order:
        sortBy === "newest"
          ? "createdAt"
          : sortBy === "ending" || sortBy === "daily"
          ? "endDate"
          : sortBy === "trending"
          ? "volume_24hr"
          : "volume_24hr",
      ascending: sortBy === "newest" ? "false" : sortBy === "ending" || sortBy === "daily" ? "true" : "false",
    })
    if (search) {
      baseParams.set("search", search)
      // broaden limit for search to improve match rate
      baseParams.set("limit", Math.max(limit * 8, 120).toString())
      baseParams.set("offset", "0")
    }

    const tagIds = getCategoryFeedTagIds(category)
    if (tagIds.length === 0) return []

    const eventResults = await Promise.allSettled(
      tagIds.map(async (tagId) => {
        const params = new URLSearchParams(baseParams)
        params.set("tag_id", tagId)
        params.set("related_tags", "true")
        let res = await fetch(`${API_BASE}/gamma/events?${params.toString()}`, {
          headers: { Accept: "application/json" },
          cache: "no-store",
        })
        if (!res.ok) {
          const retryParams = new URLSearchParams(params)
          if (retryParams.get("order") === "volume_24hr") {
            retryParams.set("order", "volume")
          }
          res = await fetch(`${API_BASE}/gamma/events?${retryParams.toString()}`, {
            headers: { Accept: "application/json" },
            cache: "no-store",
          })
        }
        if (!res.ok) throw new Error(`Polymarket API error for tag ${tagId}: ${res.status}`)
        return (await res.json()) as GammaEventRaw[]
      })
    )

    const mergedEvents = new Map<string, GammaEventRaw>()
    for (const result of eventResults) {
      if (result.status !== "fulfilled") {
        console.warn("[rawali] Polymarket category feed skipped:", result.reason)
        continue
      }
      for (const event of result.value) {
        const key = event.id ?? event.slug ?? event.title
        if (key && !mergedEvents.has(key)) mergedEvents.set(key, event)
      }
    }
    if (mergedEvents.size === 0) {
      const failed = eventResults.find((result) => result.status === "rejected")
      if (failed && failed.status === "rejected") throw failed.reason
    }

    const events = sortGammaEvents(Array.from(mergedEvents.values()), sortBy)
    const needles = getCategoryNeedles(category)
    const normalizedCategory = normalizeCategory(category)
    const exclusionNeedles = categoryExclusionNeedles[normalizedCategory] ?? []

    const now = Date.now()
    const dailyCutoff = now + DAILY_MARKET_WINDOW_MS
    const deduped: FeedGammaMarket[] = []
    const seenMarkets = new Set<string>()
    for (const event of events) {
      const markets = event.markets ?? []
      const candidates = markets.filter((m) => (m.active ?? true) && !m.closed)
      if (!candidates.length) continue

      for (const candidate of candidates) {
        const haystack = marketText(event, candidate)
        if (needles.length) {
          const fuzzyMatch = needles.length > 0 ? needles.some((needle) => includesNeedle(haystack, needle.toLowerCase())) : false
          const excluded = exclusionNeedles.some((needle) => includesNeedle(haystack, needle.toLowerCase()))
          if (!fuzzyMatch || excluded) continue
        }

        const endDate = candidate.endDate ?? candidate.end_date_iso ?? event.endDate
        if (endDate) {
          const endMs = new Date(endDate).getTime()
          if (!Number.isNaN(endMs) && endMs < now) continue
          if (sortBy === "daily" && !Number.isNaN(endMs) && endMs > dailyCutoff) continue
        } else if (sortBy === "daily") {
          continue
        }

        const liquidity = numberValue(candidate.liquidity ?? event.liquidity)
        const volume = numberValue(candidate.volume24hr ?? candidate.volume_24hr ?? candidate.volume ?? event.volume24hr ?? event.volume_24hr ?? event.volume)
        const opportunity = priceOpportunityScore(candidate)
        if (sortBy === "daily" && liquidity < DAILY_MARKET_MIN_LIQUIDITY) continue
        if (sortBy === "trending" && liquidity < NICE_MARKET_MIN_LIQUIDITY && volume < NICE_MARKET_MIN_VOLUME) continue
        if ((sortBy === "trending" || sortBy === "daily") && opportunity < 0.04) continue

        const key = marketKey(candidate, event)
        if (key && seenMarkets.has(key)) continue
        if (key) seenMarkets.add(key)

        const enriched: FeedGammaMarket = {
          ...candidate,
          question: candidate.question ?? event.title,
          image: candidate.image ?? event.image,
          icon: candidate.icon ?? event.icon,
          category: candidate.category ?? event.category,
          volume: candidate.volume ?? event.volume ?? event.volume24hr ?? event.volume_24hr ?? 0,
          liquidity: candidate.liquidity ?? event.liquidity ?? 0,
          endDate,
          tags: candidate.tags ?? event.tags,
        }
        enriched.feedBadges = qualityBadges({
          market: enriched,
          event,
          now,
          text: haystack,
          volume,
          liquidity,
          endDate,
        })
        enriched.smartScore = smartMarketScore({
          market: enriched,
          event,
          now,
          text: haystack,
          volume,
          liquidity,
          endDate,
          normalizedCategory,
        })
        deduped.push(enriched)
      }
    }

    const filteredBySearch = search
      ? deduped.filter((m) => {
          const q = search.toLowerCase()
          const question = (m.question ?? "").toLowerCase()
          const category = (m.category ?? "").toLowerCase()
          const slug = (m.slug ?? "").toLowerCase()
          const tags = (m.tags ?? []).map((t) => t.label ?? "").join(" ").toLowerCase()
          const outcomes = Array.isArray(m.outcomes)
            ? m.outcomes.join(" ").toLowerCase()
            : typeof m.outcomes === "string"
            ? m.outcomes.toLowerCase()
            : ""
          return (
            question.includes(q) ||
            category.includes(q) ||
            tags.includes(q) ||
            slug.includes(q) ||
            outcomes.includes(q)
          )
        })
      : deduped

    if (sortBy === "daily") {
      filteredBySearch.sort((a, b) => {
        const liquidityDelta = numberValue(b.liquidity) - numberValue(a.liquidity)
        if (liquidityDelta !== 0) return liquidityDelta
        const volumeDelta =
          numberValue(b.volume24hr ?? b.volume_24hr ?? b.volume) -
          numberValue(a.volume24hr ?? a.volume_24hr ?? a.volume)
        if (volumeDelta !== 0) return volumeDelta
        return timeValue(a.endDate ?? a.end_date_iso) - timeValue(b.endDate ?? b.end_date_iso)
      })
    } else if (sortBy === "trending") {
      filteredBySearch.sort((a, b) => (b.smartScore ?? 0) - (a.smartScore ?? 0))
    }

    const finalMarkets = sortBy === "trending" && !search
      ? blendSmartMarkets(filteredBySearch, limit, now)
      : filteredBySearch.slice(0, limit)

    return finalMarkets.map((m) => ({
      id: m.id,
      source: "polymarket" as const,
      question: m.question,
      description: m.description,
      image: m.image,
      icon: m.icon,
      category: m.category ?? m.tags?.[0]?.label ?? "General",
      volume: formatVolume(m.volume),
      liquidity: formatVolume(m.liquidity),
      endDate: m.endDate ?? m.end_date_iso ?? "",
      outcomes: parseOutcomes(m),
      tokenIds: parseTokenIds(m),
      active: m.active ?? !m.closed,
      new: m.new ?? false,
      featured: m.featured ?? false,
      slug: m.slug ?? m.id,
      conditionId: m.conditionId,
      tags: m.tags?.map((t) => t.label) ?? [],
      createdAt: m.createdAt ?? m.startDate,
      feedBadges: m.feedBadges,
    }))
  } catch (err) {
    console.error("[rawali] Polymarket fetch error:", err)
    throw err
  }
}
