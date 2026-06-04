"use client"

import React, { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  Lock,
  Loader2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Shield,
  Zap,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Minus,
  Activity,
  BarChart3,
  Target,
  Wallet,
} from "lucide-react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { usePrivy } from "@privy-io/react-auth"
import { useActivePrivyWallet } from "@/hooks/use-active-privy-wallet"
import { usePremiumAnalysis } from "@/hooks/use-premium-analysis"
import type {
  PremiumAnalysis,
  PremiumTechnicalAnalysis,
  PremiumFundamentalAnalysis,
  FundamentalSignal,
  TAComputedVerdict,
  TASignalVote,
} from "@smartmarket/types"

interface PremiumAnalysisCardProps {
  market: {
    id: string
    question: string
    category?: string
    description?: string
    volume?: string
    liquidity?: string
    endDate?: string
    outcomes?: { name: string; price: number }[]
  }
}

const PREMIUM_ANALYSIS_FEE_ENABLED =
  process.env.NEXT_PUBLIC_PREMIUM_ANALYSIS_FEE_ENABLED === "true"

// ─── Color helpers ────────────────────────────────────────────────────────────

const GREEN = "oklch(0.68 0.18 155)"
const RED = "oklch(0.58 0.2 25)"
const AMBER = "oklch(0.78 0.16 82)"
const MUTED = "oklch(0.45 0.01 260)"

function directionColor(dir: "bullish" | "bearish" | "neutral" | "YES" | "NO") {
  if (dir === "bullish" || dir === "YES") return GREEN
  if (dir === "bearish" || dir === "NO") return RED
  return MUTED
}

