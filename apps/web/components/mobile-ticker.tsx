"use client"

import { useEffect, useMemo, useState } from "react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { Flame } from "lucide-react"
import { fetchMarkets } from "@/lib/markets"
import { cn } from "@/lib/utils"
import type { PolymarketMarket } from "@/lib/polymarket"

function getPrimaryPrice(market: PolymarketMarket) {
  const yes = market.outcomes?.find((o) => o.name.toLowerCase().includes("yes"))?.price
  const first = market.outcomes?.[0]?.price
  const p = typeof yes === "number" ? yes : typeof first === "number" ? first : 50
  return Math.max(1, Math.min(99, p))
}

export function MobileTicker() {
  const router = useRouter()
  const [markets, setMarkets] = useState<PolymarketMarket[]>([])

  useEffect(() => {
    let alive = true
    fetchMarkets("all", 12, "trending", 0)
      .then((data) => { if (alive && data.length) setMarkets(data) })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  // Duplicate for seamless infinite loop
  const items = useMemo(() => [...markets, ...markets], [markets])

  if (markets.length === 0) return null

  return (
    <div className="sm:hidden w-full border-b border-[oklch(0.18_0.014_255)] bg-[oklch(0.095_0.012_260)] py-2.5 overflow-hidden">
      {/* Fade edges */}
      <div className="w-full overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_5%,black_95%,transparent)]">
        <div className="ticker-scroll flex min-w-max gap-2 px-2">
          {items.map((market, idx) => {
            const price = getPrimaryPrice(market)
            const isHigh = price >= 55
            const imgSrc = (market.image ?? market.icon) as string | undefined

            return (
              <button
                key={`${market.id}-${idx}`}
                type="button"
                onClick={() => router.push(`/markets/${market.id}`)}
                className="flex w-[220px] items-center gap-2 rounded-xl border border-[oklch(0.20_0.015_255)] bg-[oklch(0.13_0.013_255/0.9)] px-3 py-2 text-left active:scale-[0.98] transition-transform"
              >
                {/* Icon */}
                <span className="relative grid h-6 w-6 shrink-0 place-items-center overflow-hidden rounded-lg border border-[oklch(0.20_0.015_255)] bg-[oklch(0.16_0.014_255)]">
                  {imgSrc ? (
                    <Image
                      src={imgSrc}
                      alt=""
                      fill
                      quality={85}
                      sizes="24px"
                      className="object-contain p-0.5"
                    />
                  ) : (
                    <Flame className="h-3 w-3 text-[oklch(0.78_0.16_82)]" />
                  )}
                </span>

                {/* Question */}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11px] font-semibold text-foreground leading-tight">
                    {market.question}
                  </span>
                  <span className="block mt-0.5 font-mono text-[9px] text-muted-foreground">
                    {market.volume}
                  </span>
                </span>

                {/* Price badge */}
                <span className={cn(
                  "shrink-0 rounded-lg px-1.5 py-0.5 font-mono text-[11px] font-bold",
                  isHigh
                    ? "bg-[oklch(0.68_0.18_155/0.12)] text-[oklch(0.68_0.18_155)]"
                    : "bg-[oklch(0.60_0.18_25/0.10)] text-[oklch(0.62_0.18_25)]",
                )}>
                  {price.toFixed(0)}¢
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
