"use client"

import { Suspense, useCallback, useEffect, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { ChevronDown, ChevronUp, Sparkles } from "lucide-react"
import { Navbar } from "@/components/navbar"
import { MarketHero } from "@/components/market-hero"
import { CategoriesBar } from "@/components/categories-bar"
import { MarketsGrid } from "@/components/markets-grid"
import { EdgeFeed } from "@/components/edge-feed"
import { Footer } from "@/components/footer"
import { OnboardingSheet } from "@/components/onboarding-sheet"
import { fetchRwaAssets, fetchRwaQuotes } from "@/lib/rwa"

function HomeContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [category, setCategory] = useState("all")
  const [sortBy, setSortBy] = useState("trending")
  const edgeRef = useRef<HTMLDivElement | null>(null)
  const [edgeVisible, setEdgeVisible] = useState(false)
  const [mobileEdgeOpen, setMobileEdgeOpen] = useState(false)
  const [mobileViewport, setMobileViewport] = useState(false)
  const [marketStable, setMarketStable] = useState(false)

  // Derive search query reactively from URL — handles both initial load
  // and client-side router.push("/?q=...") from the navbar search modal.
  const searchQuery = searchParams?.get("q") ?? ""

  useEffect(() => {
    if (searchQuery) setCategory("all")
  }, [searchQuery])

  useEffect(() => {
    const media = window.matchMedia("(max-width: 639px)")
    const update = () => setMobileViewport(media.matches)
    update()
    media.addEventListener("change", update)
    return () => media.removeEventListener("change", update)
  }, [])

  const markMarketStable = useCallback(() => {
    setMarketStable(true)
  }, [])

  // ── Pre-fetch stocks data after the first market view is already painted ──
  useEffect(() => {
    if (!marketStable) return
    let cancelled = false
    let idleHandle: number | null = null
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number
      cancelIdleCallback?: (handle: number) => void
    }

    async function prefetchStocks() {
      try {
        if (cancelled) return
        const assets = await fetchRwaAssets("NG")
        if (cancelled) return
        const symbols = assets.assets
          .filter(a => a.quoteSymbol)
          .slice(0, 20)
          .map(a => a.quoteSymbol)

        if (symbols.length > 0) {
          await fetchRwaQuotes(symbols)
        }
      } catch (err) {
        // Silent fail — stocks page handles its own fetch state.
      }
    }

    const timer = window.setTimeout(() => {
      if (idleWindow.requestIdleCallback) {
        idleHandle = idleWindow.requestIdleCallback(() => {
          void prefetchStocks()
        }, { timeout: 6_000 })
        return
      }
      void prefetchStocks()
    }, 1_500)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
      if (idleHandle !== null) idleWindow.cancelIdleCallback?.(idleHandle)
    }
  }, [marketStable])

  useEffect(() => {
    if (!marketStable) return
    const timer = window.setTimeout(() => {
      router.prefetch("/stocks")
      router.prefetch("/portfolio")
    }, 1_000)
    return () => window.clearTimeout(timer)
  }, [marketStable, router])

  useEffect(() => {
    if (edgeVisible || searchQuery) return
    if (window.matchMedia("(max-width: 639px)").matches) return
    const node = edgeRef.current
    if (!node) return

    if (!("IntersectionObserver" in window)) {
      const timer = setTimeout(() => setEdgeVisible(true), 9000)
      return () => clearTimeout(timer)
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return
        setEdgeVisible(true)
        observer.disconnect()
      },
      { rootMargin: "500px 0px" }
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [edgeVisible, searchQuery])

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
          <MarketsGrid category={category} sortBy={sortBy} search={searchQuery} onFirstData={markMarketStable} />
        </div>

        {/* ── Edge Scanner / Market Intelligence ───────────────────── */}
        {!searchQuery && (
          <div ref={edgeRef} className="mt-6 sm:mt-12 border-t border-[oklch(0.18_0.014_255)] pt-5 sm:pt-8">
            <div className="sm:hidden">
              <button
                type="button"
                onClick={() => setMobileEdgeOpen((open) => !open)}
                className="flex w-full items-center gap-3 rounded-2xl border border-[oklch(0.78_0.16_82/0.24)] bg-[oklch(0.12_0.012_260/0.94)] p-4 text-left shadow-[0_14px_34px_oklch(0_0_0/0.28)] active:scale-[0.99]"
                aria-expanded={mobileEdgeOpen}
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[oklch(0.78_0.16_82/0.12)] text-[oklch(0.82_0.16_82)]">
                  <Sparkles className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[10px] font-bold uppercase tracking-[0.18em] text-[oklch(0.82_0.16_82)]">
                    Edge Scanner
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                    Tap to scan mispriced markets when you need it.
                  </span>
                </span>
                {mobileEdgeOpen ? (
                  <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
              </button>

              {mobileEdgeOpen ? (
                <EdgeFeed limit={4} minEdge={0.08} className="mt-4" />
              ) : null}
            </div>

            <div className="hidden sm:block">
              {!mobileViewport && edgeVisible ? <EdgeFeed limit={6} minEdge={0.08} /> : null}
            </div>
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