function fmt(n: number, decimals = 2) {
  if (Math.abs(n) >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`
  return n.toFixed(decimals)
}

function fmtPrice(n: number) {
  if (n >= 1000) return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
  if (n >= 1) return `$${n.toFixed(2)}`
  return `$${n.toFixed(6)}`
}

function compactText(text: string, max = 150) {
  const cleaned = text
    .replace(/[•⚠]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  if (cleaned.length <= max) return cleaned
  const cut = cleaned.slice(0, max)
  const lastBreak = Math.max(cut.lastIndexOf("."), cut.lastIndexOf(";"), cut.lastIndexOf(","))
  return `${cut.slice(0, lastBreak > 80 ? lastBreak : max).trim()}...`
}

function convictionLabel(confidence: number) {
  if (confidence >= 70) return "High conviction"
  if (confidence >= 50) return "Moderate conviction"
  return "Low conviction"
}

function topVotes(votes: TASignalVote[], direction: TASignalVote["direction"], limit = 2) {
  return votes
    .filter((vote) => vote.direction === direction)
    .sort((a, b) => (b.conviction * b.weight) - (a.conviction * a.weight))
    .slice(0, limit)
}

// ─── Reusable sub-components ──────────────────────────────────────────────────

function CollapsibleSection({
  title,
  children,
  defaultOpen = false,
  icon,
}: {
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
  icon?: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-b border-border/50 last:border-0">
      <button
        className="w-full flex items-center justify-between py-3 text-sm font-medium text-foreground hover:text-primary transition-colors"
        onClick={() => setOpen(!open)}
      >
        <span className="flex items-center gap-2">
          {icon}
          {title}
        </span>
        {open ? (
          <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
        )}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="pb-4 text-sm text-muted-foreground leading-relaxed">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function StatPill({
  label,
  value,
  color,
}: {
  label: string
  value: string
  color?: string
}) {
  return (
    <div className="flex flex-col items-center gap-0.5 px-1.5 sm:px-3 py-2 rounded-lg bg-[oklch(0.13_0.013_255)] border border-[oklch(0.20_0.014_255)] min-w-0">
      <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60 truncate w-full text-center">
        {label}
      </span>
      <span
        className="text-xs sm:text-sm font-bold font-mono truncate"
        style={{ color: color ?? "oklch(0.90 0.01 260)" }}
      >
        {value}
      </span>
    </div>
  )
}

// ─── Verdict Banner ───────────────────────────────────────────────────────────

function ModelVsMarketStrip({ pm }: { pm: NonNullable<PremiumAnalysis["probabilityModel"]> }) {
  if (pm.marketProbability === null || pm.edge === null) return null
  const modelPct = Math.round(pm.blendedProbability * 100)
  const marketPct = Math.round(pm.marketProbability * 100)
  const edgePts = Math.round(pm.edge * 100)
  const strong = Math.abs(edgePts) >= 12
  const smallEdge = Math.abs(edgePts) >= 5
  const dir = edgePts > 0 ? "underpricing" : "overpricing"
  const edgeColor = strong ? AMBER : "var(--muted-foreground)"
  const edgeSummary = strong
    ? `Our model puts YES ${Math.abs(edgePts)}pts ${edgePts > 0 ? "above" : "below"} the market — a potential ${dir} of YES.`
    : smallEdge
      ? `Small ${Math.abs(edgePts)}pt pricing edge, but not enough for a standalone trade.`
      : "Model and market are broadly aligned, so edge is limited."

  return (
    <div className="mt-3 rounded-lg border border-white/5 bg-black/15 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/55">Model vs Market</p>
        {strong && (
          <span
            className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider"
            style={{ background: `${AMBER.replace(")", " / 0.14)")}`, color: AMBER }}
          >
            ⚠ {Math.abs(edgePts)}pt edge
          </span>
        )}
      </div>
      <div className="mt-2 grid grid-cols-3 gap-1.5 text-center">
        <div>
          <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/55">Model</p>
          <p className="mt-0.5 font-mono text-xs font-bold text-foreground">{modelPct}%</p>
        </div>
        <div>
          <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/55">Market</p>
          <p className="mt-0.5 font-mono text-xs font-bold text-foreground">{marketPct}%</p>
        </div>
        <div>
          <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/55">Edge</p>
          <p className="mt-0.5 font-mono text-xs font-bold" style={{ color: edgeColor }}>
            {edgePts > 0 ? "+" : ""}{edgePts}pt
          </p>
        </div>
      </div>
      <p className="mt-2 text-[11px] leading-4 text-muted-foreground/70">
        {edgeSummary}
      </p>
    </div>
  )
}

function VerdictBanner({
  verdict,
  ta,
  fa,
  probabilityModel,
}: {
  verdict: PremiumAnalysis["verdict"]
  ta?: PremiumTechnicalAnalysis
  fa?: PremiumFundamentalAnalysis
  probabilityModel?: PremiumAnalysis["probabilityModel"]
}) {
  const isYes = verdict.direction === "YES"
  const color = isYes ? GREEN : RED
  const cv = ta?.computedVerdict
  const supportDirection = verdict.direction === "YES" ? "bullish" : "bearish"
  const watchDirection = verdict.direction === "YES" ? "bearish" : "bullish"
  const supportVotes = cv ? topVotes(cv.votes, supportDirection) : []
  const watchVotes = cv ? topVotes(cv.votes, watchDirection) : []
  const fundamentalSupport = fa
    ? fa.signals
        .filter((signal) => signal.direction === verdict.direction)
        .sort((a, b) => (b.conviction * b.weight) - (a.conviction * a.weight))
        .slice(0, 2)
    : []
  const fundamentalWatch = fa
    ? fa.signals
        .filter((signal) => signal.direction !== verdict.direction && signal.direction !== "neutral")
        .sort((a, b) => (b.conviction * b.weight) - (a.conviction * a.weight))
        .slice(0, 2)
    : []

  return (
    <div
      className="rounded-xl p-3.5 sm:p-4"
      style={{
        background: `${color.replace(")", " / 0.12)")}`,
        borderLeft: `4px solid ${color}`,
      }}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <span className="text-2xl font-bold tracking-tight" style={{ color }}>
            {verdict.direction}
          </span>
          <p className="mt-0.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
            {convictionLabel(verdict.confidence)}
          </p>
        </div>
        <Badge
          variant="outline"
          className="shrink-0 text-xs font-mono"
          style={{ borderColor: color, color }}
        >
          {verdict.confidence}% confidence
        </Badge>
      </div>
      <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden mb-3">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${verdict.confidence}%`, background: color }}
        />
      </div>

      {probabilityModel && <ModelVsMarketStrip pm={probabilityModel} />}

      {cv ? (
        <div className="space-y-2.5">
          <div className="grid grid-cols-3 gap-1.5 text-center">
            <div className="rounded-lg border border-white/5 bg-black/15 px-2 py-2">
              <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/55">Agree</p>
              <p className="mt-0.5 font-mono text-xs font-bold text-foreground">{cv.signalAgreement.toFixed(0)}%</p>
            </div>
            <div className="rounded-lg border border-white/5 bg-black/15 px-2 py-2">
              <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/55">Signals</p>
              <p className="mt-0.5 font-mono text-xs font-bold text-foreground">{cv.agreeingSignals}/{cv.totalSignals}</p>
            </div>
            <div className="rounded-lg border border-white/5 bg-black/15 px-2 py-2">
              <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/55">Net</p>
              <p className="mt-0.5 font-mono text-xs font-bold" style={{ color: cv.netScore >= 0 ? GREEN : RED }}>
                {cv.netScore > 0 ? "+" : ""}{cv.netScore.toFixed(0)}
              </p>
            </div>
          </div>

          <div className="space-y-1.5 text-[12px] leading-5">
            <p className="text-muted-foreground/80">
              Quant read: {cv.signalAgreement.toFixed(0)}% alignment across {cv.totalSignals} signals.
              {verdict.confidence < 50 ? " Treat this as cautious, not a strong directional call." : ""}
            </p>
            {supportVotes.length > 0 && (
              <p className="text-muted-foreground/75">
                <span className="font-semibold" style={{ color }}>Supports:</span>{" "}
                {supportVotes.map((vote) => vote.name).join(", ")}
              </p>
            )}
            {watchVotes.length > 0 && (
              <p className="text-muted-foreground/75">
                <span className="font-semibold text-muted-foreground">Watch:</span>{" "}
                {watchVotes.map((vote) => vote.name).join(", ")}
              </p>
            )}
          </div>
        </div>
      ) : fa ? (
        <div className="space-y-2.5">
          <div className="grid grid-cols-3 gap-1.5 text-center">
            <div className="rounded-lg border border-white/5 bg-black/15 px-2 py-2">
              <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/55">Net</p>
              <p className="mt-0.5 font-mono text-xs font-bold" style={{ color: fa.netScore >= 0 ? GREEN : RED }}>
                {fa.netScore > 0 ? "+" : ""}{fa.netScore.toFixed(0)}
              </p>
            </div>
            <div className="rounded-lg border border-white/5 bg-black/15 px-2 py-2">
              <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/55">Market</p>
              <p className="mt-0.5 font-mono text-xs font-bold text-foreground">{fa.impliedProbability}%</p>
            </div>
            <div className="rounded-lg border border-white/5 bg-black/15 px-2 py-2">
              <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/55">Time</p>
              <p className="mt-0.5 font-mono text-xs font-bold text-foreground">
                {typeof fa.daysToResolution === "number" ? `${fa.daysToResolution}d` : "Open"}
              </p>
            </div>
          </div>
          <div className="space-y-1.5 text-[12px] leading-5">
            <p className="text-muted-foreground/80">{compactText(fa.verdictRationale || verdict.rationale, 150)}</p>
            {fundamentalSupport.length > 0 && (
              <p className="text-muted-foreground/75">
                <span className="font-semibold" style={{ color }}>Supports:</span>{" "}
                {fundamentalSupport.map((signal) => signal.name).join(", ")}
              </p>
            )}
            {fundamentalWatch.length > 0 && (
              <p className="text-muted-foreground/75">
                <span className="font-semibold text-muted-foreground">Watch:</span>{" "}
                {fundamentalWatch.map((signal) => signal.name).join(", ")}
              </p>
            )}
          </div>
        </div>
      ) : (
        <p className="text-[12px] leading-5 text-muted-foreground/80">{compactText(verdict.rationale)}</p>
      )}
    </div>
  )
}

// ─── Quant Score Row ──────────────────────────────────────────────────────────

function QuantScoreRow({ cv, regime }: { cv: TAComputedVerdict; regime: string }) {
  const netAbs = Math.abs(cv.netScore)
  const netColor = cv.netScore > 10 ? GREEN : cv.netScore < -10 ? RED : MUTED
  const agreementColor =
    cv.signalAgreement >= 70 ? GREEN : cv.signalAgreement >= 50 ? AMBER : RED

  return (
    <div className="grid grid-cols-3 gap-1.5 sm:gap-2 my-3">
      <StatPill
        label="Net Score"
        value={`${cv.netScore > 0 ? "+" : ""}${cv.netScore.toFixed(0)}`}
        color={netColor}
      />
      <StatPill
        label="Agreement"
        value={`${cv.signalAgreement.toFixed(0)}%`}
        color={agreementColor}
      />
      <StatPill
        label="Regime"
        value={regime.replace("_", " ")}
        color={
          regime === "trending"
            ? GREEN
            : regime === "volatile"
            ? RED
            : AMBER
        }
      />
    </div>
  )
}

