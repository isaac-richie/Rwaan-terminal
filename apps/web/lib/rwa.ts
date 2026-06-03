const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000"

export type RwaAsset = {
  id: string
  symbol: string
  displaySymbol: string
  name: string
  assetClass: "equity" | "etf"
  sector: string
  sectorGroup: string
  theme: string
  quoteSymbol: string
  polymarketKeyword?: string
  provider: {
    preferred: "ondo"
    chain: "BNB Chain"
    route: "PancakeSwap RWA"
    backedStatus: "blocked_nigeria"
    ondoStatus: "eligibility_review"
  }
  trading: {
    enabled: false
    status: "routing_pending"
    note: string
  }
  analysis: {
    enabled: false
    status: "coming_next"
  }
  risk: "medium" | "high"
  accent: string
}

export type RelatedMarket = {
  id: string
  question: string
  slug: string
  yesPrice: number | null
  volume: number
  endDate: string | null
}

export type RwaQuote = {
  symbol: string
  price: number | null
  previousClose: number | null
  change: number | null
  changePct: number | null
  currency: string
  source: string
  delayed: boolean
  fetchedAt: string
}

export type RwaAssetsResponse = {
  ok: true
  assets: RwaAsset[]
  eligibility: {
    region: string
    backed: { status: string; note: string }
    ondo: { status: string; note: string }
  }
  disclaimers: string[]
}

export async function fetchRwaAssets(region = "NG"): Promise<RwaAssetsResponse> {
  const url = new URL(`${API_BASE}/rwa/assets`)
  url.searchParams.set("region", region)
  const res = await fetch(url.toString(), { headers: { Accept: "application/json" } })
  if (!res.ok) throw new Error("RWA asset catalog unavailable")
  return res.json()
}

export async function fetchRwaQuotes(symbols: string[]): Promise<Record<string, RwaQuote>> {
  if (!symbols.length) return {}
  const url = new URL(`${API_BASE}/rwa/quotes`)
  url.searchParams.set("symbols", symbols.join(","))
  const res = await fetch(url.toString(), { headers: { Accept: "application/json" } })
  if (!res.ok) throw new Error("RWA quotes unavailable")
  const data = await res.json() as { ok?: boolean; quotes?: RwaQuote[] }
  return Object.fromEntries((data.quotes ?? []).map((quote) => [quote.symbol, quote]))
}

export async function fetchRelatedMarkets(assetId: string): Promise<RelatedMarket[]> {
  const url = new URL(`${API_BASE}/rwa/related-markets`)
  url.searchParams.set("asset_id", assetId)
  const res = await fetch(url.toString(), { headers: { Accept: "application/json" } })
  if (!res.ok) return []
  const data = await res.json() as { ok?: boolean; markets?: RelatedMarket[] }
  return data.markets ?? []
}
