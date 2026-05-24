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

function loadCached(marketId: string): PremiumAnalysis | null {
  try {
    const raw = localStorage.getItem(cacheKey(marketId))
    if (!raw) return null
    return JSON.parse(raw) as PremiumAnalysis
  } catch {
    return null
  }
}

function saveCached(marketId: string, analysis: PremiumAnalysis): void {
  try {
    localStorage.setItem(cacheKey(marketId), JSON.stringify(analysis))
  } catch {}
}

function premiumErrorMessage(err: any): { title: string; description: string } {
  const rawMessage = String(err?.shortMessage ?? err?.reason ?? err?.message ?? "").toLowerCase()

  if (err?.code === "ACTION_REJECTED" || rawMessage.includes("user rejected")) {
    return {
      title: "Transaction cancelled",
      description: "No worries, nothing was charged. You can unlock the report whenever you're ready.",
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
    title: "Couldn't unlock the report",
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
    async (market: Record<string, unknown>, wallet: ConnectedWallet) => {
      setError(null)
      setStatus("paying")

      try {
        const initialRes = await fetch(`${API_BASE}/analysis/premium`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ market }),
        })

        if (initialRes.status !== 402) {
          if (initialRes.ok) {
            const data = await initialRes.json()
            if (data.analysis) {
              setAnalysis(data.analysis)
              saveCached(marketId, data.analysis)
              setStatus("done")
              return
            }
          }
          throw new Error("Unexpected response from analysis endpoint")
        }

        const { paymentRequired } = (await initialRes.json()) as {
          paymentRequired: PaymentRequirement
        }

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
