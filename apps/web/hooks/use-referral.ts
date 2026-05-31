"use client"

import { useEffect, useState, useCallback } from "react"

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000"

export type ReferralStats = {
  referrer: string
  referralCode: string
  rewardPoints: number
  refereeRewardPoints: number
  totalReferrals: number
  rewardedReferrals: number
  pendingReferrals: number
}

export type ApplyReferralResult = {
  ok: boolean
  recorded?: boolean
  alreadyReferred?: boolean
  refereePoints?: number
  referrerRewardPoints?: number
  rewardPoints?: number
  error?: string
}

const PENDING_REFERRAL_KEY = "rawli.pendingReferral"
const REFERRAL_CODE_RE = /^[A-Za-z0-9-]{3,32}$/
const EVM_RE = /^0x[a-fA-F0-9]{40}$/

function normalizeIncomingRef(value: string | null): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (EVM_RE.test(trimmed)) return trimmed.toLowerCase()
  const code = trimmed.toUpperCase().replace(/[^A-Z0-9]/g, "")
  return REFERRAL_CODE_RE.test(code) ? code : null
}

/**
 * Tracks referral stats for a wallet and handles incoming ?ref= links.
 *
 * On mount:
 *  1. Checks URL for ?ref=0x... query param — if present and wallet is connected,
 *     calls POST /referral/track to record the referral.
 *  2. Fetches referral stats for the connected wallet.
 */
export function useReferral(wallet: string | null | undefined) {
  const [stats, setStats] = useState<ReferralStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [referralLink, setReferralLink] = useState<string>("")
  const [referralCode, setReferralCode] = useState<string>("")
  const [tracking, setTracking] = useState(false)

  const fetchStats = useCallback(async () => {
    if (!wallet) return
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/referral/stats/${wallet}`)
      if (!res.ok) return
      const data = await res.json() as ReferralStats & { ok: boolean }
      if (data.ok) {
        const code = data.referralCode ?? ""
        setReferralCode(code)
        setStats({
          referrer: data.referrer,
          referralCode: code,
          rewardPoints: Number(data.rewardPoints ?? 500),
          refereeRewardPoints: Number(data.refereeRewardPoints ?? 50),
          totalReferrals: data.totalReferrals,
          rewardedReferrals: data.rewardedReferrals,
          pendingReferrals: data.pendingReferrals,
        })
      }
    } catch {
      // ignore — non-critical
    } finally {
      setLoading(false)
    }
  }, [wallet])

  const applyReferralCode = useCallback(async (rawCode: string): Promise<ApplyReferralResult> => {
    if (!wallet) return { ok: false, error: "connect_wallet" }
    const ref = normalizeIncomingRef(rawCode)
    if (!ref) return { ok: false, error: "invalid_code" }
    if (ref.toLowerCase() === wallet.toLowerCase()) return { ok: false, error: "self_referral" }

    setTracking(true)
    try {
      const res = await fetch(`${API_BASE}/referral/track`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ referrer: ref, referee: wallet }),
      })
      const data = await res.json().catch(() => null) as (ApplyReferralResult & { ok?: boolean }) | null
      if (!res.ok || !data?.ok) {
        return { ok: false, error: data?.error ?? "referral_apply_failed" }
      }
      await fetchStats()
      return {
        ok: true,
        recorded: Boolean(data.recorded),
        alreadyReferred: Boolean(data.alreadyReferred),
        refereePoints: Number(data.refereePoints ?? 0),
        referrerRewardPoints: Number(data.referrerRewardPoints ?? data.rewardPoints ?? 500),
      }
    } catch {
      return { ok: false, error: "network_error" }
    } finally {
      setTracking(false)
    }
  }, [fetchStats, wallet])

  // Capture incoming ?ref=CODE immediately, even before the wallet connects.
  useEffect(() => {
    if (typeof window === "undefined") return

    const params = new URLSearchParams(window.location.search)
    const ref = normalizeIncomingRef(params.get("ref") ?? params.get("r"))
    if (!ref) return

    window.localStorage.setItem(PENDING_REFERRAL_KEY, ref)

    // Clean the ref param from the URL without a full reload
    params.delete("ref")
    params.delete("r")
    const newUrl = `${window.location.pathname}${params.toString() ? "?" + params.toString() : ""}`
    window.history.replaceState({}, "", newUrl)
  }, [])

  // Process stored referral once the referee wallet is known.
  useEffect(() => {
    if (!wallet) return
    if (typeof window === "undefined") return

    const ref = normalizeIncomingRef(window.localStorage.getItem(PENDING_REFERRAL_KEY))
    if (!ref || ref.toLowerCase() === wallet.toLowerCase()) {
      window.localStorage.removeItem(PENDING_REFERRAL_KEY)
      return
    }

    let alive = true
    setTracking(true)
    fetch(`${API_BASE}/referral/track`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ referrer: ref, referee: wallet }),
    })
      .then((res) => {
        if (res.ok || res.status === 404) {
          window.localStorage.removeItem(PENDING_REFERRAL_KEY)
        }
        if (alive && res.ok) void fetchStats()
      })
      .catch(() => {/* ignore — non-critical */})
      .finally(() => { if (alive) setTracking(false) })

    return () => { alive = false }
  }, [fetchStats, wallet])

  // Build shareable referral link for this wallet once stats/code are loaded.
  useEffect(() => {
    if (!wallet || typeof window === "undefined") return
    const ref = referralCode || wallet
    setReferralLink(`${window.location.origin}/?ref=${encodeURIComponent(ref)}`)
  }, [referralCode, wallet])

  useEffect(() => {
    fetchStats()
  }, [fetchStats])

  return { stats, loading, tracking, referralCode, referralLink, applyReferralCode, refetch: fetchStats }
}
