"use client"

/**
 * useStockHoldings
 *
 * Reads BNB-chain stock token balances directly from the wallet using
 * multicall-style sequential balanceOf reads, then pairs them with live
 * quote data to produce value + day P&L.
 *
 * Because stock tokens live on BNB Chain we call the public BSC RPC
 * directly — no API server round-trip needed.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import type { ConnectedWallet } from "@privy-io/react-auth"
import { fetchRwaAssets, fetchRwaQuotes, type RwaAsset, type RwaQuote } from "@/lib/rwa"

// ─── Public BSC RPCs (fallback chain) ────────────────────────────────────────
const BSC_RPCS = [
  "https://bsc-dataseed.binance.org",
  "https://bsc.publicnode.com",
  "https://bsc-dataseed1.ninicoin.io",
]

// ERC-20 balanceOf selector: 0x70a08231
const BALANCE_OF_SELECTOR = "0x70a08231"

// Standard ERC-20 decimals are 18, but Ondo tokens may differ
const DEFAULT_DECIMALS = 18

type RpcProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
}

export type StockHolding = {
  asset: RwaAsset
  quote: RwaQuote | null
  /** Raw token balance as bigint */
  balanceRaw: bigint
  /** Human-readable balance (e.g. 0.5 shares) */
  balance: number
  /** Current value in USD */
  value: number
  /** Day P&L in USD (based on previousClose vs price) */
  dayPnl: number
  /** Day P&L as a percentage */
  dayPnlPct: number
  /** Whether the price moved up today */
  isUp: boolean
}

export type StockHoldingsState = {
  holdings: StockHolding[]
  totalValue: number
  totalDayPnl: number
  totalDayPnlPct: number
  loading: boolean
  error: string | null
  refresh: () => void
  lastUpdated: Date | null
}

// ─── Low-level helpers ────────────────────────────────────────────────────────

function padAddress(address: string): string {
  // Pad address to 32 bytes (64 hex chars) for ABI encoding
  return address.slice(2).toLowerCase().padStart(64, "0")
}

async function readBalanceViaRpc(
  tokenAddress: string,
  walletAddress: string,
  provider: RpcProvider | null
): Promise<bigint> {
  const data = BALANCE_OF_SELECTOR + padAddress(walletAddress)

  // Try wallet provider first (it's already connected to BSC if user is on stocks)
  if (provider) {
    try {
      const result = await provider.request({
        method: "eth_call",
        params: [{ to: tokenAddress, data }, "latest"],
      }) as string
      if (result && result !== "0x") return BigInt(result)
    } catch {
      // Fall through to public RPC
    }
  }

  // Fallback: public BSC RPC
  for (const rpc of BSC_RPCS) {
    try {
      const resp = await fetch(rpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_call",
          params: [{ to: tokenAddress, data }, "latest"],
        }),
        signal: AbortSignal.timeout(5000),
      })
      const json = await resp.json() as { result?: string; error?: unknown }
      if (json.result && json.result !== "0x") return BigInt(json.result)
      if (json.result === "0x" || json.result === "0x0") return 0n
    } catch {
      continue
    }
  }

  return 0n
}

function rawToDecimal(raw: bigint, decimals: number): number {
  if (raw === 0n) return 0
  const divisor = BigInt(10 ** decimals)
  const whole = raw / divisor
  const frac = raw % divisor
  return Number(whole) + Number(frac) / 10 ** decimals
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useStockHoldings(
  wallet: ConnectedWallet | null,
  walletAddress: string | null
): StockHoldingsState {
  const [holdings, setHoldings] = useState<StockHolding[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const cancelRef = useRef(false)

  const load = useCallback(async () => {
    if (!walletAddress) return

    cancelRef.current = false
    setLoading(true)
    setError(null)

    try {
      // 1. Fetch asset catalog (hits module-level cache from home pre-fetch)
      const catalog = await fetchRwaAssets("NG")
      const assets = catalog.assets.filter(
        (a) => a.route?.token.address && a.route.token.address !== "0x0000000000000000000000000000000000000000"
      )

      if (cancelRef.current) return

      // 2. Get BNB provider from wallet (best effort)
      let provider: RpcProvider | null = null
      if (wallet) {
        try {
          provider = await wallet.getEthereumProvider() as RpcProvider
        } catch {
          // Use public RPC fallback
        }
      }

      // 3. Read balances for all assets with a token address
      //    Run in parallel batches of 8 to avoid overwhelming the RPC
      const BATCH = 8
      const balances = new Map<string, bigint>()

      for (let i = 0; i < assets.length; i += BATCH) {
        if (cancelRef.current) return
        const batch = assets.slice(i, i + BATCH)
        const results = await Promise.allSettled(
          batch.map((asset) =>
            readBalanceViaRpc(
              asset.route!.token.address!,
              walletAddress,
              provider
            )
          )
        )
        batch.forEach((asset, idx) => {
          const r = results[idx]
          balances.set(asset.id, r.status === "fulfilled" ? r.value : 0n)
        })
      }

      if (cancelRef.current) return

      // 4. Filter to assets user actually holds
      const heldAssets = assets.filter((a) => {
        const bal = balances.get(a.id) ?? 0n
        return bal > 0n
      })

      // 5. Fetch current quotes for held assets
      let quotes: Record<string, RwaQuote> = {}
      if (heldAssets.length > 0) {
        try {
          quotes = await fetchRwaQuotes(heldAssets.map((a) => a.quoteSymbol))
        } catch {
          // Continue without quotes — show balance only
        }
      }

      if (cancelRef.current) return

      // 6. Build holdings with P&L
      const result: StockHolding[] = heldAssets.map((asset) => {
        const rawBal = balances.get(asset.id) ?? 0n
        const decimals = asset.route?.token.decimals ?? DEFAULT_DECIMALS
        const balance = rawToDecimal(rawBal, decimals)
        const quote = quotes[asset.quoteSymbol] ?? null

        const price = quote?.price ?? 0
        const prevClose = quote?.previousClose ?? price
        const value = balance * price
        const dayPnl = balance * (price - prevClose)
        const dayPnlPct = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0

        return {
          asset,
          quote,
          balanceRaw: rawBal,
          balance,
          value,
          dayPnl,
          dayPnlPct,
          isUp: price >= prevClose,
        }
      }).sort((a, b) => b.value - a.value) // biggest holding first

      setHoldings(result)
      setLastUpdated(new Date())
    } catch (err) {
      if (!cancelRef.current) {
        setError("Could not load stock holdings. Check your connection and try again.")
        console.error("[rawli] Stock holdings load failed:", err)
      }
    } finally {
      if (!cancelRef.current) setLoading(false)
    }
  }, [wallet, walletAddress])

  // Load on mount and when wallet changes
  useEffect(() => {
    void load()
    return () => { cancelRef.current = true }
  }, [load])

  // Aggregate totals
  const totalValue = holdings.reduce((s, h) => s + h.value, 0)
  const totalDayPnl = holdings.reduce((s, h) => s + h.dayPnl, 0)
  const totalDayPnlPct = totalValue - totalDayPnl > 0
    ? (totalDayPnl / (totalValue - totalDayPnl)) * 100
    : 0

  return {
    holdings,
    totalValue,
    totalDayPnl,
    totalDayPnlPct,
    loading,
    error,
    refresh: load,
    lastUpdated,
  }
}
