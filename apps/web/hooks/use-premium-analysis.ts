"use client"

import { useCallback, useEffect, useState } from "react"
import { BrowserProvider } from "ethers"
import type { ConnectedWallet } from "@privy-io/react-auth"
import { toast } from "sonner"
import type { PremiumAnalysis, PaymentRequirement } from "@smartmarket/types"
import { encodeErc20Transfer } from "@/lib/abi"

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000"
const BSC_CHAIN_ID = 56
const BSC_CHAIN_HEX = "0x38"

type PremiumStatus = "idle" | "paying" | "confirming" | "analyzing" | "done" | "error"

type SwitchableWallet = ConnectedWallet & {
  switchChain?: (chainId: number) => Promise<void>
}

function cacheKey(marketId: string): string {
  return `smartmarket:premium:${marketId}`
}

const GENERIC_FALLBACK_RATIONALE =
  "Insufficient live data for a high-conviction directional call."

function isGenericFallbackRationale(rationale?: string | null): boolean {
  return String(rationale ?? "")
    .toLowerCase()
    .includes(GENERIC_FALLBACK_RATIONALE.toLowerCase())
}

function normalizePremiumAnalysis(analysis: PremiumAnalysis): PremiumAnalysis {
  const ta = analysis.technicalAnalysis
  const cv = ta?.computedVerdict
  const fa = analysis.fundamentalAnalysis

  const computed = cv
    ? {
        direction: cv.direction,
        confidence: Math.min(95, Math.max(10, cv.confidence)),
        rationale:
          cv.verdictRationale ||
          `Quant engine verdict based on ${ta?.confluenceFactors?.length ?? 0} confluence factors across ${cv.totalSignals ?? 0} technical signals (${cv.signalAgreement ?? 0}% signal agreement).`,
      }
    : fa
    ? {
        direction: fa.direction,
        confidence: Math.min(88, Math.max(15, fa.confidence)),
        rationale: fa.verdictRationale || "Fundamental signal engine verdict based on live news and market scoring.",
      }
    : null

  if (!computed) return analysis

  const incomingConfidence = Number(analysis.verdict?.confidence)
  const confidenceDrift = Number.isFinite(incomingConfidence)
    ? Math.abs(incomingConfidence - computed.confidence)
    : Number.POSITIVE_INFINITY
  const shouldRepair =
    !analysis.verdict?.rationale ||
    isGenericFallbackRationale(analysis.verdict.rationale) ||
    analysis.verdict.direction !== computed.direction ||
    confidenceDrift > 10

  if (!shouldRepair) return analysis

  return {
    ...analysis,
    verdict: {
      direction: computed.direction,
      confidence: computed.confidence,
      rationale: computed.rationale,
    },
  }
}

function loadCached(marketId: string): PremiumAnalysis | null {
  try {
    const raw = localStorage.getItem(cacheKey(marketId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as PremiumAnalysis
    const normalized = normalizePremiumAnalysis(parsed)
    if (normalized !== parsed) saveCached(marketId, normalized)
    return normalized
  } catch {
    return null
  }
}

function saveCached(marketId: string, analysis: PremiumAnalysis): void {
  try {
    localStorage.setItem(cacheKey(marketId), JSON.stringify(normalizePremiumAnalysis(analysis)))
  } catch {}
}

function premiumErrorMessage(err: any): { title: string; description: string } {
  const rawMessage = String(err?.shortMessage ?? err?.reason ?? err?.message ?? "").toLowerCase()

  if (err?.code === "ACTION_REJECTED" || rawMessage.includes("user rejected")) {
    return {
      title: "Transaction cancelled",
      description: "No worries, nothing was charged. You can generate the report whenever you're ready.",
    }
  }

  if (rawMessage.includes("wallet_required")) {
    return {
      title: "Wallet required",
      description: "Connect your wallet to unlock paid reports when analysis fees are enabled.",
    }
  }

  if (
    rawMessage.includes("transfer amount exceeds balance") ||
    rawMessage.includes("insufficient funds") ||
    rawMessage.includes("insufficient balance")
  ) {
    return {
      title: "Not enough USDT",
      description: "Add at least $1 USDT on BNB Chain, plus a little BNB for gas, then try again.",
    }
  }

  if (rawMessage.includes("network") || rawMessage.includes("chain")) {
    return {
      title: "Wallet network issue",
      description: "Please switch your wallet to BNB Chain and try unlocking the report again.",
    }
  }

  return {
    title: "Couldn't generate the report",
    description: "Something got in the way. Please try again in a moment.",
  }
}

async function getBscProvider(wallet: ConnectedWallet) {
  const switchable = wallet as SwitchableWallet
  let provider = await wallet.getEthereumProvider()
  const currentChain = await (provider as any).request({ method: "eth_chainId" }).catch(() => null)

  if (String(currentChain).toLowerCase() !== BSC_CHAIN_HEX && typeof switchable.switchChain === "function") {
    await switchable.switchChain(BSC_CHAIN_ID)
    provider = await wallet.getEthereumProvider()
  }

  return provider
}

export function usePremiumAnalysis(marketId: string) {
  const [status, setStatus] = useState<PremiumStatus>("idle")
  const [analysis, setAnalysis] = useState<PremiumAnalysis | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const cached = loadCached(marketId)
    if (cached) {
      setAnalysis(cached)
      setStatus("done")
    }
  }, [marketId])

  const unlockAnalysis = useCallback(
    async (market: Record<string, unknown>, wallet?: ConnectedWallet | null) => {
      setError(null)
      setStatus("analyzing")

      try {
        const res = await fetch(`${API_BASE}/analysis/premium`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ market }),
        })

        if (res.status !== 402) {
          if (res.ok) {
            const data = await res.json()
            if (data.analysis) {
              setAnalysis(data.analysis)
              saveCached(marketId, data.analysis)
              setStatus("done")
              return
            }
          }
          throw new Error("Unexpected response from analysis endpoint")
        }

        if (!wallet) {
          throw new Error("wallet_required")
        }

        const { paymentRequired } = (await res.json()) as {
          paymentRequired: PaymentRequirement
        }

        setStatus("paying")
        const provider = await getBscProvider(wallet)
        const ethersProvider = new BrowserProvider(provider as any)
        const signer = await ethersProvider.getSigner()

        const txData = encodeErc20Transfer(
          paymentRequired.receiver,
          paymentRequired.amountRaw
        )

        const tx = await signer.sendTransaction({
          to: paymentRequired.tokenContract,
          data: txData,
          gasLimit: 60_000n, // ERC-20 transfer uses ~46k gas; cap to prevent inflated estimates
        })

        setStatus("confirming")
        await tx.wait(1)

        setStatus("analyzing")
        const paidRes = await fetch(`${API_BASE}/analysis/premium`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Payment": tx.hash,
          },
          body: JSON.stringify({ market }),
        })

        if (!paidRes.ok) {
          const err = await paidRes.json().catch(() => ({}))
          throw new Error(err.error ?? "Analysis request failed after payment")
        }

        const data = await paidRes.json()
        if (!data.analysis) {
          throw new Error("No analysis returned")
        }

        setAnalysis(data.analysis)
        saveCached(marketId, data.analysis)
        setStatus("done")
      } catch (err: any) {
        const message = premiumErrorMessage(err)
        setError(message.description)
        setStatus("error")
        toast.error(message.title, {
          description: message.description,
          duration: 7000,
        })
      }
    },
    [marketId]
  )

  const reset = useCallback(() => {
    setStatus("idle")
    setError(null)
  }, [])

  return { status, analysis, error, unlockAnalysis, reset }
}
