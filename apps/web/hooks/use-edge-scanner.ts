"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { fetchEdges, type EdgeScanResult } from "@/lib/edge-scanner"

const CACHE_TTL_MS = 90_000   // 90s — matches API cache
const STALE_TTL_MS = 5 * 60_000

type CacheEntry = { data: EdgeScanResult; fetchedAt: number }
let cache: CacheEntry | null = null

export function useEdgeScanner(opts: { minEdge?: number; limit?: number } = {}) {
  const [data,      setData]      = useState<EdgeScanResult | null>(cache?.data ?? null)
  const [loading,   setLoading]   = useState(!cache)
  const [error,     setError]     = useState<string | null>(null)
  const fetchRef = useRef(false)

  const load = useCallback(async (quiet = false) => {
    if (fetchRef.current) return
    fetchRef.current = true
    if (!quiet) setLoading(true)
    setError(null)
    try {
      const result = await fetchEdges(opts)
      cache = { data: result, fetchedAt: Date.now() }
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Edge scan failed")
    } finally {
      setLoading(false)
      fetchRef.current = false
    }
  }, [opts.minEdge, opts.limit])  // eslint-disable-line

  useEffect(() => {
    if (!cache) { void load(); return }
    const age = Date.now() - cache.fetchedAt
    if (age < CACHE_TTL_MS) { setData(cache.data); setLoading(false); return }
    if (age < STALE_TTL_MS) { setData(cache.data); setLoading(false); void load(true); return }
    void load()
  }, [load])

  return { data, loading, error, refresh: () => load() }
}
