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
    backedStatus: "not_used"
    ondoStatus: "secondary_market_candidate"
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
  listedAt?: string
  volumeRank?: number
  route?: RwaRouteHealth
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
  volume: number | null
  currency: string
  source: string
  delayed: boolean
  fetchedAt: string
}

export type RegionEligibility = {
  region: string
  backed: { status: "not_used"; note: string }
  ondo: { status: "eligible" | "qualified_investor_only" | "blocked" | "review"; note: string }
}

export type RwaRouteHealth = {
  symbol: string
  status: "blocked" | "watch_only" | "tradable" | "route_unsafe" | "quote_adapter_unavailable"
  tradable: boolean
  exitVerified: boolean
  source: string
  chain: {
    name: "BNB Chain"
    chainId: 56
  }
  token: {
    symbol: string | null
    address: string | null
    decimals: number | null
    logoURI?: string
  }
  settlementAsset: {
    symbol: "USDT"
    address: string
    decimals: 18
  }
  dex?: {
    venue: "PancakeSwap V3" | "PancakeSwapX"
    router?: string
    quoter?: string
    factory?: string
    fee?: number
    pool?: string
    roundTripBps: number
    testInputRaw: string
    testTokenOutRaw: string
    testSellBackRaw: string
  }
  buy: {
    enabled: boolean
    status: "enabled" | "blocked" | "token_missing" | "route_unsafe" | "quote_adapter_unavailable"
    note: string
  }
  sell: {
    enabled: boolean
    status: "enabled" | "blocked" | "token_missing" | "route_unsafe" | "quote_adapter_unavailable"
    note: string
  }
  copy: {
    primary: string
    secondary: string
  }
}

export type RwaSwapQuote = {
  symbol: string
  side: "buy" | "sell"
  venue: "PancakeSwap V3" | "PancakeSwapX"
  chainId: 56
  router: string
  spender: string
  quoter: string
  factory: string
  fee: number
  pool: string
  slippageBps: number
  roundTripBps: number
  lowLiquidity?: boolean
  tokenIn: {
    symbol: string
    address: string
    decimals: number
  }
  tokenOut: {
    symbol: string
    address: string
    decimals: number
  }
  amountInRaw: string          // total user pays (including platform fee)
  amountInHuman: string
  swapAmountInRaw?: string     // amount sent to DEX (after fee deduction)
  swapAmountInHuman?: string
  amountOutRaw: string
  amountOutHuman: string
  amountOutMinimumRaw: string
  amountOutMinimumHuman: string
  gasEstimate: string
  generatedAt: string
  platformFee?: {
    bps: number
    amountRaw: string
    amountHuman: string
    receiver: string
    token: { symbol: string; address: string; decimals: number }
  } | null
  execution:
    | { kind: "v3" }
    | {
        kind: "pcsx"
        orderType: "DUTCH_LIMIT"
        quoteId: string
        encodedOrder: string
        orderHash: string | null
        permitData: {
          domain: Record<string, unknown>
          types: Record<string, Array<{ name: string; type: string }>>
          values: Record<string, unknown>
          primaryType?: string
        }
        orderInfo: Record<string, unknown>
        permit2: string
        reactor: string
        swapper: string
        recipient: string
      }
}

export type RwaAssetsResponse = {
  ok: true
  assets: RwaAsset[]
  eligibility: RegionEligibility
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

export async function fetchRwaRouteHealth(symbol: string, region = "NG"): Promise<RwaRouteHealth | null> {
  const url = new URL(`${API_BASE}/rwa/route/health`)
  url.searchParams.set("symbol", symbol)
  url.searchParams.set("region", region)
  const res = await fetch(url.toString(), { headers: { Accept: "application/json" } })
  if (!res.ok) return null
  const data = await res.json() as { ok?: boolean; route?: RwaRouteHealth }
  return data.route ?? null
}

export async function fetchRwaSwapQuote(input: {
  symbol: string
  side: "buy" | "sell"
  amount: string
  slippageBps?: number
  swapper?: string
  recipient?: string
}): Promise<RwaSwapQuote> {
  const url = new URL(`${API_BASE}/rwa/swap/quote`)
  url.searchParams.set("symbol", input.symbol)
  url.searchParams.set("side", input.side)
  url.searchParams.set("amount", input.amount)
  if (input.slippageBps) url.searchParams.set("slippageBps", String(input.slippageBps))
  if (input.swapper) url.searchParams.set("swapper", input.swapper)
  if (input.recipient) url.searchParams.set("recipient", input.recipient)
  const res = await fetch(url.toString(), { headers: { Accept: "application/json" } })
  const data = await res.json().catch(() => null) as { ok?: boolean; quote?: RwaSwapQuote; message?: string; error?: string } | null
  if (!res.ok || !data?.quote) {
    throw new Error(data?.message ?? "Stock route quote unavailable")
  }
  return data.quote
}

export async function submitRwaSwapOrder(input: {
  chainId: 56
  encodedOrder: string
  quoteId: string
  signature: string
}): Promise<{ hash: string; chainId: 56 }> {
  const res = await fetch(`${API_BASE}/rwa/swap/submit`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
  const data = await res.json().catch(() => null) as { ok?: boolean; order?: { hash: string; chainId: 56 }; message?: string } | null
  if (!res.ok || !data?.order?.hash) {
    throw new Error(data?.message ?? "Could not submit this stock order.")
  }
  return data.order
}
