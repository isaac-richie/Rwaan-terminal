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

const READINESS_CACHE_TTL_MS = 2_500
const READINESS_MAX_CACHE_ENTRIES = 80

const readinessCache = new Map<string, { at: number; data: TradeReadinessResponse }>()
const readinessInflight = new Map<string, Promise<TradeReadinessResponse>>()

function normalizedAmountUsd(amountUsd?: number): number | undefined {
  if (!amountUsd || !Number.isFinite(amountUsd) || amountUsd <= 0) return undefined
  return Number(amountUsd.toFixed(6))
}

function buildReadinessBody(args: TradeReadinessArgs) {
  return {
    connectedWalletAddress: args.connectedWalletAddress,
    tradingWalletAddress: args.profile?.tradingWalletAddress,
    tradingWalletKind: args.profile?.tradingWalletKind,
    depositAddress: args.profile?.depositAddress?.evm,
    marketId: args.marketId,
    tokenId: args.tokenId,
    amountUsd: normalizedAmountUsd(args.amountUsd),
  }
}

function buildReadinessKey(body: ReturnType<typeof buildReadinessBody>, clobSessionKey: string) {
  return JSON.stringify({ ...body, clobSessionKey })
}

function rememberReadiness(key: string, data: TradeReadinessResponse) {
  readinessCache.set(key, { at: Date.now(), data })
  if (readinessCache.size <= READINESS_MAX_CACHE_ENTRIES) return
  const oldestKey = readinessCache.keys().next().value
  if (oldestKey) readinessCache.delete(oldestKey)
}

async function readApiPayload(res: Response): Promise<any> {
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return { ok: false, error: "invalid_response", message: text.slice(0, 180) }
  }
}

function readinessErrorMessage(payload: any): string {
  if (payload?.error === "rate_limited") {
    return payload?.message ?? "Too many requests. Please wait a few seconds and try again."
  }
  return payload?.message ?? payload?.error ?? "Readiness check failed"
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

    const body = buildReadinessBody(args)
    const clobSessionKey = args.createClobSessionHeaders
      ? `clob:${args.clobSessionStatus ?? "unknown"}`
      : "none"
    const cacheKey = buildReadinessKey(body, clobSessionKey)
    const cached = readinessCache.get(cacheKey)
    if (cached && Date.now() - cached.at < READINESS_CACHE_TTL_MS) {
      setReadiness(cached.data)
      setLoading(false)
      return
    }

    const existingRequest = readinessInflight.get(cacheKey)
    let createdRequest = false
    setLoading(!existingRequest)
    try {
      const request = existingRequest ?? (async () => {
        const clobHeaders = await args.createClobSessionHeaders?.()
        const res = await fetch(`${API_BASE}/trade/readiness`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(clobHeaders ?? {}),
          },
          body: JSON.stringify(body),
        })
        const payload = await readApiPayload(res)
        if (!res.ok || !payload?.ok) {
          throw new Error(readinessErrorMessage(payload))
        }
        return payload as TradeReadinessResponse
      })()

      if (!existingRequest) {
        readinessInflight.set(cacheKey, request)
        createdRequest = true
      }
      const payload = await request
      rememberReadiness(cacheKey, payload)
      setReadiness(payload)
    } catch (err: any) {
      setReadiness(null)
      setError(err?.message ?? "Readiness check failed")
    } finally {
      if (createdRequest) readinessInflight.delete(cacheKey)
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
