const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000"

export type EdgeHit = {
  marketId: string
  question: string
  category: string
  slug: string
  endDate: string | null
  engine: "ta" | "fundamental"
  symbol: string | null
  currentPrice: number | null
  direction: "YES" | "NO"
  confidence: number
  modelProbability: number
  marketProbability: number
  blendedProbability: number
  edge: number              // model − market  (positive = market underprices YES)
  absEdge: number
  signalAgreement: number
  netScore: number
  regime: string
  mappingNote: string
}

export type EdgeScanResult = {
  ok: boolean
  scannedAt: string
  marketsScanned: number
  symbolsAnalyzed: number
  edgeHits: EdgeHit[]
  errors: string[]
}

export async function fetchEdges(opts: {
  minEdge?: number
  limit?: number
} = {}): Promise<EdgeScanResult> {
  const params = new URLSearchParams()
  if (opts.minEdge != null) params.set("min_edge", String(opts.minEdge))
  if (opts.limit   != null) params.set("limit",    String(opts.limit))

  const res = await fetch(`${API_BASE}/analysis/edges?${params}`, {
    headers: { Accept: "application/json" },
    next: { revalidate: 90 },       // 90s cache on server components
  } as RequestInit)

  if (!res.ok) throw new Error("Edge scanner unavailable")
  return res.json() as Promise<EdgeScanResult>
}