// ─── Signal Vote Row ──────────────────────────────────────────────────────────

function SignalVoteRow({ vote }: { vote: TASignalVote }) {
  const color = directionColor(vote.direction)
  const Icon =
    vote.direction === "bullish"
      ? TrendingUp
      : vote.direction === "bearish"
      ? TrendingDown
      : Minus
  const convictionPct = Math.round(vote.conviction * 100)

  return (
    <div className="flex items-start gap-2 py-2 border-b border-border/30 last:border-0">
      <Icon className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 mb-1">
          <span className="text-xs font-semibold text-foreground truncate">
            {vote.name}
          </span>
          <div className="flex items-center gap-1.5 shrink-0">
            <span
              className="text-[9px] font-mono"
              style={{ color: "oklch(0.55 0.01 260)" }}
            >
              w:{(vote.weight * 100).toFixed(0)}
            </span>
            <div className="w-12 h-1 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{ width: `${convictionPct}%`, background: color }}
              />
            </div>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground/70 leading-snug line-clamp-2">
          {vote.reason}
        </p>
      </div>
    </div>
  )
}

// ─── Signal Breakdown Panel ───────────────────────────────────────────────────

function SignalBreakdown({ cv }: { cv: TAComputedVerdict }) {
  const bullVotes = cv.votes.filter((v) => v.direction === "bullish")
  const bearVotes = cv.votes.filter((v) => v.direction === "bearish")
  const neutralVotes = cv.votes.filter((v) => v.direction === "neutral")

  return (
    <div className="space-y-3">
      {/* Score bar */}
      <div className="space-y-1.5">
        <div className="flex justify-between text-[10px] font-mono text-muted-foreground">
          <span style={{ color: GREEN }}>Bull {cv.bullishScore.toFixed(1)}</span>
          <span>
            {cv.agreeingSignals}/{cv.totalSignals} signals agree
          </span>
          <span style={{ color: RED }}>Bear {cv.bearishScore.toFixed(1)}</span>
        </div>
        <div className="relative w-full h-2 rounded-full overflow-hidden bg-[oklch(0.15_0.01_260)]">
          {/* Bearish left side */}
          <div
            className="absolute right-1/2 top-0 h-full rounded-l-full"
            style={{
              width: `${Math.min(50, cv.bearishScore / (cv.bullishScore + cv.bearishScore || 1) * 100)}%`,
              background: RED,
            }}
          />
          {/* Bullish right side */}
          <div
            className="absolute left-1/2 top-0 h-full rounded-r-full"
            style={{
              width: `${Math.min(50, cv.bullishScore / (cv.bullishScore + cv.bearishScore || 1) * 100)}%`,
              background: GREEN,
            }}
          />
          {/* Center line */}
          <div className="absolute left-1/2 top-0 w-px h-full bg-muted-foreground/40 -translate-x-px" />
        </div>
      </div>

      {/* Contrarian flags */}
      {cv.contrariansFlags.length > 0 && (
        <div className="rounded-md p-2.5 bg-[oklch(0.58_0.2_25_/_0.08)] border border-[oklch(0.58_0.2_25_/_0.2)]">
          <p className="text-[9px] font-bold uppercase tracking-widest mb-1.5" style={{ color: RED }}>
            Contrarian signals
          </p>
          <div className="flex flex-wrap gap-1">
            {cv.contrariansFlags.map((f, i) => (
              <span
                key={i}
                className="text-[10px] px-1.5 py-0.5 rounded bg-[oklch(0.58_0.2_25_/_0.15)]"
                style={{ color: "oklch(0.75 0.12 25)" }}
              >
                {f}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Vote list: bullish then bearish then neutral */}
      {bullVotes.length > 0 && (
        <div>
          <p className="text-[9px] font-bold uppercase tracking-widest mb-1" style={{ color: GREEN }}>
            Bullish ({bullVotes.length})
          </p>
          {bullVotes.map((v, i) => (
            <SignalVoteRow key={i} vote={v} />
          ))}
        </div>
      )}
      {bearVotes.length > 0 && (
        <div className="mt-2">
          <p className="text-[9px] font-bold uppercase tracking-widest mb-1" style={{ color: RED }}>
            Bearish ({bearVotes.length})
          </p>
          {bearVotes.map((v, i) => (
            <SignalVoteRow key={i} vote={v} />
          ))}
        </div>
      )}
      {neutralVotes.length > 0 && (
        <div className="mt-2">
          <p className="text-[9px] font-bold uppercase tracking-widest mb-1 text-muted-foreground/60">
            Neutral ({neutralVotes.length})
          </p>
          {neutralVotes.map((v, i) => (
            <SignalVoteRow key={i} vote={v} />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Market Microstructure Panel ──────────────────────────────────────────────

function MicrostructurePanel({ ta }: { ta: PremiumTechnicalAnalysis }) {
  const { openInterest: oi, longShort: ls, takerRatio: tk, funding, fearGreed } = ta

  return (
    <div className="space-y-4">
      {/* Open Interest */}
      {oi && (
        <div className="rounded-lg p-3 bg-[oklch(0.13_0.013_255)] border border-[oklch(0.20_0.014_255)]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
              Open Interest
            </span>
            <Badge
              variant="outline"
              className="text-[9px]"
              style={{
                borderColor: directionColor(oi.signal),
                color: directionColor(oi.signal),
              }}
            >
              {oi.signal}
            </Badge>
          </div>
          <div className="flex gap-4">
            <div>
              <p className="text-[10px] text-muted-foreground/50">Current</p>
              <p className="text-sm font-mono font-semibold text-foreground">
                {fmt(oi.current)}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground/50">24h Change</p>
              <p
                className="text-sm font-mono font-semibold"
                style={{ color: oi.change24h > 0 ? GREEN : oi.change24h < 0 ? RED : MUTED }}
              >
                {oi.change24h > 0 ? "+" : ""}
                {oi.change24h.toFixed(2)}%
              </p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground/50">Trend</p>
              <p className="text-sm font-semibold capitalize text-foreground">
                {oi.trend}
              </p>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground/70">{oi.interpretation}</p>
        </div>
      )}

      {/* Long / Short Ratio */}
      {ls && (
        <div className="rounded-lg p-3 bg-[oklch(0.13_0.013_255)] border border-[oklch(0.20_0.014_255)]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
              Long / Short Ratio
            </span>
            <Badge
              variant="outline"
              className="text-[9px]"
              style={{
                borderColor: directionColor(ls.contrarian),
                color: directionColor(ls.contrarian),
              }}
            >
              contrarian {ls.contrarian}
            </Badge>
          </div>
          <div className="grid grid-cols-2 gap-3 mb-2">
            {/* Retail */}
            <div>
              <p className="text-[10px] text-muted-foreground/50 mb-1">Retail</p>
              <div className="relative w-full h-2 rounded-full overflow-hidden bg-[oklch(0.15_0.01_260)]">
                <div
                  className="absolute left-0 top-0 h-full rounded-full"
                  style={{ width: `${ls.globalLongPct}%`, background: GREEN }}
                />
              </div>
              <div className="flex justify-between text-[10px] font-mono mt-1">
                <span style={{ color: GREEN }}>{ls.globalLongPct.toFixed(1)}% L</span>
                <span style={{ color: RED }}>{ls.globalShortPct.toFixed(1)}% S</span>
              </div>
            </div>
            {/* Smart Money */}
            <div>
              <p className="text-[10px] text-muted-foreground/50 mb-1">Top Traders</p>
              <div className="relative w-full h-2 rounded-full overflow-hidden bg-[oklch(0.15_0.01_260)]">
                <div
                  className="absolute left-0 top-0 h-full rounded-full"
                  style={{ width: `${ls.topTraderLongPct}%`, background: AMBER }}
                />
              </div>
              <div className="flex justify-between text-[10px] font-mono mt-1">
                <span style={{ color: AMBER }}>{ls.topTraderLongPct.toFixed(1)}% L</span>
                <span style={{ color: "oklch(0.65 0.1 45)" }}>
                  {ls.topTraderShortPct.toFixed(1)}% S
                </span>
              </div>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground/70">{ls.interpretation}</p>
        </div>
      )}

      {/* Taker Ratio */}
      {tk && (
        <div className="rounded-lg p-3 bg-[oklch(0.13_0.013_255)] border border-[oklch(0.20_0.014_255)]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
              Taker Buy / Sell
            </span>
            <div className="flex items-center gap-1.5">
              <Badge
                variant="outline"
                className="text-[9px]"
                style={{
                  borderColor:
                    tk.trend === "buyers_dominant"
                      ? GREEN
                      : tk.trend === "sellers_dominant"
                      ? RED
                      : MUTED,
                  color:
                    tk.trend === "buyers_dominant"
                      ? GREEN
                      : tk.trend === "sellers_dominant"
                      ? RED
                      : MUTED,
                }}
              >
                {tk.trend.replace("_", " ")}
              </Badge>
              <span
                className="text-[9px] font-mono"
                style={{ color: "oklch(0.55 0.01 260)" }}
              >
                {tk.strength}
              </span>
            </div>
          </div>
          <div className="relative w-full h-3 rounded-full overflow-hidden bg-[oklch(0.15_0.01_260)]">
            <div
              className="absolute left-0 top-0 h-full"
              style={{ width: `${tk.buyRatio * 100}%`, background: GREEN }}
            />
          </div>
          <div className="flex justify-between text-[10px] font-mono mt-1">
            <span style={{ color: GREEN }}>Buy {(tk.buyRatio * 100).toFixed(1)}%</span>
            <span style={{ color: RED }}>Sell {(tk.sellRatio * 100).toFixed(1)}%</span>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground/70">{tk.interpretation}</p>
        </div>
      )}

      {/* Funding + Fear/Greed row */}
      {(funding || fearGreed) && (
        <div className="grid grid-cols-2 gap-2">
          {funding && (
            <div className="rounded-lg p-3 bg-[oklch(0.13_0.013_255)] border border-[oklch(0.20_0.014_255)]">
              <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60 mb-1.5">
                Funding Rate
              </p>
              <p
                className="text-sm font-mono font-bold"
                style={{
                  color:
                    funding.fundingRate > 0.0005
                      ? RED
                      : funding.fundingRate < -0.0005
                      ? GREEN
                      : MUTED,
                }}
              >
                {funding.fundingRate > 0 ? "+" : ""}
                {(funding.fundingRate * 100).toFixed(4)}%
              </p>
              <p className="text-[10px] text-muted-foreground/50 mt-0.5">
                {funding.fundingRate > 0.001
                  ? "Longs paying (bearish)"
                  : funding.fundingRate < -0.001
                  ? "Shorts paying (bullish)"
                  : "Neutral"}
              </p>
            </div>
          )}
          {fearGreed && (
            <div className="rounded-lg p-3 bg-[oklch(0.13_0.013_255)] border border-[oklch(0.20_0.014_255)]">
              <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60 mb-1.5">
                Fear & Greed
              </p>
              <p
                className="text-sm font-mono font-bold"
                style={{
                  color:
                    fearGreed.value >= 75
                      ? RED
                      : fearGreed.value <= 25
                      ? GREEN
                      : AMBER,
                }}
              >
                {fearGreed.value}
              </p>
              <p className="text-[10px] text-muted-foreground/50 mt-0.5 capitalize">
                {fearGreed.classification}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Technical Levels Panel ───────────────────────────────────────────────────

function TechLevelsPanel({ ta }: { ta: PremiumTechnicalAnalysis }) {
  const { rsi14, rsiDivergence, multiTfRsi, macd, ema, bollinger } = ta

  const rsiColor =
    rsi14 >= 70 ? RED : rsi14 <= 30 ? GREEN : AMBER
  const rsiLabel =
    rsi14 >= 70
      ? "Overbought"
      : rsi14 <= 30
      ? "Oversold"
      : rsi14 >= 55
      ? "Bullish range"
      : rsi14 <= 45
      ? "Bearish range"
      : "Neutral"

  const macdColor =
    macd.trend === "bullish" ? GREEN : macd.trend === "bearish" ? RED : MUTED
  const emaColor =
    ema.stack === "bullish" ? GREEN : ema.stack === "bearish" ? RED : AMBER

  return (
    <div className="space-y-4">
      {/* Indicators grid */}
      <div className="grid grid-cols-2 gap-2">
        {/* RSI */}
        <div className="rounded-lg p-3 bg-[oklch(0.13_0.013_255)] border border-[oklch(0.20_0.014_255)]">
          <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60 mb-2">
            RSI (14)
          </p>
          <p className="text-lg font-mono font-bold" style={{ color: rsiColor }}>
            {rsi14.toFixed(1)}
          </p>
          <p className="text-[10px] mt-0.5" style={{ color: rsiColor }}>
            {rsiLabel}
          </p>
          {rsiDivergence && (
            <span
              className="inline-block mt-1.5 text-[9px] px-1.5 py-0.5 rounded"
              style={{
                background:
                  rsiDivergence.type === "bullish"
                    ? "oklch(0.68 0.18 155 / 0.15)"
                    : "oklch(0.58 0.2 25 / 0.15)",
                color: rsiDivergence.type === "bullish" ? GREEN : RED,
              }}
            >
              {rsiDivergence.type} divergence · {rsiDivergence.strength}
            </span>
          )}
        </div>

        {/* MACD */}
        <div className="rounded-lg p-3 bg-[oklch(0.13_0.013_255)] border border-[oklch(0.20_0.014_255)]">
          <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60 mb-2">
            MACD
          </p>
          <p className="text-sm font-mono font-semibold capitalize" style={{ color: macdColor }}>
            {macd.trend}
          </p>
          <p className="text-[10px] text-muted-foreground/60 mt-0.5 capitalize">
            Hist: {macd.histogramTrend}
          </p>
          {macd.crossover && (
            <span
              className="inline-block mt-1.5 text-[9px] px-1.5 py-0.5 rounded"
              style={{
                background:
                  macd.crossover === "bullish_cross"
                    ? "oklch(0.68 0.18 155 / 0.15)"
                    : "oklch(0.58 0.2 25 / 0.15)",
                color: macd.crossover === "bullish_cross" ? GREEN : RED,
              }}
            >
              {macd.crossover.replace("_", " ")}
            </span>
          )}
        </div>

        {/* EMA Ribbon */}
        <div className="rounded-lg p-3 bg-[oklch(0.13_0.013_255)] border border-[oklch(0.20_0.014_255)]">
          <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60 mb-2">
            EMA Ribbon
          </p>
          <p className="text-sm font-semibold capitalize" style={{ color: emaColor }}>
            {ema.stack}
          </p>
          <div className="mt-1.5 space-y-0.5">
            {[
              { label: "9", v: ema.ema9 },
              { label: "21", v: ema.ema21 },
              { label: "50", v: ema.ema50 },
              { label: "200", v: ema.ema200 },
            ].map(({ label, v }) => (
              <div key={label} className="flex justify-between text-[10px]">
                <span className="text-muted-foreground/50">EMA{label}</span>
                <span className="font-mono text-muted-foreground">{fmtPrice(v)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Bollinger Bands */}
        <div className="rounded-lg p-3 bg-[oklch(0.13_0.013_255)] border border-[oklch(0.20_0.014_255)]">
          <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60 mb-2">
            Bollinger Bands
          </p>
          {bollinger.squeeze ? (
            <p className="text-sm font-semibold" style={{ color: AMBER }}>
              Squeeze
            </p>
          ) : (
            <p className="text-sm font-semibold text-foreground">
              {bollinger.percentB >= 0.8
                ? "Near upper"
                : bollinger.percentB <= 0.2
                ? "Near lower"
                : "Mid-band"}
            </p>
          )}
          <p className="text-[10px] text-muted-foreground/60 mt-0.5">
            %B: {(bollinger.percentB * 100).toFixed(0)}%
          </p>
          <div className="mt-1.5 space-y-0.5">
            {[
              { label: "Upper", v: bollinger.upper },
              { label: "Mid", v: bollinger.middle },
              { label: "Lower", v: bollinger.lower },
            ].map(({ label, v }) => (
              <div key={label} className="flex justify-between text-[10px]">
                <span className="text-muted-foreground/50">{label}</span>
                <span className="font-mono text-muted-foreground">{fmtPrice(v)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Multi-TF RSI alignment */}
      <div className="rounded-lg p-3 bg-[oklch(0.13_0.013_255)] border border-[oklch(0.20_0.014_255)]">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60">
            Multi-TF RSI
          </p>
          <span
            className="text-[10px] font-semibold capitalize"
            style={{
              color:
                multiTfRsi.alignment === "all_bullish"
                  ? GREEN
                  : multiTfRsi.alignment === "all_bearish"
                  ? RED
                  : AMBER,
            }}
          >
            {multiTfRsi.alignment.replace("_", " ")}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
          {[
            { label: "4H", v: multiTfRsi.tf4h },
            { label: "1H", v: multiTfRsi.tf1h },
            { label: "15m", v: multiTfRsi.tf15m },
          ].map(({ label, v }) => (
            <div key={label} className="text-center">
              <p className="text-[9px] text-muted-foreground/50 mb-0.5">{label}</p>
              <p
                className="text-sm font-mono font-bold"
                style={{ color: v >= 70 ? RED : v <= 30 ? GREEN : AMBER }}
              >
                {v.toFixed(1)}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Key levels */}
      <div className="rounded-lg p-3 bg-[oklch(0.13_0.013_255)] border border-[oklch(0.20_0.014_255)]">
        <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60 mb-2">
          Key Levels
        </p>
        <div className="space-y-1.5">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground/60">Current price</span>
            <span className="font-mono font-semibold text-foreground">
              {fmtPrice(ta.currentPrice)}
            </span>
          </div>
          {ta.nearestResistance && (
            <div className="flex justify-between text-sm">
              <span style={{ color: RED }}>Resistance</span>
              <span className="font-mono" style={{ color: RED }}>
                {fmtPrice(ta.nearestResistance)}
              </span>
            </div>
          )}
          {ta.nearestSupport && (
            <div className="flex justify-between text-sm">
              <span style={{ color: GREEN }}>Support</span>
              <span className="font-mono" style={{ color: GREEN }}>
                {fmtPrice(ta.nearestSupport)}
              </span>
            </div>
          )}
          {ta.swingHigh && (
            <div className="flex justify-between text-xs text-muted-foreground/60">
              <span>Swing high</span>
              <span className="font-mono">{fmtPrice(ta.swingHigh)}</span>
            </div>
          )}
          {ta.swingLow && (
            <div className="flex justify-between text-xs text-muted-foreground/60">
              <span>Swing low</span>
              <span className="font-mono">{fmtPrice(ta.swingLow)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Risk / Reward */}
      {ta.riskReward && (
        <div className="rounded-lg p-3 bg-[oklch(0.13_0.013_255)] border border-[oklch(0.20_0.014_255)]">
          <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60 mb-2">
            Risk / Reward Setup
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[9px] uppercase tracking-widest mb-1.5" style={{ color: GREEN }}>
                Long
              </p>
              <div className="space-y-1 text-[11px]">
                <div className="flex justify-between">
                  <span className="text-muted-foreground/60">Entry</span>
                  <span className="font-mono">{fmtPrice(ta.riskReward.longEntry)}</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: RED }}>Stop</span>
                  <span className="font-mono" style={{ color: RED }}>
                    {fmtPrice(ta.riskReward.longStop)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: GREEN }}>Target</span>
                  <span className="font-mono" style={{ color: GREEN }}>
                    {fmtPrice(ta.riskReward.longTarget)}
                  </span>
                </div>
                <div className="flex justify-between font-semibold">
                  <span className="text-muted-foreground/60">R:R</span>
                  <span
                    className="font-mono"
                    style={{
                      color: ta.riskReward.longRR >= 2 ? GREEN : AMBER,
                    }}
                  >
                    1:{ta.riskReward.longRR.toFixed(1)}
                  </span>
                </div>
              </div>
            </div>
            <div>
              <p className="text-[9px] uppercase tracking-widest mb-1.5" style={{ color: RED }}>
                Short
              </p>
              <div className="space-y-1 text-[11px]">
                <div className="flex justify-between">
                  <span className="text-muted-foreground/60">Entry</span>
                  <span className="font-mono">{fmtPrice(ta.riskReward.shortEntry)}</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: RED }}>Stop</span>
                  <span className="font-mono" style={{ color: RED }}>
                    {fmtPrice(ta.riskReward.shortStop)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: GREEN }}>Target</span>
                  <span className="font-mono" style={{ color: GREEN }}>
                    {fmtPrice(ta.riskReward.shortTarget)}
                  </span>
                </div>
                <div className="flex justify-between font-semibold">
                  <span className="text-muted-foreground/60">R:R</span>
                  <span
                    className="font-mono"
                    style={{
                      color: ta.riskReward.shortRR >= 2 ? GREEN : AMBER,
                    }}
                  >
                    1:{ta.riskReward.shortRR.toFixed(1)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Fundamental Signal Row ───────────────────────────────────────────────────

function FundamentalSignalRow({ signal }: { signal: FundamentalSignal }) {
  const color =
    signal.direction === "YES" ? GREEN : signal.direction === "NO" ? RED : MUTED
  const Icon =
    signal.direction === "YES"
      ? TrendingUp
      : signal.direction === "NO"
      ? TrendingDown
      : Minus
  const convictionPct = Math.round(signal.conviction * 100)

  return (
    <div className="flex items-start gap-2 py-2 border-b border-border/30 last:border-0">
      <Icon className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 mb-1">
          <span className="text-xs font-semibold text-foreground truncate">
            {signal.name}
          </span>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-[9px] font-mono" style={{ color: "oklch(0.55 0.01 260)" }}>
              w:{(signal.weight * 100).toFixed(0)}
            </span>
            <div className="w-12 h-1 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{ width: `${convictionPct}%`, background: color }}
              />
            </div>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground/70 leading-snug line-clamp-2">
          {signal.reason}
        </p>
      </div>
    </div>
  )
}

// ─── Fundamental Panel ────────────────────────────────────────────────────────

function FundamentalPanel({ fa }: { fa: PremiumFundamentalAnalysis }) {
  const yesSignals = fa.signals.filter((s) => s.direction === "YES")
  const noSignals = fa.signals.filter((s) => s.direction === "NO")
  const neutralSignals = fa.signals.filter((s) => s.direction === "neutral")
  const totalYes = fa.yesScore + fa.noScore || 1

  const efficiencyColor =
    fa.priceEfficiency === "efficient"
      ? GREEN
      : fa.priceEfficiency === "potentially_mispriced"
      ? RED
      : AMBER

  return (
    <div className="space-y-3">
      {/* Score bar */}
      <div className="space-y-1.5">
        <div className="flex justify-between text-[10px] font-mono text-muted-foreground">
          <span style={{ color: GREEN }}>YES {fa.yesScore.toFixed(1)}</span>
          <span>{fa.signals.filter((s) => s.direction === fa.direction).length}/{fa.signals.length} signals agree</span>
          <span style={{ color: RED }}>NO {fa.noScore.toFixed(1)}</span>
        </div>
        <div className="relative w-full h-2 rounded-full overflow-hidden bg-[oklch(0.15_0.01_260)]">
          <div
            className="absolute right-1/2 top-0 h-full rounded-l-full"
            style={{
              width: `${Math.min(50, (fa.noScore / totalYes) * 100)}%`,
              background: RED,
            }}
          />
          <div
            className="absolute left-1/2 top-0 h-full rounded-r-full"
            style={{
              width: `${Math.min(50, (fa.yesScore / totalYes) * 100)}%`,
              background: GREEN,
            }}
          />
          <div className="absolute left-1/2 top-0 w-px h-full bg-muted-foreground/40 -translate-x-px" />
        </div>
      </div>

      {/* Market stats row */}
      <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
        <div className="rounded-lg p-1.5 sm:p-2.5 bg-[oklch(0.13_0.013_255)] border border-[oklch(0.20_0.014_255)] text-center min-w-0">
          <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/50 mb-1 truncate">Implied Prob</p>
          <p className="text-xs sm:text-sm font-mono font-bold" style={{ color: fa.impliedProbability >= 60 ? GREEN : fa.impliedProbability <= 40 ? RED : AMBER }}>
            {fa.impliedProbability}%
          </p>
        </div>
        <div className="rounded-lg p-1.5 sm:p-2.5 bg-[oklch(0.13_0.013_255)] border border-[oklch(0.20_0.014_255)] text-center min-w-0">
          <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/50 mb-1 truncate">Efficiency</p>
          <p className="text-[10px] font-semibold leading-tight truncate" style={{ color: efficiencyColor }}>
            {fa.priceEfficiency === "potentially_mispriced" ? "Mispriced?" : fa.priceEfficiency.replace("_", " ")}
          </p>
        </div>
        <div className="rounded-lg p-1.5 sm:p-2.5 bg-[oklch(0.13_0.013_255)] border border-[oklch(0.20_0.014_255)] text-center min-w-0">
          <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/50 mb-1 truncate">Days Left</p>
          <p className="text-xs sm:text-sm font-mono font-bold text-foreground">
            {fa.daysToResolution !== null ? fa.daysToResolution : "—"}
          </p>
        </div>
      </div>

      {/* Mispricing alert */}
      {fa.priceEfficiency === "potentially_mispriced" && (
        <div className="rounded-md p-2.5 bg-[oklch(0.58_0.2_25_/_0.08)] border border-[oklch(0.58_0.2_25_/_0.2)]">
          <p className="text-[10px]" style={{ color: RED }}>
            ⚠ News sentiment diverges from market price — potential mispricing detected
          </p>
        </div>
      )}

      {/* Signal lists */}
      {yesSignals.length > 0 && (
        <div>
          <p className="text-[9px] font-bold uppercase tracking-widest mb-1" style={{ color: GREEN }}>
            YES signals ({yesSignals.length})
          </p>
          {yesSignals.map((s, i) => <FundamentalSignalRow key={i} signal={s} />)}
        </div>
      )}
      {noSignals.length > 0 && (
        <div className="mt-2">
          <p className="text-[9px] font-bold uppercase tracking-widest mb-1" style={{ color: RED }}>
            NO signals ({noSignals.length})
          </p>
          {noSignals.map((s, i) => <FundamentalSignalRow key={i} signal={s} />)}
        </div>
      )}
      {neutralSignals.length > 0 && (
        <div className="mt-2">
          <p className="text-[9px] font-bold uppercase tracking-widest mb-1 text-muted-foreground/60">
            Neutral ({neutralSignals.length})
          </p>
          {neutralSignals.map((s, i) => <FundamentalSignalRow key={i} signal={s} />)}
        </div>
      )}

      {/* Rationale */}
      <p className="text-[11px] text-muted-foreground/70 leading-relaxed pt-1 border-t border-border/30">
        {fa.verdictRationale}
      </p>
    </div>
  )
}

// ─── Full unlocked state ───────────────────────────────────────────────────────

function UnlockedState({ analysis }: { analysis: PremiumAnalysis }) {
  const ta = analysis.technicalAnalysis
  const fa = analysis.fundamentalAnalysis

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Shield className="w-5 h-5 text-primary" />
        <h3 className="text-lg font-semibold text-foreground">Intelligence Report</h3>
        {ta && (
          <Badge
            variant="outline"
            className="ml-auto text-[9px] uppercase tracking-widest"
            style={{ borderColor: AMBER, color: AMBER }}
          >
            {ta.symbol} · {fmtPrice(ta.currentPrice)}
          </Badge>
        )}
        {fa && !ta && (
          <Badge
            variant="outline"
            className="ml-auto text-[9px] uppercase tracking-widest"
            style={{ borderColor: AMBER, color: AMBER }}
          >
            {fa.category.replace("_", "/")} · {fa.daysToResolution !== null ? `${fa.daysToResolution}d` : "open"}
          </Badge>
        )}
      </div>

      {/* Verdict banner */}
      <VerdictBanner verdict={analysis.verdict} ta={ta} fa={fa} probabilityModel={analysis.probabilityModel} />

      {/* Quant score row — crypto markets */}
      {ta?.computedVerdict && (
        <QuantScoreRow cv={ta.computedVerdict} regime={ta.regime} />
      )}

      {/* Fundamental score row — non-crypto markets */}
      {fa && !ta && (
        <div className="grid grid-cols-3 gap-1.5 sm:gap-2 my-3">
          <StatPill
            label="Net Score"
            value={`${fa.netScore > 0 ? "+" : ""}${fa.netScore.toFixed(0)}`}
            color={fa.netScore > 5 ? GREEN : fa.netScore < -5 ? RED : MUTED}
          />
          <StatPill
            label="Category"
            value={fa.category.replace("_", "/")}
            color={AMBER}
          />
          <StatPill
            label="Implied"
            value={`${fa.impliedProbability}%`}
            color={
              fa.impliedProbability >= 65
                ? GREEN
                : fa.impliedProbability <= 35
                ? RED
                : AMBER
            }
          />
        </div>
      )}

      {/* TA-specific collapsible panels (crypto only) */}
      {ta && (
        <div className="divide-y divide-border/50">
          <CollapsibleSection
            title="Signal Breakdown"
            icon={<BarChart3 className="w-3.5 h-3.5 text-muted-foreground" />}
          >
            <SignalBreakdown cv={ta.computedVerdict} />
          </CollapsibleSection>
          <CollapsibleSection
            title="Market Microstructure"
            icon={<Activity className="w-3.5 h-3.5 text-muted-foreground" />}
          >
            <MicrostructurePanel ta={ta} />
          </CollapsibleSection>
          <CollapsibleSection
            title="Technical Levels & Indicators"
            icon={<Target className="w-3.5 h-3.5 text-muted-foreground" />}
          >
            <TechLevelsPanel ta={ta} />
          </CollapsibleSection>
        </div>
      )}

      {/* Fundamental signal panels (non-crypto markets only) */}
      {fa && (
        <div className="divide-y divide-border/50">
          <CollapsibleSection
            title="Fundamental Signal Breakdown"
            icon={<BarChart3 className="w-3.5 h-3.5 text-muted-foreground" />}
          >
            <FundamentalPanel fa={fa} />
          </CollapsibleSection>
        </div>
      )}

      {/* AI-generated intelligence sections */}
      <div className="divide-y divide-border/50">
        <CollapsibleSection title="Event Brief" defaultOpen>
          {analysis.eventBrief}
        </CollapsibleSection>
        <CollapsibleSection title="Global Context">
          {analysis.globalContext}
        </CollapsibleSection>
        <CollapsibleSection title="Structural Drivers">
          <ul className="list-disc list-inside space-y-1">
            {analysis.structuralDrivers.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </CollapsibleSection>
        <CollapsibleSection title="Market Signal Interpretation">
          {analysis.marketSignalInterpretation}
        </CollapsibleSection>
        <CollapsibleSection title="Information Asymmetry">
          {analysis.informationAsymmetry}
        </CollapsibleSection>
        <CollapsibleSection title="Risk Landscape">
          <ul className="space-y-1.5">
            {analysis.riskLandscape.map((r, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0 text-destructive" />
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </CollapsibleSection>
        <CollapsibleSection title="Strategic Insight">
          {analysis.strategicInsight}
        </CollapsibleSection>
        <CollapsibleSection title="Terminal Note">
          <p className="italic">{analysis.terminalNote}</p>
        </CollapsibleSection>
      </div>

      {/* News sources */}
      {analysis.newsSources.length > 0 && (
        <div className="pt-2 space-y-2">
          <h4 className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/60">
            Live Intelligence Sources
          </h4>
          {analysis.newsSources.map((s, i) => (
            <a
              key={i}
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm text-primary hover:underline"
            >
              <ExternalLink className="w-3 h-3 shrink-0" />
              {s.title}
            </a>
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-2">
        <p className="text-[10px] text-muted-foreground/50">
          Generated {new Date(analysis.generatedAt).toLocaleString()} · Powered by SmartMarket
        </p>
        <span
          className="text-[9px] font-mono text-muted-foreground/30"
          title="Signal hash"
        >
          #{analysis.signalHash}
        </span>
      </div>
    </div>
  )
}

// ─── Locked state ─────────────────────────────────────────────────────────────

function LockedState({
  onUnlock,
  loading,
  walletConnected,
}: {
  onUnlock: () => void
  loading: boolean
  walletConnected: boolean
}) {
  const feeEnabled = PREMIUM_ANALYSIS_FEE_ENABLED
  const actionLabel = !walletConnected
    ? "Connect wallet to analyze"
    : feeEnabled
    ? "Unlock for $1 USDT"
    : "Generate analysis"

  return (
    <div className="flex min-h-[400px] flex-col space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Lock className="w-5 h-5 text-primary" />
          <h3 className="text-xl font-semibold text-foreground">
            Deep Intelligence Report
          </h3>
        </div>
        <span className="rounded-full border border-primary/25 bg-primary/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-primary">
          {feeEnabled ? "Premium" : "Free testing"}
        </span>
      </div>

      <p className="text-sm text-muted-foreground">
        Real-time news research &bull; 16-signal quant engine &bull; Definitive YES/NO verdict
      </p>

      {/* Feature list */}
      <div className="grid grid-cols-2 gap-2">
        {[
          { icon: <BarChart3 className="w-3.5 h-3.5" />, label: "16 signal votes" },
          { icon: <Activity className="w-3.5 h-3.5" />, label: "OI · L/S · Taker" },
          { icon: <Target className="w-3.5 h-3.5" />, label: "Risk/reward setup" },
          { icon: <Shield className="w-3.5 h-3.5" />, label: "AI intelligence" },
        ].map((f, i) => (
          <div
            key={i}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[oklch(0.13_0.013_255)] border border-[oklch(0.20_0.014_255)]"
          >
            <span style={{ color: AMBER }}>{f.icon}</span>
            <span className="text-[11px] text-muted-foreground/70">{f.label}</span>
          </div>
        ))}
      </div>

      <div className="grid flex-1 gap-3 select-none sm:grid-cols-2" aria-hidden>
        {[
          "Structural analysis of market fundamentals across primary signals...",
          "Global context: geopolitical, economic, and catalyst implications...",
          "Information asymmetry detected in current pricing and liquidity...",
          "Resolution-risk model with directional confidence and terminal note...",
        ].map((line, i) => (
          <div
            key={i}
            className="rounded-xl border border-border/50 bg-background/40 p-4 text-sm leading-relaxed text-muted-foreground/30"
            style={{ filter: "blur(4px)" }}
          >
            {line}
          </div>
        ))}
      </div>

      <Button
        className={[
          "relative mt-auto h-11 w-full overflow-hidden font-semibold transition-all",
          !walletConnected
            ? "border border-[oklch(0.78_0.16_82/0.55)] bg-[oklch(0.78_0.16_82/0.10)] text-[oklch(0.86_0.16_82)] shadow-[0_0_0_1px_oklch(0.78_0.16_82/0.20),0_0_28px_oklch(0.78_0.16_82/0.20)] hover:bg-[oklch(0.78_0.16_82/0.16)]"
            : "",
        ].join(" ")}
        onClick={onUnlock}
        disabled={loading}
      >
        {!walletConnected && (
          <span className="pointer-events-none absolute inset-0 animate-pulse bg-[linear-gradient(110deg,transparent,oklch(1_0_0/0.10),transparent)]" />
        )}
        <span className="relative inline-flex items-center justify-center">
          {loading ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : !walletConnected ? (
            <Wallet className="w-4 h-4 mr-2" />
          ) : (
            <Zap className="w-4 h-4 mr-2" />
          )}
          {actionLabel}
        </span>
      </Button>
    </div>
  )
}

// ─── Loading state ────────────────────────────────────────────────────────────

function LoadingState({ status }: { status: string }) {
  const messages: Record<string, string> = {
    paying: "Approve USDT transfer...",
    confirming: "Confirming on BSC...",
    analyzing: "Generating intelligence report...",
  }
  return (
    <div className="flex min-h-[400px] flex-col items-center justify-center py-8 space-y-4">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
      <p key={status} className="text-sm font-medium text-foreground">
        {messages[status] ?? "Processing..."}
      </p>
      <p className="text-xs text-muted-foreground">Estimated ~30 seconds</p>
    </div>
  )
}

// ─── Root component ───────────────────────────────────────────────────────────

export function PremiumAnalysisCard({ market }: PremiumAnalysisCardProps) {
  const { login, authenticated } = usePrivy()
  const activePrivyWallet = useActivePrivyWallet()
  const { status, analysis, unlockAnalysis } = usePremiumAnalysis(market.id)
  const walletConnected = Boolean(authenticated && activePrivyWallet.wallet)

  const handleUnlock = async () => {
    if (!walletConnected) {
      login()
      return
    }

    await unlockAnalysis(market, activePrivyWallet.wallet)
  }

  const isLoading =
    status === "paying" || status === "confirming" || status === "analyzing"

  return (
    <Card className="p-5 sm:p-6 border-primary/20 bg-card shadow-[0_18px_80px_oklch(0.02_0.01_260/0.28)]">
      {walletConnected && status === "done" && analysis ? (
        <UnlockedState analysis={analysis} />
      ) : walletConnected && isLoading ? (
        <LoadingState status={status} />
      ) : (
        <LockedState onUnlock={handleUnlock} loading={isLoading} walletConnected={walletConnected} />
      )}
    </Card>
  )
}
