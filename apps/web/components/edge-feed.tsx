"use client"

import { useRouter } from "next/navigation"
import { Sparkles, TrendingUp, TrendingDown, ArrowUpRight, RefreshCw, Loader2, Clock3 } from "lucide-react"
import { cn } from "@/lib/utils"
import { useEdgeScanner } from "@/hooks/use-edge-scanner"
import type { EdgeHit } from "@/lib/edge-scanner"

// ─── helpers ─────────────────────────────────────────────────────────────────

function fmtPct(v: number) {
  return `${Math.round(v * 100)}¢`
}

function fmtEdge(v: number) {
  const pts = Math.round(Math.abs(v) * 100)
  return `${pts}pt`
}

function timeLeft(endDate: string | null): string {
  if (!endDate) return "Open"
  const ms = new Date(endDate).getTime() - Date.now()
  if (ms < 0) return "Closed"
  const d = Math.floor(ms / 86_400_000)
  if (d >= 30) return `${Math.ceil(d / 7)}w`
  if (d >= 1)  return `${d}d`
  return `${Math.ceil(ms / 3_600_000)}h`
}

function categoryColor(cat: string) {
  const c = cat.toLowerCase()
  if (c.includes("crypto"))        return "bg-[oklch(0.62_0.17_250/0.12)] text-[oklch(0.72_0.16_250)]"
  if (c.includes("politic") || c.includes("world")) return "bg-[oklch(0.58_0.17_300/0.12)] text-[oklch(0.70_0.15_300)]"
  if (c.includes("sport"))         return "bg-[oklch(0.68_0.18_155/0.12)] text-[oklch(0.72_0.18_155)]"
  if (c.includes("finance") || c.includes("macro")) return "bg-[oklch(0.78_0.16_82/0.12)] text-[oklch(0.82_0.16_82)]"
  return "bg-[oklch(0.50_0.01_260/0.12)] text-muted-foreground"
}

// ─── single edge card ─────────────────────────────────────────────────────────

