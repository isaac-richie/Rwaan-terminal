"use client"

import { useCallback, useEffect, useRef, useState } from "react"

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
  const autoDeployAttemptedRef = useRef(false)

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
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 60_000)
      const res = await fetch(`${API_BASE}/deposit-wallet/deploy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner }),
        signal: controller.signal,
      })
      clearTimeout(timeout)
      const payload = await res.json()
      if (!res.ok || payload?.ok === false) {
        const errorMsg = payload?.error === "builder_relayer_not_configured"
          ? "Builder relayer not configured on server. Contact the Rawli team."
          : payload?.error ?? "Unable to deploy deposit wallet."
        throw new Error(errorMsg)
      }
      setStatus(payload as DepositWalletStatus)
      return payload as DepositWalletStatus
    } catch (err: any) {
      if (err?.name === "AbortError") {
        setError("Deploy timed out. The wallet may still be deploying — try refreshing in a moment.")
      } else {
        setError(err?.message ?? "Unable to deploy deposit wallet.")
      }
      return null
    } finally {
      setDeploying(false)
    }
  }, [owner])

  // Initial status fetch
  useEffect(() => {
    autoDeployAttemptedRef.current = false
    void refresh()
  }, [refresh])

  // Auto-deploy when status shows not deployed but builder is configured
  useEffect(() => {
    if (
      status &&
      !status.deployed &&
      status.builderConfigured &&
      active &&
      owner &&
      !deploying &&
      !autoDeployAttemptedRef.current
    ) {
      autoDeployAttemptedRef.current = true
      void deploy().then((result) => {
        // If deploy succeeded but wallet still not deployed, poll status a few times
        if (result && !result.deployed) {
          let polls = 0
          const pollInterval = setInterval(async () => {
            polls += 1
            const refreshed = await refresh()
            if (refreshed?.deployed || polls >= 8) {
              clearInterval(pollInterval)
            }
          }, 3000)
        }
      })
    }
  }, [status, active, owner, deploying, deploy, refresh])

  return { status, loading, deploying, error, refresh, deploy }
}
