"use client"

import { useCallback, useEffect, useState } from "react"
import type { TradeReadinessResponse, TradingProfile } from "@smartmarket/types"

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000"

type TradeReadinessState = {
  readiness: TradeReadinessResponse | null
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

type TradeReadinessArgs = {
  connectedWalletAddress?: string | null
  profile?: TradingProfile | null
  tokenId?: string | null
  marketId?: string | null
  amountUsd?: number
  clobSessionStatus?: string
  createClobSessionHeaders?: () => Promise<Record<string, string> | null>
}

type TradeReadinessOptions = {
  enabled?: boolean
  initialDelayMs?: number
}

export function useTradeReadiness(args: TradeReadinessArgs, options: TradeReadinessOptions = {}): TradeReadinessState {
  const [readiness, setReadiness] = useState<TradeReadinessResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const enabled = options.enabled ?? true
  const initialDelayMs = options.initialDelayMs ?? 0

  const refresh = useCallback(async () => {
    setError(null)

    if (!enabled || !args.connectedWalletAddress) {
      setReadiness(null)
      return
    }

    setLoading(true)
    try {
      const clobHeaders = await args.createClobSessionHeaders?.()
      const res = await fetch(`${API_BASE}/trade/readiness`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(clobHeaders ?? {}),
        },
        body: JSON.stringify({
          connectedWalletAddress: args.connectedWalletAddress,
          tradingWalletAddress: args.profile?.tradingWalletAddress,
          tradingWalletKind: args.profile?.tradingWalletKind,
          depositAddress: args.profile?.depositAddress?.evm,
          marketId: args.marketId,
          tokenId: args.tokenId,
          amountUsd: args.amountUsd && Number.isFinite(args.amountUsd) && args.amountUsd > 0 ? args.amountUsd : undefined,
        }),
      })
      const payload = await res.json()
      if (!res.ok || !payload?.ok) {
        throw new Error(payload?.error ?? "Readiness check failed")
      }
      setReadiness(payload)
    } catch (err: any) {
      setReadiness(null)
      setError(err?.message ?? "Readiness check failed")
    } finally {
      setLoading(false)
    }
  }, [
    args.amountUsd,
    args.clobSessionStatus,
    args.connectedWalletAddress,
    args.createClobSessionHeaders,
    args.marketId,
    args.profile?.depositAddress?.evm,
    args.profile?.tradingWalletAddress,
    args.profile?.tradingWalletKind,
    args.tokenId,
    enabled,
  ])

  useEffect(() => {
    if (!enabled || !args.connectedWalletAddress) {
      setReadiness(null)
      setError(null)
      return
    }
    const timer = window.setTimeout(() => {
      void refresh()
    }, initialDelayMs)
    return () => window.clearTimeout(timer)
  }, [
    args.connectedWalletAddress,
    args.profile?.tradingWalletAddress,
    args.profile?.depositAddress?.evm,
    args.tokenId,
    args.marketId,
    args.amountUsd,
    args.clobSessionStatus,
    enabled,
    initialDelayMs,
    refresh,
  ])

  return { readiness, loading, error, refresh }
}
