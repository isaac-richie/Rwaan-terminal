"use client"

import { useEffect, useMemo, useState } from "react"
import type { BridgeTransaction, FundingStatusPhase, FundingStatusResponse } from "@smartmarket/types"

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000"

type FundingStatusOptions = {
  active?: boolean
  intervalMs?: number
}

type FundingStatusState = {
  data: FundingStatusResponse | null
  transactions: BridgeTransaction[]
  latest: BridgeTransaction | null
  phase: FundingStatusPhase
  label: string
  message: string
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

const DEFAULT_STATUS: Pick<FundingStatusState, "phase" | "label" | "message"> = {
  phase: "not_started",
  label: "Waiting for deposit",
  message: "Send a supported BNB Chain asset to the deposit address, then Rawali will track bridge progress.",
}

export function formatFundingStatus(status?: string | null) {
  if (!status) return DEFAULT_STATUS.label
  return status.replace(/_/g, " ").toLowerCase()
}

export function fundingStatusTone(phase?: FundingStatusPhase) {
  if (phase === "completed") return "text-[oklch(0.68_0.18_155)]"
  if (phase === "failed") return "text-[oklch(0.58_0.2_25)]"
  if (phase === "processing" || phase === "detected") return "text-[oklch(0.78_0.16_82)]"
  return "text-muted-foreground"
}

export function useFundingStatus(depositAddress?: string | null, options: FundingStatusOptions = {}): FundingStatusState {
  const active = options.active ?? Boolean(depositAddress)
  const intervalMs = options.intervalMs ?? 12_000
  const [data, setData] = useState<FundingStatusResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = async () => {
    if (!depositAddress) {
      setData(null)
      setError(null)
      return
    }

    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/funding/status/${depositAddress}`)
      const payload = await res.json()
      if (!res.ok || payload?.ok === false) {
        throw new Error(payload?.error ?? "Failed to load funding status")
      }
      setData(payload as FundingStatusResponse)
    } catch (err: any) {
      setError(err?.message ?? "Failed to load funding status")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!active || !depositAddress) {
      setData(null)
      setError(null)
      return
    }
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, depositAddress])

  useEffect(() => {
    if (!active || !depositAddress || intervalMs <= 0) return
    // Stop polling once the bridge deposit has reached a terminal phase
    const terminalPhase = data?.phase === "completed" || data?.phase === "failed"
    if (terminalPhase) return
    const id = window.setInterval(refresh, intervalMs)
    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, depositAddress, intervalMs, data?.phase])

  const transactions = useMemo(() => data?.transactions ?? [], [data?.transactions])
  const latest = data?.latest ?? transactions[0] ?? null
  const phase = data?.phase ?? DEFAULT_STATUS.phase

  return {
    data,
    transactions,
    latest,
    phase,
    label: data?.label ?? DEFAULT_STATUS.label,
    message: data?.message ?? DEFAULT_STATUS.message,
    loading,
    error,
    refresh,
  }
}
