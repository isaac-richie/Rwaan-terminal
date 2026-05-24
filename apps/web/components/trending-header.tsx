"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowUpRight, Flame, TrendingUp } from "lucide-react"
import { fetchMarkets } from "@/lib/markets"
import type { PolymarketMarket } from "@/lib/polymarket"
import { cn } from "@/lib/utils"

function getYesPrice(market: PolymarketMarket): number {
  const yes = market.outcomes?.find((o) => o.name.toLowerCase().includes("yes"))?.price
  const fallback = market.outcomes?.[0]?.price
  return typeof yes === "number" ? yes : typeof fallback === "number" ? fallback : 50
}

export function TrendingHeader() {
  const router = useRouter()
  const [markets, setMarkets] = useState<PolymarketMarket[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const data = await fetchMarkets("all", 12, "trending", 0)
        setMarkets(data.slice(0, 12))
      } catch (err) {
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (loading) {
    return (
      <section className="pt-20 pb-2">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2 mb-3">
            <Flame className="w-3.5 h-3.5 text-[oklch(0.78_0.16_82)]" />
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Hot Right Now</span>
          </div>
          <div className="flex gap-3 overflow-hidden">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="shrink-0 w-60 h-[100px] surface-card rounded-xl shimmer" />
            ))}
          </div>
        </div>
      </section>
    )
  }

  if (markets.length === 0) return null

  return (
    <section className="pt-20 pb-2">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Flame className="w-3.5 h-3.5 text-[oklch(0.78_0.16_82)]" />
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Hot Right Now</span>
            <span className="w-1.5 h-1.5 rounded-full bg-[oklch(0.68_0.18_155)] pulse-dot" />
          </div>
        </div>

        {/* Horizontal scrollable hot strip */}
        <div className="relative">
          {/* Fade masks */}
          <div className="absolute left-0 top-0 bottom-0 w-8 z-10 pointer-events-none bg-gradient-to-r from-[oklch(0.11_0.012_260)] to-transparent" />
          <div className="absolute right-0 top-0 bottom-0 w-8 z-10 pointer-events-none bg-gradient-to-l from-[oklch(0.11_0.012_260)] to-transparent" />

          <div className="flex gap-2.5 overflow-x-auto no-scrollbar pb-1 px-1">
            {markets.map((market) => {
              const price = getYesPrice(market)
              const isUp = price >= 50
              return (
                <button
                  key={market.id}
                  onClick={() => router.push(`/markets/${market.id}`)}
                  className="shrink-0 w-[240px] surface-card surface-card-hover rounded-xl p-3 text-left transition-all group/hot btn-press"
                >
                  <div className="flex items-start gap-2.5">
                    {market.image ? (
                      <img src={market.image} alt="" className="w-9 h-9 rounded-lg object-cover border border-[oklch(0.24_0.016_255)]" />
                    ) : (
                      <div className="w-9 h-9 rounded-lg bg-[oklch(0.18_0.014_255)] border border-[oklch(0.24_0.016_255)]" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-semibold text-foreground line-clamp-2 leading-snug group-hover/hot:text-[oklch(0.92_0.01_90)] transition-colors">
                        {market.question}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-2.5 pt-2 border-t border-[oklch(0.22_0.015_255/0.6)]">
                    <span className={cn(
                      "text-xs font-bold px-2 py-0.5 rounded-md",
                      isUp
                        ? "bg-[oklch(0.68_0.18_155/0.12)] text-[oklch(0.68_0.18_155)]"
                        : "bg-[oklch(0.58_0.2_25/0.12)] text-[oklch(0.60_0.18_25)]"
                    )}>
                      {price.toFixed(0)}¢ Yes
                    </span>
                    <span className="text-[10px] font-mono text-muted-foreground">{market.volume}</span>
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Gold separator */}
        <div className="mt-5 h-px gold-line" />
      </div>
    </section>
  )
}
