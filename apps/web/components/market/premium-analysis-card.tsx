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
} from "lucide-react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { usePrivy } from "@privy-io/react-auth"
import { useActivePrivyWallet } from "@/hooks/use-active-privy-wallet"
import { usePremiumAnalysis } from "@/hooks/use-premium-analysis"
import type { PremiumAnalysis } from "@smartmarket/types"

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

function VerdictBanner({ verdict }: { verdict: PremiumAnalysis["verdict"] }) {
  const isYes = verdict.direction === "YES"
  return (
    <div
      className="rounded-lg p-4"
      style={{
        background: isYes
          ? "oklch(0.68 0.18 155 / 0.15)"
          : "oklch(0.58 0.2 25 / 0.15)",
        borderLeft: `4px solid ${isYes ? "oklch(0.68 0.18 155)" : "oklch(0.58 0.2 25)"}`,
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <span
          className="text-2xl font-bold tracking-tight"
          style={{
            color: isYes ? "oklch(0.68 0.18 155)" : "oklch(0.58 0.2 25)",
          }}
        >
          {verdict.direction}
        </span>
        <Badge
          variant="outline"
          className="text-xs font-mono"
          style={{
            borderColor: isYes
              ? "oklch(0.68 0.18 155)"
              : "oklch(0.58 0.2 25)",
            color: isYes ? "oklch(0.68 0.18 155)" : "oklch(0.58 0.2 25)",
          }}
        >
          {verdict.confidence}% confidence
        </Badge>
      </div>
      <div className="w-full h-2 rounded-full bg-muted overflow-hidden mb-3">
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${verdict.confidence}%`,
            background: isYes
              ? "oklch(0.68 0.18 155)"
              : "oklch(0.58 0.2 25)",
          }}
        />
      </div>
      <p className="text-sm text-muted-foreground">{verdict.rationale}</p>
    </div>
  )
}

function CollapsibleSection({
  title,
  children,
  defaultOpen = false,
}: {
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-b border-border/50 last:border-0">
      <button
        className="w-full flex items-center justify-between py-3 text-sm font-medium text-foreground hover:text-primary transition-colors"
        onClick={() => setOpen(!open)}
      >
        {title}
        {open ? (
          <ChevronUp className="w-4 h-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
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
            <div className="pb-3 text-sm text-muted-foreground leading-relaxed">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function LockedState({
  onUnlock,
  loading,
}: {
  onUnlock: () => void
  loading: boolean
}) {
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
          Premium
        </span>
      </div>
      <p className="text-sm text-muted-foreground">
        Real-time news research &bull; AI-powered analysis &bull; Definitive
        YES/NO verdict
      </p>
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
        className="mt-auto h-11 w-full font-semibold"
        onClick={onUnlock}
        disabled={loading}
      >
        {loading ? (
          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
        ) : (
          <Zap className="w-4 h-4 mr-2" />
        )}
        Unlock for $1 USDT
      </Button>
    </div>
  )
}

function LoadingState({ status }: { status: string }) {
  const messages: Record<string, string> = {
    paying: "Approve USDT transfer...",
    confirming: "Confirming on BSC...",
    analyzing: "Generating intelligence report...",
  }
  return (
    <div className="flex min-h-[400px] flex-col items-center justify-center py-8 space-y-4">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
      <p className="text-sm font-medium text-foreground">
        {messages[status] ?? "Processing..."}
      </p>
      <p className="text-xs text-muted-foreground">Estimated ~30 seconds</p>
    </div>
  )
}

function UnlockedState({ analysis }: { analysis: PremiumAnalysis }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Shield className="w-5 h-5 text-primary" />
        <h3 className="text-lg font-semibold text-foreground">
          Intelligence Report
        </h3>
      </div>

      <VerdictBanner verdict={analysis.verdict} />

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
          <ul className="list-disc list-inside space-y-1">
            {analysis.riskLandscape.map((r, i) => (
              <li key={i} className="flex items-start gap-1">
                <AlertTriangle className="w-3 h-3 mt-1 shrink-0 text-destructive" />
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

      {analysis.newsSources.length > 0 && (
        <div className="pt-2 space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Sources
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

      <p className="text-xs text-muted-foreground/60 text-center pt-2">
        Generated {new Date(analysis.generatedAt).toLocaleString()} &bull;
        Powered by SmartMarket Intelligence
      </p>
    </div>
  )
}

export function PremiumAnalysisCard({ market }: PremiumAnalysisCardProps) {
  const { login, authenticated } = usePrivy()
  const activePrivyWallet = useActivePrivyWallet()
  const { status, analysis, unlockAnalysis } = usePremiumAnalysis(market.id)

  const handleUnlock = async () => {
    if (!authenticated) {
      login()
      return
    }
    const wallet = activePrivyWallet.wallet
    if (!wallet) return
    await unlockAnalysis(market, wallet)
  }

  const isLoading = status === "paying" || status === "confirming" || status === "analyzing"

  return (
    <Card className="p-5 sm:p-6 border-primary/20 bg-card shadow-[0_18px_80px_oklch(0.02_0.01_260/0.28)]">
      {status === "done" && analysis ? (
        <UnlockedState analysis={analysis} />
      ) : isLoading ? (
        <LoadingState status={status} />
      ) : (
        <LockedState onUnlock={handleUnlock} loading={isLoading} />
      )}
    </Card>
  )
}
