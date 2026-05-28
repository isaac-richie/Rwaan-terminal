"use client"

import { useEffect, useMemo, useState, useRef, useCallback } from "react"
import { Loader2, RefreshCw, AlertCircle } from "lucide-react"
import { TradingCard } from "./trading-card"
import { fetchMarkets, getCachedMarkets, scheduleCategoryPrefetch } from "@/lib/markets"
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
  // Hydrate from module-level cache so re-navigation never shows shimmers
  const initial = getCachedMarkets(category, 12, sortBy, 0, search)
  const [markets, setMarkets] = useState<PolymarketMarket[]>(initial ?? [])
  const [loading, setLoading] = useState(!initial)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(initial ? 1 : 0)
  const [hasMore, setHasMore] = useState(true)
  const fetchKey = useRef<string>("")

  const load = useCallback(
    async (nextPage: number, reset = false) => {
      const key = `${category}-${sortBy}-${search ?? ""}`
      fetchKey.current = key
      setError(null)

      // On reset (category switch), show cached data immediately if available
      if (reset) {
        const cached = getCachedMarkets(category, 12, sortBy, 0, search)
        if (cached && cached.length > 0) {
          setMarkets(dedupeMarkets(cached))
          setPage(1)
          setHasMore(cached.length >= 12)
          // Still fetch fresh data in the background, but don't show loading state
        } else {
          setLoading(true)
        }
      } else {
        setLoading(true)
      }

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
        // After first successful load, prefetch other categories in background
        if (reset && nextPage === 0) scheduleCategoryPrefetch()
      } catch (err) {
        if (fetchKey.current !== key) return
        // Only show error if we have no cached data to display
        if (markets.length === 0) {
          setError("Failed to load events. Please try again.")
        }
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
            <div className="p-3.5 sm:p-4 space-y-2.5 sm:space-y-3">
              <div className="flex items-start gap-2.5">
                <div className="h-10 w-10 sm:h-11 sm:w-11 rounded-xl shimmer shrink-0" />
                <div className="flex-1 space-y-2 pt-1">
                  <div className="h-3 shimmer rounded-md w-16" />
                  <div className="h-4 shimmer rounded-md w-full" />
                  <div className="h-4 shimmer rounded-md w-3/4" />
                </div>
              </div>
              <div className="h-1.5 sm:h-2 shimmer rounded-full w-full" />
              <div className="flex items-center justify-between">
                <div className="h-3 shimmer rounded-md w-20" />
                <div className="flex gap-1.5">
                  <div className="h-8 w-16 shimmer rounded-xl" />
                  <div className="h-8 w-16 shimmer rounded-xl" />
                </div>
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
