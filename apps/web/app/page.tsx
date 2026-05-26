"use client"

import { Suspense, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Navbar } from "@/components/navbar"
import { MarketHero } from "@/components/market-hero"
import { MobileTicker } from "@/components/mobile-ticker"
import { CategoriesBar } from "@/components/categories-bar"
import { MarketsGrid } from "@/components/markets-grid"
import { Footer } from "@/components/footer"

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

  return (
    <div className="terminal-grid-bg min-h-screen bg-background flex flex-col ambient-glow">
      <Navbar />

      {/* Hero: hidden on mobile to reduce weight — show from sm up */}
      <div className="hidden sm:block">
        <MarketHero />
      </div>

      {/* pt-[78px] clears the fixed navbar on mobile (hero does it on sm+) */}
      <main id="markets" className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-[78px] sm:pt-0 pb-24 sm:pb-16 relative z-[1]">
        {/* Mobile ticker — sits just below navbar, scrolls with content */}
        <div className="-mx-4 mb-3 sm:hidden">
          <MobileTicker />
        </div>
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
