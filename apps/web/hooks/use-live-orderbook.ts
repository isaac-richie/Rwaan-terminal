"use client"

import { useEffect, useMemo, useState } from "react"

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000"

type OrderbookLevel = {
  price: number
  size: number
}

export type LiveOrderbook = {
  bids: OrderbookLevel[]
  asks: OrderbookLevel[]
  bestBid: number | null
  bestAsk: number | null
  updatedAt: number | null
}

type LiveOrderbooksState = {
  books: Record<string, LiveOrderbook>
  status: "idle" | "connecting" | "live" | "error"
}

function emptyBook(): LiveOrderbook {
  return { bids: [], asks: [], bestBid: null, bestAsk: null, updatedAt: null }
}

function parseNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function parseLevels(raw: unknown, side: "bids" | "asks") {
  if (!Array.isArray(raw)) return []
  const levels = raw
    .map((entry) => {
      if (Array.isArray(entry)) {
        const price = parseNumber(entry[0])
        const size = parseNumber(entry[1])
        return price && size ? { price, size } : null
      }
      if (entry && typeof entry === "object") {
        const value = entry as Record<string, unknown>
        const price = parseNumber(value.price ?? value.p)
        const size = parseNumber(value.size ?? value.s)
        return price && size ? { price, size } : null
      }
      return null
    })
    .filter(Boolean) as OrderbookLevel[]

  return levels.sort((a, b) => side === "bids" ? b.price - a.price : a.price - b.price).slice(0, 24)
}

function bookFromPayload(payload: Record<string, unknown>, previous?: LiveOrderbook): LiveOrderbook | null {
  const bids = parseLevels(payload.bids, "bids")
  const asks = parseLevels(payload.asks, "asks")
  if (!bids.length && !asks.length) return null

  const nextBids = bids.length ? bids : previous?.bids ?? []
  const nextAsks = asks.length ? asks : previous?.asks ?? []
  return {
    bids: nextBids,
    asks: nextAsks,
    bestBid: nextBids[0]?.price ?? previous?.bestBid ?? null,
    bestAsk: nextAsks[0]?.price ?? previous?.bestAsk ?? null,
    updatedAt: Date.now(),
  }
}

function wsUrl(tokenIds: string[]) {
  const base = API_BASE.replace(/^http/i, (match) => (match === "https" ? "wss" : "ws"))
  const url = new URL(`${base}/ws/orderbook`)
  url.searchParams.set("token_ids", tokenIds.join(","))
  return url.toString()
}

function assetIdFromPayload(payload: Record<string, unknown>) {
  const raw = payload.asset_id ?? payload.assetId ?? payload.token_id ?? payload.tokenId
  return raw ? String(raw) : null
}

function normalizeMessages(raw: MessageEvent<string>) {
  try {
    const parsed = JSON.parse(raw.data)
    return Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    return []
  }
}

function applyPriceChange(previous: LiveOrderbook | undefined, change: Record<string, unknown>) {
  const bestBid = parseNumber(change.best_bid ?? change.bestBid ?? change.bid) ?? previous?.bestBid ?? null
  const bestAsk = parseNumber(change.best_ask ?? change.bestAsk ?? change.ask) ?? previous?.bestAsk ?? null

  if (!bestBid && !bestAsk) return previous ?? emptyBook()
  return {
    ...(previous ?? emptyBook()),
    bestBid,
    bestAsk,
    updatedAt: Date.now(),
  }
}

export function useLiveOrderbooks(tokenIds: string[] | undefined) {
  const stableTokenIds = useMemo(
    () => Array.from(new Set((tokenIds ?? []).filter(Boolean).map(String))),
    [tokenIds?.join("|")]
  )
  const [state, setState] = useState<LiveOrderbooksState>({ books: {}, status: "idle" })

  useEffect(() => {
    if (!stableTokenIds.length) {
      setState({ books: {}, status: "idle" })
      return
    }

    let active = true
    setState((prev) => ({ ...prev, status: "connecting" }))

    const loadInitialBooks = async () => {
      const entries = await Promise.allSettled(
        stableTokenIds.map(async (tokenId) => {
          const url = new URL(`${API_BASE}/clob/book`)
          url.searchParams.set("token_id", tokenId)
          const res = await fetch(url.toString())
          if (!res.ok) throw new Error("book failed")
          const body = await res.json()
          const book = bookFromPayload(body as Record<string, unknown>)
          return [tokenId, book ?? emptyBook()] as const
        })
      )
      if (!active) return
      setState((prev) => {
        const books = { ...prev.books }
        for (const entry of entries) {
          if (entry.status === "fulfilled") books[entry.value[0]] = entry.value[1]
        }
        return { books, status: prev.status }
      })
    }

    void loadInitialBooks()

    const socket = new WebSocket(wsUrl(stableTokenIds))

    socket.onopen = () => {
      if (active) setState((prev) => ({ ...prev, status: "live" }))
    }

    socket.onmessage = (message) => {
      const messages = normalizeMessages(message)
      if (!messages.length) return

      setState((prev) => {
        const books = { ...prev.books }
        for (const payload of messages) {
          if (!payload || typeof payload !== "object") continue
          const record = payload as Record<string, unknown>
          const assetId = assetIdFromPayload(record)
          if (assetId) {
            const fullBook = bookFromPayload(record, books[assetId])
            books[assetId] = fullBook ?? applyPriceChange(books[assetId], record)
          }

          const changes = Array.isArray(record.changes) ? record.changes : []
          for (const rawChange of changes) {
            if (!rawChange || typeof rawChange !== "object") continue
            const change = rawChange as Record<string, unknown>
            const changeAssetId = assetIdFromPayload(change)
            if (!changeAssetId) continue
            books[changeAssetId] = applyPriceChange(books[changeAssetId], change)
          }
        }
        return { books, status: "live" }
      })
    }

    socket.onerror = () => {
      if (active) setState((prev) => ({ ...prev, status: "error" }))
    }

    socket.onclose = () => {
      if (active) setState((prev) => ({ ...prev, status: prev.status === "error" ? "error" : "idle" }))
    }

    return () => {
      active = false
      socket.close()
    }
  }, [stableTokenIds.join("|")])

  return state
}
