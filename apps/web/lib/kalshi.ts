import type { PolymarketMarket, PolymarketOutcome } from "./polymarket"

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000"

interface KalshiMarketRaw {
  ticker?: string
  event_ticker?: string
  title?: string
  subtitle?: string
  yes_bid?: number
  yes_ask?: number
  no_bid?: number
  no_ask?: number
  volume?: number
  open_interest?: number
  close_time?: string
  expiration_time?: string
  status?: string
}

interface KalshiEventRaw {
  event_ticker?: string
  title?: string
  subtitle?: string
  category?: string
  settlement_time?: string
  markets?: KalshiMarketRaw[]
}

function toPercent(v?: number) {
  if (typeof v !== "number" || Number.isNaN(v)) return 50
  if (v <= 1) return Math.max(0, Math.min(100, v * 100))
  return Math.max(0, Math.min(100, v))
}

function formatUsd(n?: number) {
  if (typeof n !== "number" || Number.isNaN(n)) return "$0"
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`
  return `$${n.toFixed(0)}`
}

function mapOutcomes(m: KalshiMarketRaw): PolymarketOutcome[] {
  const yes = toPercent(m.yes_bid ?? m.yes_ask)
  const no = toPercent(m.no_bid ?? m.no_ask ?? 100 - yes)
  return [{ name: "Yes", price: yes }, { name: "No", price: no }]
}

function includesCategory(text: string, category: string) {
  const c = category.toLowerCase()
  const map: Record<string, string[]> = {
    entertainment: ["entertainment", "culture", "music", "movie", "film", "tv", "celebrity", "awards"],
    sport: ["sport", "sports", "nba", "nfl", "mlb", "nhl", "soccer", "football", "ufc", "tennis", "f1"],
    sports: ["sport", "sports", "nba", "nfl", "mlb", "nhl", "soccer", "football", "ufc", "tennis", "f1"],
    news: ["news", "breaking", "election", "government", "policy", "court", "fed", "inflation"],
    crypto: ["crypto", "bitcoin", "btc", "ethereum", "eth", "bnb", "binance", "solana", "xrp", "defi", "etf"],
    geopolitics: ["geopolitics", "war", "china", "iran", "russia", "ukraine", "israel", "gaza", "taiwan", "nato"],
  }
  if (c === "all") {
    return Object.values(map).flat().some((needle) => text.includes(needle))
  }
  const needles = map[c] ?? [c]
  return needles.some((needle) => text.includes(needle))
}

export async function fetchKalshiMarkets(
  category = "all",
  limit = 24,
  _sortBy = "trending",
  offset = 0,
  search?: string
): Promise<PolymarketMarket[]> {
  try {
    const params = new URLSearchParams({
      limit: String(Math.max(limit * 2, 50)),
      status: "open"
    })
    const res = await fetch(`${API_BASE}/kalshi/events?${params.toString()}`, {
      headers: { Accept: "application/json" }
    })
    if (!res.ok) throw new Error(`Kalshi API error: ${res.status}`)
    const json = await res.json()
    const events: KalshiEventRaw[] = Array.isArray(json?.events) ? json.events : []
    const q = (search ?? "").trim().toLowerCase()

    const flattened = events.flatMap((event) => {
      const markets = Array.isArray(event.markets) ? event.markets : []
      return markets.map((m) => {
        const question = m.title ?? event.title ?? m.subtitle ?? "Kalshi Market"
        const cat = event.category ?? "General"
        const text = `${question} ${cat} ${event.subtitle ?? ""}`.toLowerCase()
        if (!includesCategory(text, category)) return null
        if (q && !text.includes(q)) return null
        return {
          id: m.ticker ?? `${event.event_ticker ?? "kalshi"}-${question}`,
          source: "kalshi" as const,
          question,
          description: event.subtitle ?? m.subtitle,
          category: cat,
          volume: formatUsd(m.volume),
          liquidity: formatUsd(m.open_interest),
          endDate: m.close_time ?? m.expiration_time ?? event.settlement_time ?? "",
          outcomes: mapOutcomes(m),
          tokenIds: [],
          active: true,
          new: false,
          featured: false,
          slug: m.ticker ?? `${event.event_ticker ?? "kalshi"}`,
          tags: [cat],
          createdAt: undefined,
          image: undefined,
          icon: undefined,
          conditionId: undefined
        } satisfies PolymarketMarket
      }).filter(Boolean) as PolymarketMarket[]
    })

    return flattened.slice(offset, offset + limit)
  } catch (error) {
    console.error("[rawli] Kalshi fetch error:", error)
    return []
  }
}
