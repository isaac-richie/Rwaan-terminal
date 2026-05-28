"use client"

import { useEffect, useState } from "react"
import type { TradingProfile, TradingWalletKind } from "@smartmarket/types"

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000"

type TradingProfileState = {
  profile: TradingProfile | null
  loading: boolean
  depositLoading: boolean
  error: string | null
  refresh: () => Promise<void>
  createDepositAddress: () => Promise<TradingProfile | null>
}

export function shortAddress(address?: string | null) {
  if (!address) return "—"
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

export function useTradingProfile(
  connectedWalletAddress?: string | null,
  tradingWalletAddress?: string | null,
  tradingWalletKind?: TradingWalletKind
): TradingProfileState {
  const [profile, setProfile] = useState<TradingProfile | null>(null)
  const [loading, setLoading] = useState(false)
  const [depositLoading, setDepositLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = async () => {
    if (!connectedWalletAddress) {
      setProfile(null)
      setError(null)
      return
    }

    setLoading(true)
    setError(null)
    try {
      const hasTradingWallet = Boolean(tradingWalletAddress)
      const res = hasTradingWallet
        ? await fetch(`${API_BASE}/trading-profile/resolve`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              connectedWalletAddress,
              tradingWalletAddress,
              ...(tradingWalletKind ? { tradingWalletKind } : {}),
            }),
          })
        : await fetch(`${API_BASE}/trading-profile/${connectedWalletAddress}`)
      const payload = await res.json()
      if (!hasTradingWallet && res.status === 404) {
        setProfile(null)
        return
      }
      if (!res.ok) {
        throw new Error(payload?.error ?? "Trading profile setup failed")
      }
      setProfile(payload.profile ?? null)
    } catch (err: any) {
      setProfile(null)
      setError(err?.message ?? "Trading profile setup failed")
    } finally {
      setLoading(false)
    }
  }

  const createDepositAddress = async () => {
    if (!connectedWalletAddress) {
      setError("Connect wallet before creating a deposit address")
      return null
    }

    setDepositLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/trading-profile/${connectedWalletAddress}/deposit-address`, {
        method: "POST",
      })
      const payload = await res.json()
      if (!res.ok) {
        throw new Error(payload?.error ?? "Deposit address setup failed")
      }
      setProfile(payload.profile ?? null)
      return payload.profile ?? null
    } catch (err: any) {
      setError(err?.message ?? "Deposit address setup failed")
      return null
    } finally {
      setDepositLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectedWalletAddress, tradingWalletAddress, tradingWalletKind])

  return { profile, loading, depositLoading, error, refresh, createDepositAddress }
}
