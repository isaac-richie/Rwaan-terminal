"use client"

import { useCallback, useEffect, useState } from "react"

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000"

export type GasAssistStatus = {
  ok: boolean
  enabled: boolean
  eligible: boolean
  reason: string
  wallet: string
  polBalance: string
  polBalanceHuman: string
  pUsdBalance: string
  pUsdBalanceHuman: string
  minPolBalance: string
  topupPol: string
  recentTxHash?: string
  txHash?: string
  relayerAddress?: string
}

type GasAssistState = {
  status: GasAssistStatus | null
  loading: boolean
  requesting: boolean
  error: string | null
  refresh: () => Promise<GasAssistStatus | null>
  requestAssist: (reason?: string) => Promise<GasAssistStatus | null>
}

export function useGasAssist(address?: string | null, active = true): GasAssistState {
  const [status, setStatus] = useState<GasAssistStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [requesting, setRequesting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!active || !address) {
      setStatus(null)
      setError(null)
      return null
    }

    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/gas-assist/status?address=${encodeURIComponent(address)}`)
      const payload = await res.json()
      if (!res.ok || payload?.ok === false) throw new Error(payload?.error ?? "Unable to check Polygon gas assist.")
      setStatus(payload as GasAssistStatus)
      return payload as GasAssistStatus
    } catch (err: any) {
      setError(err?.message ?? "Unable to check Polygon gas assist.")
      return null
    } finally {
      setLoading(false)
    }
  }, [active, address])

  const requestAssist = useCallback(async (reason = "polygon_gas_assist") => {
    if (!address) return null

    setRequesting(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/gas-assist/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, reason }),
      })
      const payload = await res.json()
      if (!res.ok || payload?.ok === false) throw new Error(payload?.error ?? "Polygon gas assist failed.")
      setStatus(payload as GasAssistStatus)
      return payload as GasAssistStatus
    } catch (err: any) {
      setError(err?.message ?? "Polygon gas assist failed.")
      return null
    } finally {
      setRequesting(false)
    }
  }, [address])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { status, loading, requesting, error, refresh, requestAssist }
}
