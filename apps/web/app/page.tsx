"use client"

import { Suspense, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Navbar } from "@/components/navbar"
import { MarketHero } from "@/components/market-hero"
import { CategoriesBar } from "@/components/categories-bar"
import { MarketsGrid } from "@/components/markets-grid"
import { EdgeFeed } from "@/components/edge-feed"
import { Footer } from "@/components/footer"
import { OnboardingSheet } from "@/components/onboarding-sheet"
import { fetchRwaAssets, fetchRwaQuotes } from "@/lib/rwa"

function HomeContent() {
  const searchParams = useSearchParams()
  const [category, setCategory] = useState("all")
  const [sortBy, setSortBy] = useState("trending")

  // Derive search query reactively from URL — handles both initial load
  // and client-side router.push("/?q=...") from the navbar search modal.
  const searchQuery = searchParams?.get("q") ?? ""

  useEffect(() => {
    if (searchQuery) setCategory("all")
  }, [searchQuery])

  // ── Pre-fetch stocks data while user browses markets ──
  // On home page load, silently fetch RWA assets + quotes in background.
  // By the time user clicks Stocks tab, data is cached and loads instantly.
  useEffect(() => {
    async function prefetchStocks() {
      try {
        // Fetch RWA assets catalog — populates module-level cache
        const assets = await fetchRwaAssets("NG")

        // Extract first 20 symbols and fetch their quotes
        const symbols = assets.assets
          .filter(a => a.quoteSymbol)
          .slice(0, 20)
          .map(a => a.quoteSymbol)

        if (symbols.length > 0) {
          // Fetch quotes — also cached at module level
          await fetchRwaQuotes(symbols)
        }
      } catch (err) {
        // Silent fail — stocks page will handle fetch failure gracefully
        // This is just a background optimization, not critical to home page
      }
    }

    prefetchStocks()
  }, [])

  return (
    <div className="terminal-grid-bg min-h-screen bg-background flex flex-col ambient-glow">
      <OnboardingSheet />
      <Navbar />

      {/* Hero: always shown — mobile gets compact swipeable version */}
      <MarketHero />

      <main id="markets" className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-3 sm:pt-0 rawli-page-bottom relative z-[1]">
        {/* Desktop heading */}
        <div className="hidden sm:flex flex-col sm:flex-row sm:items-end justify-between gap-3 pt-2 pb-3">
          <div>
            <h2 className="text-xl font-bold text-foreground tracking-tight heading-accent">Market Board</h2>
            <p className="text-xs text-muted-foreground mt-1.5">
              Smart mix of quick-settle, crypto, and high-liquidity prediction markets.
            </p>
          </div>
          {searchQuery && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Results for</span>
              <span className="text-xs font-semibold text-[oklch(0.78_0.16_82)] px-2 py-0.5 rounded-md bg-[oklch(0.78_0.16_82/0.1)] border border-[oklch(0.78_0.16_82/0.2)]">
                "{searchQuery}"
              </span>
            </div>
          )}
        </div>

        {/* Mobile search result indicator */}
        {searchQuery && (
          <div className="sm:hidden flex items-center gap-2 pt-2 pb-1">
            <span className="text-xs text-muted-foreground">Results for</span>
            <span className="text-xs font-semibold text-[oklch(0.78_0.16_82)] px-2 py-0.5 rounded-md bg-[oklch(0.78_0.16_82/0.1)] border border-[oklch(0.78_0.16_82/0.2)]">
              "{searchQuery}"
            </span>
          </div>
        )}

        <CategoriesBar selected={category} onSelect={setCategory} sortBy={sortBy} onSortChange={setSortBy} />

        <div className="pt-4 sm:pt-5">
          <MarketsGrid category={category} sortBy={sortBy} search={searchQuery} />
        </div>

        {/* ── Edge Scanner / Market Intelligence ───────────────────── */}
        {!searchQuery && (
          <div className="mt-8 sm:mt-12 border-t border-[oklch(0.18_0.014_255)] pt-8">
            <EdgeFeed limit={6} minEdge={0.08} />
          </div>
        )}
      </main>

      <Footer />
    </div>
  )
}

export default function Home() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <HomeContent />
    </Suspense>
  )
}