function EdgeCard({ hit }: { hit: EdgeHit }) {
  const router = useRouter()
  const yesOverpriced  = hit.edge < 0          // market says YES > model
  const modelLikesYes  = hit.direction === "YES"
  const marketPct      = fmtPct(hit.marketProbability)
  const modelPct       = fmtPct(hit.blendedProbability)
  const edgePts        = fmtEdge(hit.edge)
  const leftTime       = timeLeft(hit.endDate)

  // "Market says X at price, we see Y": big gap
  const overTag   = yesOverpriced ? "YES overpriced" : "NO overpriced"
  const overColor = yesOverpriced
    ? "border-[oklch(0.60_0.18_25/0.30)] bg-[oklch(0.60_0.18_25/0.07)] text-[oklch(0.70_0.18_25)]"
    : "border-[oklch(0.68_0.18_155/0.30)] bg-[oklch(0.68_0.18_155/0.07)] text-[oklch(0.70_0.18_155)]"

  return (
    <button
      type="button"
      onClick={() => router.push(`/markets/${hit.marketId}`)}
      className="group flex flex-col gap-3 w-full rounded-2xl border border-[oklch(0.22_0.015_255/0.72)] bg-[oklch(0.11_0.012_260/0.92)] p-4 text-left transition-all duration-200 hover:border-[oklch(0.78_0.16_82/0.30)] active:scale-[0.98]"
    >
      {/* Top row: category + time + edge badge */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={cn("rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide", categoryColor(hit.category))}>
            {hit.category}
          </span>
          {hit.symbol && (
            <span className="rounded-full bg-[oklch(0.16_0.014_255)] px-2 py-0.5 font-mono text-[9px] font-bold text-muted-foreground">
              {hit.symbol}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <span className={cn("rounded-full border px-2 py-0.5 text-[9px] font-bold", overColor)}>
            {overTag} · {edgePts}
          </span>
        </div>
      </div>

      {/* Question */}
      <p className="text-[13px] font-semibold leading-snug text-foreground line-clamp-2">
        {hit.question}
      </p>

      {/* Probability comparison */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-[oklch(0.22_0.015_255/0.6)] bg-[oklch(0.09_0.01_260/0.5)] p-2.5">
          <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60">Market YES</div>
          <div className={cn(
            "mt-1 font-mono text-lg font-bold",
            yesOverpriced ? "text-[oklch(0.62_0.18_25)]" : "text-foreground"
          )}>
            {marketPct}
          </div>
        </div>
        <div className="rounded-xl border border-[oklch(0.22_0.015_255/0.6)] bg-[oklch(0.09_0.01_260/0.5)] p-2.5">
          <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60">Our Model</div>
          <div className={cn(
            "mt-1 font-mono text-lg font-bold",
            modelLikesYes ? "text-[oklch(0.68_0.18_155)]" : "text-[oklch(0.62_0.18_25)]"
          )}>
            {modelPct}
          </div>
        </div>
      </div>

      {/* Confidence bar */}
      <div>
        <div className="mb-1 flex items-center justify-between text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            {modelLikesYes ? <TrendingUp className="h-3 w-3 text-[oklch(0.68_0.18_155)]" /> : <TrendingDown className="h-3 w-3 text-[oklch(0.62_0.18_25)]" />}
            Model: <span className={cn("font-bold ml-1", modelLikesYes ? "text-[oklch(0.68_0.18_155)]" : "text-[oklch(0.62_0.18_25)]")}>{hit.direction}</span>
          </span>
          <span className="flex items-center gap-1 text-muted-foreground/70">
            <Clock3 className="h-2.5 w-2.5" /> {leftTime}
          </span>
        </div>
        <div className="h-1 w-full overflow-hidden rounded-full bg-[oklch(0.18_0.014_255)]">
          <div
            className={cn("h-full rounded-full transition-all duration-700",
              modelLikesYes ? "bg-[oklch(0.68_0.18_155)]" : "bg-[oklch(0.62_0.18_25)]"
            )}
            style={{ width: `${hit.confidence}%` }}
          />
        </div>
        <div className="mt-1 flex items-center justify-between text-[9px] text-muted-foreground/60">
          <span>{hit.confidence}% confidence</span>
          <span className="flex items-center gap-0.5">
            Trade <ArrowUpRight className="h-2.5 w-2.5" />
          </span>
        </div>
      </div>
    </button>
  )
}

// ─── Edge Feed (exported) ─────────────────────────────────────────────────────

interface EdgeFeedProps {
  limit?: number
  minEdge?: number
  className?: string
}

export function EdgeFeed({ limit = 6, minEdge = 0.08, className }: EdgeFeedProps) {
  const { data, loading, error, refresh } = useEdgeScanner({ limit, minEdge })

  return (
    <section className={cn("space-y-3", className)}>
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[oklch(0.78_0.16_82)]" />
          <h2 className="text-sm font-bold text-foreground">Market Intelligence</h2>
          <span className="rounded-full border border-[oklch(0.78_0.16_82/0.25)] bg-[oklch(0.78_0.16_82/0.08)] px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[oklch(0.82_0.16_82)]">
            Live
          </span>
        </div>
        <div className="flex items-center gap-2">
          {data && (
            <span className="text-[10px] text-muted-foreground">
              {data.marketsScanned} markets scanned
            </span>
          )}
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="flex h-7 items-center gap-1 rounded-lg border border-[oklch(0.22_0.015_255)] bg-[oklch(0.14_0.013_255)] px-2 text-[10px] font-semibold text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
            Refresh
          </button>
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground leading-relaxed">
        Markets where our model finds a large gap from the crowd price.
      </p>

      {/* Loading */}
      {loading && !data && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: limit }).map((_, i) => (
            <div key={i} className="h-48 rounded-2xl shimmer" style={{ animationDelay: `${i * 60}ms` }} />
          ))}
        </div>
      )}

      {/* Error */}
      {error && !data && (
        <div className="rounded-xl border border-[oklch(0.60_0.18_25/0.30)] bg-[oklch(0.60_0.18_25/0.07)] p-4 text-sm text-[oklch(0.72_0.18_25)]">
          Edge scanner temporarily unavailable. Markets data is still live.
        </div>
      )}

      {/* Edge grid */}
      {data && data.edgeHits.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.edgeHits.map((hit) => (
            <EdgeCard key={hit.marketId} hit={hit} />
          ))}
        </div>
      )}

      {/* No edges found */}
      {data && data.edgeHits.length === 0 && (
        <div className="rounded-2xl border border-dashed border-[oklch(0.22_0.015_255)] p-8 text-center text-sm text-muted-foreground">
          No strong divergences right now. The market is fairly priced across scanned assets.
        </div>
      )}

      {/* Footer: scan meta */}
      {data && (
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60">
          <Loader2 className={cn("h-2.5 w-2.5", loading && "animate-spin")} />
          Scanned {data.marketsScanned} markets · {data.symbolsAnalyzed} assets analyzed ·{" "}
          {new Date(data.scannedAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
        </div>
      )}
    </section>
  )
}
