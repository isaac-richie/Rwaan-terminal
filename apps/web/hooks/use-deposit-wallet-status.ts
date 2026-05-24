"use client"

import { useCallback, useEffect, useState } from "react"

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000"

export type DepositWalletStatus = {
  ok: boolean
  owner: string
  depositWallet: string
  deployed: boolean
  relayerUrl: string
  builderConfigured: boolean
  transactionID?: string
  transactionHash?: string
  state?: string
  error?: string
}

type DepositWalletStatusState = {
  status: DepositWalletStatus | null
  loading: boolean
  deploying: boolean
  error: string | null
  refresh: () => Promise<DepositWalletStatus | null>
  deploy: () => Promise<DepositWalletStatus | null>
}

export function useDepositWalletStatus(owner?: string | null, active = true): DepositWalletStatusState {
  const [status, setStatus] = useState<DepositWalletStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [deploying, setDeploying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!owner || !active) {
      setStatus(null)
      setError(null)
      return null
    }

    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/deposit-wallet/status?owner=${encodeURIComponent(owner)}`)
      const payload = await res.json()
      if (!res.ok || payload?.ok === false) throw new Error(payload?.error ?? "Unable to check deposit wallet.")
      setStatus(payload as DepositWalletStatus)
      return payload as DepositWalletStatus
    } catch (err: any) {
      setError(err?.message ?? "Unable to check deposit wallet.")
      return null
    } finally {
      setLoading(false)
    }
  }, [owner, active])

  const deploy = useCallback(async () => {
    if (!owner) return null

    setDeploying(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/deposit-wallet/deploy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner }),
      })
      const payload = await res.json()
      if (!res.ok || payload?.ok === false) {
        throw new Error(payload?.error ?? "Unable to deploy deposit wallet.")
      }
      setStatus(payload as DepositWalletStatus)
      return payload as DepositWalletStatus
    } catch (err: any) {
      setError(err?.message ?? "Unable to deploy deposit wallet.")
      return null
    } finally {
      setDeploying(false)
    }
  }, [owner])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { status, loading, deploying, error, refresh, deploy }
}
