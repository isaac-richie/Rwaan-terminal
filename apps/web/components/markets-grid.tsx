"use client"

import { useEffect, useMemo, useState, useRef, useCallback } from "react"
import { Loader2, RefreshCw, AlertCircle } from "lucide-react"
import { TradingCard } from "./trading-card"
import { fetchMarkets } from "@/lib/markets"
import type { PolymarketMarket } from "@/lib/polymarket"

interface MarketsGridProps {
  category: string
  sortBy: string
  search?: string
}

function marketIdentity(market: PolymarketMarket) {
  return String(market.id || market.conditionId || market.slug || `${market.question}-${market.endDate}`)
}

function marketRenderKey(market: PolymarketMarket, index: number) {
  return [
    market.id,
    market.conditionId,
    market.slug,
    index,
  ].filter(Boolean).join(":")
}

function dedupeMarkets(markets: PolymarketMarket[]) {
  const seen = new Set<string>()
  return markets.filter((market) => {
    const key = marketIdentity(market)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function MarketsGrid({ category, sortBy, search }: MarketsGridProps) {
  const [markets, setMarkets] = useState<PolymarketMarket[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const fetchKey = useRef<string>("")

  const load = useCallback(
    async (nextPage: number, reset = false) => {
      const key = `${category}-${sortBy}-${search ?? ""}`
      fetchKey.current = key
      setLoading(true)
      setError(null)

      try {
        const limit = 12
        const offset = reset ? 0 : nextPage * limit
        const data = await fetchMarkets(category, limit, sortBy, offset, search)

        if (fetchKey.current !== key) return

        if (reset) {
          setMarkets(dedupeMarkets(data))
          setPage(1)
        } else {
          setMarkets((prev) => dedupeMarkets([...prev, ...data]))
          setPage(nextPage + 1)
        }
        setHasMore(data.length === limit)
      } catch (err) {
        if (fetchKey.current !== key) return
        setError("Failed to load events. Please try again.")
      } finally {
        if (fetchKey.current === key) setLoading(false)
      }
    },
    [category, sortBy, search]
  )

  useEffect(() => {
    setPage(0)
    load(0, true)
  }, [category, sortBy, search, load])

  const filteredMarkets = useMemo(() => markets, [markets])

  if (loading && markets.length === 0) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="surface-card rounded-2xl overflow-hidden" style={{ animationDelay: `${i * 60}ms` }}>
            <div className="h-24 shimmer" />
            <div className="p-4 space-y-3">
              <div className="h-4 shimmer rounded-md w-full" />
              <div className="h-4 shimmer rounded-md w-4/5" />
              <div className="h-2 shimmer rounded-full w-full mt-4" />
              <div className="flex gap-2 mt-4">
                <div className="h-8 shimmer rounded-xl flex-1" />
                <div className="h-8 shimmer rounded-xl flex-1" />
              </div>
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4 text-muted-foreground">
        <AlertCircle className="w-8 h-8 text-[oklch(0.58_0.2_25)]" />
        <p className="text-sm">{error}</p>
        <button
          onClick={() => load(0, true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[oklch(0.18_0.014_255)] border border-[oklch(0.22_0.015_255)] text-sm font-medium hover:border-[oklch(0.78_0.16_82/0.4)] transition-all"
        >
          <RefreshCw className="w-4 h-4" />
          Retry
        </button>
      </div>
    )
  }

  if (!loading && filteredMarkets.length === 0) {
    const categoryLabel = category === "all" ? "Rawli categories" : category === "Sports" ? "Sport" : category

    return (
      <div className="surface-card rounded-2xl p-8 text-center border border-[oklch(0.22_0.015_255)]">
        <p className="text-sm font-semibold text-foreground">No active events in {categoryLabel} right now.</p>
        <p className="text-xs text-muted-foreground mt-2">
          Rawli is focused on Entertainment, Sport, News, Crypto, and Geopolitics. Try a broader category or remove your search term.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
        {filteredMarkets.map((market, i) => (
          <TradingCard
            key={marketRenderKey(market, i)}
            market={market}
            index={i}
          />
        ))}
      </div>

      {hasMore && !search && (
        <div className="flex justify-center pt-4">
          <button
            onClick={() => load(page, false)}
            disabled={loading}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-[oklch(0.18_0.014_255)] border border-[oklch(0.22_0.015_255)] text-sm font-medium text-muted-foreground hover:border-[oklch(0.78_0.16_82/0.4)] hover:text-foreground disabled:opacity-50 transition-all duration-200"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            {loading ? "Loading..." : "Load More Events"}
          </button>
        </div>
      )}
    </div>
  )
}
