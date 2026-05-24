"use client"

import { useEffect, useState } from "react"

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000"

type GeoblockState = {
  /** true = user is in a restricted region */
  blocked: boolean
  /** null while loading, string on error */
  error: string | null
  loading: boolean
}

let _cached: { blocked: boolean; ts: number } | null = null
const CACHE_TTL_MS = 10 * 60 * 1000 // 10 minutes — recheck after tab is idle

export function useGeoblock(): GeoblockState {
  const [blocked, setBlocked] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Use cached result if recent
    if (_cached && Date.now() - _cached.ts < CACHE_TTL_MS) {
      setBlocked(_cached.blocked)
      setLoading(false)
      return
    }

    // Client-side check via our API proxy — the server passes the request through
    // to Polymarket so the check reflects the *user's* IP (when using edge/CDN).
    fetch(`${API_BASE}/geoblock`, { method: "GET" })
      .then((res) => res.json())
      .then((data) => {
        // Polymarket returns { isRestricted: bool } or { blocked: bool }
        const isBlocked = Boolean(data?.isRestricted ?? data?.blocked ?? false)
        _cached = { blocked: isBlocked, ts: Date.now() }
        setBlocked(isBlocked)
      })
      .catch(() => {
        // On network failure, fail open — don't block legitimate users
        setError("Geo check unavailable")
        setBlocked(false)
      })
      .finally(() => setLoading(false))
  }, [])

  return { blocked, error, loading }
}
