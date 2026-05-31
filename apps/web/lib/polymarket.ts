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
  feedCategory?: string
  cryptoAsset?: string
  smartScore?: number
}

const categoryNeedles: Record<string, string[]> = {
  africa: [
    // Nations
    "nigeria", "ghana", "senegal", "morocco", "egypt", "south africa",
    "ivory coast", "côte d'ivoire", "cote d'ivoire", "cameroon", "mali",
    "algeria", "tunisia", "kenya", "ethiopia", "angola", "tanzania",
    "uganda", "zambia", "zimbabwe", "rwanda", "mozambique", "benin",
    "burkina faso", "dr congo", "congo", "sudan", "somalia", "libya",
    "gabon", "togo", "senegal", "sierra leone",
    // Competitions
    "afcon", "africa cup", "caf", "super eagles", "black stars",
    "bafana bafana", "pharaohs", "teranga lions", "atlas lions",
    "indomitable lions", "eagles of carthage", "harambee stars",
    // General
    "african", "africa",
    // Economic
    "naira", "cedi", "rand", "birr", "shilling",
  ],
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
  tech: [
    "ai",
    "artificial intelligence",
    "openai",
    "chatgpt",
    "gpt",
    "claude",
    "anthropic",
    "gemini",
    "google",
    "nvidia",
    "spacex",
    "starship",
    "tesla",
    "robotaxi",
    "technology",
    "tech",
    "software",
    "hardware",
    "quantum",
    "nasa",
    "cybertruck",
    "apple",
    "microsoft",
    "meta",
  ],
  finance: [
    "finance",
    "financial",
    "business",
    "economy",
    "economic",
    "macro",
    "fed",
    "fomc",
    "rate cut",
    "rate hike",
    "interest rate",
    "inflation",
    "cpi",
    "gdp",
    "recession",
    "jobs",
    "unemployment",
    "treasury",
    "dollar",
    "stock",
    "stocks",
    "ipo",
    "earnings",
    "nasdaq",
    "s&p",
    "sp500",
    "oil",
    "gold",
    "etf",
    "yield",
    "kraken",
    "coinbase",
    "microstrategy",
  ],
  politics: [
    "politics",
    "political",
    "election",
    "elections",
    "president",
    "senate",
    "senator",
    "congress",
    "parliament",
    "prime minister",
    "government",
    "vote",
    "ballot",
    "poll",
    "campaign",
    "democrat",
    "republican",
  ],
  legal: [
    "legal",
    "court",
    "lawsuit",
    "trial",
    "ruling",
    "verdict",
    "judge",
    "justice",
    "supreme court",
    "regulation",
    "regulatory",
    "ban",
    "sanction",
    "bill",
    "law",
    "legislation",
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
    "ripple",
    "doge",
    "dogecoin",
    "cardano",
    "ada",
    "avalanche",
    "avax",
    "chainlink",
    "link",
    "polkadot",
    "dot",
    "polygon",
    "matic",
    "pol",
    "tron",
    "trx",
    "ton",
    "toncoin",
    "shiba",
    "shib",
    "pepe",
    "bonk",
    "wif",
    "render",
    "near",
    "sui",
    "aptos",
    "apt",
    "arbitrum",
    "arb",
    "optimism",
    "op",
    "memecoin",
    "meme coin",
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

const targetCategoryIds = ["africa", "entertainment", "sports", "news", "crypto", "tech", "finance", "politics", "legal", "geopolitics"] as const
const targetCategoryNeedles = targetCategoryIds.flatMap((id) => categoryNeedles[id])
const categoryFeedTagIds: Record<(typeof targetCategoryIds)[number], string[]> = {
  // Africa: AFCON/ACN tags + Soccer + FIFA WC + Egypt PL + Sports (broad catch-all)
  // 102974 = Africa Cup of Nations, 102969 = Afcon, 100350 = Soccer,
  // 102350 = 2026 FIFA World Cup, 102232 = FIFA World Cup, 104397 = Egypt Premier League
  africa: ["102974", "102969", "100350", "102350", "102232", "104397", "2"],
  entertainment: ["596", "100", "53"],
  sports: ["1"],
  news: ["2", "144"],
  crypto: ["21", "235", "101611", "1312"],
  tech: ["1401", "439", "537", "103303", "101604"],
  finance: ["120", "600", "370", "102000", "101250", "101247", "833"],
  politics: ["2", "144", "100344", "933", "1558", "1588"],
  legal: ["757"],
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
  finance: [
    "will bitcoin hit",
    "will ethereum hit",
    "will solana hit",
    "price of bitcoin",
    "price of ethereum",
    "price of solana",
  ],
  tech: [
    ...categoryNeedles.sports,
    "box office",
    "album",
    "song",
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

const cryptoAssetNeedles: Record<string, string[]> = {
  BTC: ["bitcoin", "btc"],
  ETH: ["ethereum", "ether", "eth"],
  SOL: ["solana", "sol"],
  BNB: ["bnb", "binance coin"],
  XRP: ["xrp", "ripple"],
  DOGE: ["dogecoin", "doge"],
  ADA: ["cardano", "ada"],
  AVAX: ["avalanche", "avax"],
  LINK: ["chainlink", "link"],
  DOT: ["polkadot", "dot"],
  POL: ["polygon", "matic", "pol"],
  TRX: ["tron", "trx"],
  TON: ["toncoin", "ton"],
  SHIB: ["shiba", "shib"],
  PEPE: ["pepe"],
  WIF: ["wif", "dogwifhat"],
  BONK: ["bonk"],
  RENDER: ["render", "rndr"],
  NEAR: ["near protocol", "near"],
  SUI: ["sui"],
  APT: ["aptos", "apt"],
  ARB: ["arbitrum", "arb"],
  OP: ["optimism"],
}

function detectCryptoAsset(text: string): string | null {
  for (const [asset, needles] of Object.entries(cryptoAssetNeedles)) {
    if (needles.some((needle) => includesNeedle(text, needle.toLowerCase()))) return asset
  }
  return null
}

function isAfricaMarket(text: string): boolean {
  return categoryNeedles.africa.some((needle) => includesNeedle(text, needle.toLowerCase()))
}

function detectTargetCategory(text: string): string | null {
  const priority = ["crypto", "tech", "finance", "geopolitics", "politics", "legal", "sports", "entertainment", "africa", "news"]
  for (const category of priority) {
    const needles = categoryNeedles[category]
    if (needles?.some((needle) => includesNeedle(text, needle.toLowerCase()))) return category
  }
  return null
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
  const quick = isQuickSettle(input.endDate, input.now)
  const crypto = isCryptoMarket(input.text)
  const asset = crypto ? detectCryptoAsset(input.text) : null
  const africa = isAfricaMarket(input.text)
  if (asset) badges.push(asset)
  // Highest-priority combo badge
  if (quick && crypto) badges.push("24h Crypto")
  else if (quick) badges.push("Closes today")
  else if (crypto) badges.push("Crypto")
  if (africa) badges.push("Africa")
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
  const detectedCategory = detectTargetCategory(input.text)
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

  // 24h crypto combo is the highest-value content on the feed
  const cryptoQuickBoost = quick && crypto ? 30 : 0
  const africa = isAfricaMarket(input.text)
  // Africa markets get a boost when browsing the Africa category
  const africaBoost = africa && input.normalizedCategory === "africa" ? 25 : 0
  const categoryBoost = input.normalizedCategory !== "all" && input.normalizedCategory === detectedCategory ? 18 : 0

  return (
    logScore(input.liquidity) * 32 +
    logScore(input.volume) * 24 +
    (quick ? 22 : urgency * 12) +
    (crypto ? (input.normalizedCategory === "crypto" ? 26 : 16) : 0) +
    cryptoQuickBoost +
    africaBoost +
    categoryBoost +
    priceOpportunityScore(input.market) * 10 +
    (hasTokens ? 8 : 0) +
    (hasVisual ? 5 : 0) +
    (input.market.featured || input.event.featured ? 3 : 0)
  )
}

function marketKey(market: GammaMarketRaw, event: GammaEventRaw) {
  return market.id ?? market.slug ?? market.conditionId ?? `${event.id}:${market.question}`
}

function pickUniqueMarkets(markets: FeedGammaMarket[], limit: number, used = new Set<string>()) {
  const selected: FeedGammaMarket[] = []
  for (const market of markets) {
    const key = market.id ?? market.slug ?? market.conditionId ?? market.question
    if (key && used.has(key)) continue
    if (key) used.add(key)
    selected.push(market)
    if (selected.length >= limit) break
  }
  return selected
}

function blendAllCategoryMarkets(markets: FeedGammaMarket[], limit: number): FeedGammaMarket[] {
  const used = new Set<string>()
  const sorted = [...markets].sort((a, b) => (b.smartScore ?? 0) - (a.smartScore ?? 0))
  const priority = ["crypto", "tech", "finance", "geopolitics", "politics", "sports", "entertainment", "africa", "legal", "news"]
  const categorySlots = Math.min(priority.length, Math.max(5, Math.round(limit * 0.7)))
  const selected: FeedGammaMarket[] = []

  for (const category of priority) {
    if (selected.length >= categorySlots) break
    selected.push(...pickUniqueMarkets(sorted.filter((market) => market.feedCategory === category), 1, used))
  }

  selected.push(...pickUniqueMarkets(sorted, limit - selected.length, used))
  return selected.sort((a, b) => (b.smartScore ?? 0) - (a.smartScore ?? 0)).slice(0, limit)
}

function blendCryptoAssetMarkets(markets: FeedGammaMarket[], limit: number, now: number): FeedGammaMarket[] {
  const used = new Set<string>()
  const sorted = [...markets].sort((a, b) => (b.smartScore ?? 0) - (a.smartScore ?? 0))
  const assetPriority = ["BTC", "ETH", "SOL", "BNB", "XRP", "DOGE", "ADA", "AVAX", "LINK", "PEPE", "WIF", "BONK", "TRX", "TON"]
  const assetSlots = Math.min(assetPriority.length, Math.max(4, Math.round(limit * 0.65)))
  const selected: FeedGammaMarket[] = []

  for (const asset of assetPriority) {
    if (selected.length >= assetSlots) break
    selected.push(...pickUniqueMarkets(sorted.filter((market) => market.cryptoAsset === asset), 1, used))
  }

  selected.push(
    ...pickUniqueMarkets(
      sorted.filter((market) => market.feedBadges?.includes("24h Crypto") || isQuickSettle(market.endDate ?? market.end_date_iso, now)),
      Math.max(0, Math.round(limit * 0.25)),
      used
    )
  )
  selected.push(...pickUniqueMarkets(sorted, limit - selected.length, used))
  return selected.sort((a, b) => (b.smartScore ?? 0) - (a.smartScore ?? 0)).slice(0, limit)
}

function blendSmartMarkets(markets: FeedGammaMarket[], limit: number, now: number): FeedGammaMarket[] {
  const used = new Set<string>()
  const pick = (pool: FeedGammaMarket[], count: number) => {
    return pickUniqueMarkets(pool, count, used)
  }

  const sorted = [...markets].sort((a, b) => (b.smartScore ?? 0) - (a.smartScore ?? 0))

  // Priority 1: crypto markets closing within 24h (most valuable slot)
  const cryptoQuickCount = Math.max(3, Math.round(limit * 0.30))
  // Priority 2: non-crypto quick-settle markets
  const quickCount = Math.max(1, Math.round(limit * 0.15))
  // Priority 3: crypto markets not closing today
  const cryptoCount = Math.max(2, Math.round(limit * 0.25))

  const cryptoQuick = pick(
    sorted.filter((m) => m.feedBadges?.includes("24h Crypto")),
    cryptoQuickCount
  )
  const quick = pick(
    sorted.filter((m) => isQuickSettle(m.endDate ?? m.end_date_iso, now) && !m.feedBadges?.includes("24h Crypto")),
    quickCount
  )
  const crypto = pick(
    sorted.filter((m) => m.feedBadges?.includes("Crypto") && !m.feedBadges?.includes("24h Crypto")),
    cryptoCount
  )
  const rest = pick(sorted, limit - cryptoQuick.length - quick.length - crypto.length)

  return [...cryptoQuick, ...quick, ...crypto, ...rest]
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

// ─── In-flight request dedup ─────────────────────────────────────────────────
// Prevents hero + grid from firing duplicate API requests for the same data.
const inflightGamma = new Map<string, Promise<GammaEventRaw[]>>()

function fetchGammaEventsDeduped(url: string): Promise<GammaEventRaw[]> {
  const existing = inflightGamma.get(url)
  if (existing) return existing

  const promise = (async () => {
    let res = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" })
    if (!res.ok) {
      // Retry with "volume" order if volume_24hr fails
      const retryUrl = url.replace("order=volume_24hr", "order=volume")
      if (retryUrl !== url) {
        res = await fetch(retryUrl, { headers: { Accept: "application/json" }, cache: "no-store" })
      }
    }
    if (!res.ok) throw new Error(`Gamma API error: ${res.status}`)
    return (await res.json()) as GammaEventRaw[]
  })()
  inflightGamma.set(url, promise)
  // Remove after 8s so next load gets fresh data
  promise.then(
    () => setTimeout(() => inflightGamma.delete(url), 8000),
    () => setTimeout(() => inflightGamma.delete(url), 8000)
  )
  return promise
}

/**
 * Batch fetch: sends all tag IDs in ONE request to the backend batch endpoint.
 * Backend fans out to Gamma API (with cache) and merges results server-side.
 * This eliminates N parallel round-trips from the browser.
 */
function fetchGammaEventsBatch(
  baseParams: URLSearchParams,
  tagIds: string[]
): Promise<GammaEventRaw[]> {
  const params = new URLSearchParams(baseParams)
  params.set("tag_ids", tagIds.join(","))
  params.set("compact", "true")
  const url = `${API_BASE}/gamma/events/batch?${params.toString()}`
  return fetchGammaEventsDeduped(url)
}

function fetchGammaMarketsAsEvents(baseParams: URLSearchParams): Promise<GammaEventRaw[]> {
  const params = new URLSearchParams(baseParams)
  const url = `${API_BASE}/gamma/markets?${params.toString()}`
  return fetchGammaEventsDeduped(url).then((markets) => [
    {
      id: "fallback-markets",
      title: "Fallback markets",
      active: true,
      closed: false,
      markets: Array.isArray(markets) ? (markets as unknown as GammaMarketRaw[]) : [],
    },
  ])
}

// For "all" + trending/volume, use curated tags across categories Rawli can analyze.
// This gives the first screen category diversity instead of whichever single tag is hottest.
const FAST_ALL_TAG_IDS = Array.from(new Set(targetCategoryIds.flatMap((id) => categoryFeedTagIds[id])))

export async function fetchPolymarketMarkets(
  category?: string,
  limit = 24,
  sortBy = "volume",
  offset = 0,
  search?: string
): Promise<PolymarketMarket[]> {
  try {
    const normalizedCat = normalizeCategory(category)
    const fastAllFeed = normalizedCat === "all" && (sortBy === "trending" || sortBy === "volume") && !search
    const cryptoCategory = normalizedCat === "crypto"
    const fetchLimit =
      fastAllFeed
        ? Math.max(limit * 8, 96)
        : cryptoCategory
        ? Math.max(limit * 20, 240)
        : sortBy === "daily"
        ? Math.max(limit * 24, 240)
        : Math.max(limit * 8, 96)
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
      baseParams.set("limit", Math.max(limit * 8, 120).toString())
      baseParams.set("offset", "0")
    }

    // Fast path: "all" uses the curated category tag union, served from backend prewarm caches.
    const tagIds = fastAllFeed
      ? FAST_ALL_TAG_IDS
      : getCategoryFeedTagIds(category)
    if (tagIds.length === 0) return []

    let batchEvents: GammaEventRaw[]
    try {
      batchEvents = await fetchGammaEventsBatch(baseParams, tagIds)
    } catch (err) {
      if (!fastAllFeed) throw err
      batchEvents = await fetchGammaMarketsAsEvents(baseParams)
    }

    const mergedEvents = new Map<string, GammaEventRaw>()
    for (const event of batchEvents) {
      const key = event.id ?? event.slug ?? event.title
      if (key && !mergedEvents.has(key)) mergedEvents.set(key, event)
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
        // Crypto markets get a lower liquidity floor — they're always active and valuable even at lower depth
        const cryptoMarket = isCryptoMarket(haystack)
        const liquidityFloor = cryptoMarket ? 50 : NICE_MARKET_MIN_LIQUIDITY
        if (sortBy === "trending" && liquidity < liquidityFloor && volume < NICE_MARKET_MIN_VOLUME) continue
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
        enriched.feedCategory = detectTargetCategory(haystack) ?? normalizedCategory
        enriched.cryptoAsset = detectCryptoAsset(haystack) ?? undefined
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
      ? normalizedCategory === "all"
        ? blendAllCategoryMarkets(filteredBySearch, limit)
        : normalizedCategory === "crypto"
        ? blendCryptoAssetMarkets(filteredBySearch, limit, now)
        : blendSmartMarkets(filteredBySearch, limit, now)
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
    console.error("[rawli] Polymarket fetch error:", err)
    throw err
  }
}
