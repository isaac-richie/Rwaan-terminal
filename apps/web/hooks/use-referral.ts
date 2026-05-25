"use client"

import { useEffect, useState, useCallback } from "react"

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000"

export type ReferralStats = {
  referrer: string
  totalReferrals: number
  rewardedReferrals: number
  pendingReferrals: number
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

  // Process incoming ?ref= param
  useEffect(() => {
    if (!wallet) return
    if (typeof window === "undefined") return

    const params = new URLSearchParams(window.location.search)
    const ref = params.get("ref")
    if (!ref || ref.toLowerCase() === wallet.toLowerCase()) return

    // Record referral (fire-and-forget, backend is idempotent)
    fetch(`${API_BASE}/referral/track`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ referrer: ref, referee: wallet }),
    }).catch(() => {/* ignore — non-critical */})

    // Clean the ref param from the URL without a full reload
    params.delete("ref")
    const newUrl = `${window.location.pathname}${params.toString() ? "?" + params.toString() : ""}`
    window.history.replaceState({}, "", newUrl)
  }, [wallet])

  // Build shareable referral link for this wallet
  useEffect(() => {
    if (!wallet || typeof window === "undefined") return
    setReferralLink(`${window.location.origin}/?ref=${wallet}`)
  }, [wallet])

  // Fetch referral stats
  const fetchStats = useCallback(async () => {
    if (!wallet) return
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/referral/stats/${wallet}`)
      if (!res.ok) return
      const data = await res.json() as ReferralStats & { ok: boolean }
      if (data.ok) {
        setStats({
          referrer: data.referrer,
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

  useEffect(() => {
    fetchStats()
  }, [fetchStats])

  return { stats, loading, referralLink, refetch: fetchStats }
}
