"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000"
const PORTFOLIO_FRESH_MS = 30_000
const PORTFOLIO_STALE_MS = 5 * 60_000

export type PortfolioResponse = {
  address: string
  positions?: any[]
  closedPositions?: any[]
  value?: any
  trades?: any[]
  partial?: boolean
  warnings?: Array<{
    source: "positions" | "closedPositions" | "value" | "trades"
    error: string
  }>
}

type PortfolioCacheEntry = {
  value: PortfolioResponse
  lastUpdated: Date
  fetchedAt: number
}

type PortfolioHookOptions = {
  enabled?: boolean
  initialDelayMs?: number
}

const portfolioCache = new Map<string, PortfolioCacheEntry>()
const portfolioFlights = new Map<string, Promise<PortfolioCacheEntry>>()

function portfolioCacheKey(address: string) {
  return address.toLowerCase()
}

function getPortfolioCacheEntry(address?: string | null, maxAgeMs = PORTFOLIO_STALE_MS) {
  if (!address) return null
  const entry = portfolioCache.get(portfolioCacheKey(address))
  if (!entry) return null
  if (Date.now() - entry.fetchedAt > maxAgeMs) {
    portfolioCache.delete(portfolioCacheKey(address))
    return null
  }
  return entry
}

function parsePortfolioPayload(rawPayload: string) {
  if (!rawPayload) return {}
  try {
    return JSON.parse(rawPayload)
  } catch {
    return { error: rawPayload }
  }
}

async function fetchPortfolioEntry(address: string): Promise<PortfolioCacheEntry> {
  const key = portfolioCacheKey(address)
  const existing = portfolioFlights.get(key)
  if (existing) return existing

  const flight = (async () => {
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), 12_000)
    try {
      const res = await fetch(`${API_BASE}/portfolio/${address}`, {
        cache: "no-store",
        signal: controller.signal,
      })
      const payload = parsePortfolioPayload(await res.text())
      if (!res.ok) throw new Error(payload?.error ?? payload?.message ?? `Portfolio API returned ${res.status}`)
      const entry = {
        value: normalizePortfolioResponse(payload as PortfolioResponse),
        lastUpdated: new Date(),
        fetchedAt: Date.now(),
      }
      portfolioCache.set(key, entry)
      return entry
    } finally {
      window.clearTimeout(timeoutId)
      portfolioFlights.delete(key)
    }
  })()

  portfolioFlights.set(key, flight)
  return flight
}

export async function prefetchPolymarketPortfolio(address?: string | null) {
  if (!address) return null
  const cached = getPortfolioCacheEntry(address, PORTFOLIO_FRESH_MS)
  if (cached) return cached.value
  const entry = await fetchPortfolioEntry(address)
  return entry.value
}

function firstValueRecord(value: any) {
  if (Array.isArray(value)) return value[0] ?? {}
  return value ?? {}
}

function numericPortfolioValue(...values: any[]) {
  for (const value of values) {
    if (value === undefined || value === null || value === "") continue
    const numeric = Number(value)
    if (Number.isFinite(numeric)) return numeric
  }
  return 0
}

function normalizePortfolioPrice(value: any) {
  const numeric = numericPortfolioValue(value)
  if (!numeric) return 0
  return numeric > 1 ? numeric / 100 : numeric
}

function sumPortfolioValues(items: any[] | undefined, mapper: (item: any) => number) {
  return (items ?? []).reduce((total, item) => total + mapper(item), 0)
}

function normalizedText(value: any) {
  return typeof value === "string" ? value.trim().toLowerCase() : ""
}

function firstPositionDateValue(position: any) {
  return (
    position?.endDate ??
    position?.end_date ??
    position?.endDateIso ??
    position?.end_date_iso ??
    position?.marketEndDate ??
    position?.market_end_date ??
    position?.expiration ??
    position?.expiry ??
    position?.closedAt ??
    position?.closed_at ??
    position?.resolvedAt ??
    position?.resolved_at ??
    null
  )
}

function parsePositionTimestamp(value: any) {
  if (value === undefined || value === null || value === "") return null
  if (typeof value === "number" && Number.isFinite(value)) {
    const millis = value > 0 && value < 10_000_000_000 ? value * 1000 : value
    return Number.isFinite(millis) ? millis : null
  }
  if (typeof value === "string" && value.trim()) {
    const raw = value.trim()
    const numeric = Number(raw)
    if (Number.isFinite(numeric)) return parsePositionTimestamp(numeric)
    const parsed = Date.parse(raw)
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      return Number.isFinite(parsed) ? parsed + 24 * 60 * 60 * 1000 - 1 : null
    }
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

export function getPositionEndTime(position: any) {
  return parsePositionTimestamp(firstPositionDateValue(position))
}

export function isPositionExpired(position: any, now = Date.now()) {
  const endTime = getPositionEndTime(position)
  return endTime !== null && endTime <= now
}

export function isPortfolioPositionClosed(position: any, now = Date.now()) {
  if (!position) return false
  if (position.settled || position.resolved || position.closed || position.redeemed || position.redeemable) return true
  if (position.active === false || position.marketActive === false || position.market_active === false) return true
  if (position.archived === true || position.marketArchived === true || position.market_archived === true) return true
  if (position.resolution || position.winner || position.winningOutcome || position.winning_outcome) return true

  const status = normalizedText(position.status ?? position.marketStatus ?? position.market_status)
  if (/(closed|settled|resolved|redeemed|expired|cancelled|canceled|complete|completed|won|lost)/.test(status)) {
    return true
  }

  return isPositionExpired(position, now)
}

function positionIdentity(position: any) {
  const parts = [
    position?.asset,
    position?.assetId,
    position?.asset_id,
    position?.tokenId,
    position?.token_id,
    position?.conditionId,
    position?.condition_id,
    position?.marketId,
    position?.market_id,
    position?.marketSlug,
    position?.market_slug,
    position?.slug,
    position?.outcome,
    position?.outcomeIndex,
    position?.outcome_index,
  ]
    .filter((value) => value !== undefined && value !== null && value !== "")
    .map(String)

  return parts.length ? parts.join(":") : null
}

export function normalizePortfolioResponse(payload: PortfolioResponse, now = Date.now()): PortfolioResponse {
  const positions = payload.positions ?? []
  const closedPositions = payload.closedPositions ?? []
  const normalizedOpen: any[] = []
  const normalizedClosed = [...closedPositions]
  const closedKeys = new Set(closedPositions.map(positionIdentity).filter(Boolean) as string[])

  for (const position of positions) {
    if (!isPortfolioPositionClosed(position, now)) {
      normalizedOpen.push(position)
      continue
    }

    const key = positionIdentity(position)
    if (!key || !closedKeys.has(key)) {
      normalizedClosed.push(position)
      if (key) closedKeys.add(key)
    }
  }

  return {
    ...payload,
    positions: normalizedOpen,
    closedPositions: normalizedClosed,
  }
}

export function formatPortfolioNumber(value: any) {
  if (value === undefined || value === null) return "—"
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return String(value)
  return numeric.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export function formatPortfolioMoney(value: any) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return "—"
  const prefix = numeric < 0 ? "-$" : "$"
  return `${prefix}${Math.abs(numeric).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

export function formatPortfolioPnl(value: any) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return "—"
  const prefix = numeric > 0 ? "+" : numeric < 0 ? "-" : ""
  return `${prefix}$${Math.abs(numeric).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

export function getPositionValue(position: any) {
  const size = numericPortfolioValue(position?.size, position?.position_size)
  const currentPrice = normalizePortfolioPrice(position?.curPrice ?? position?.cur_price ?? position?.current_price ?? position?.price)
  return numericPortfolioValue(position?.currentValue, position?.current_value, position?.value, size && currentPrice ? size * currentPrice : 0)
}

export function getPositionCostBasis(position: any) {
  const size = numericPortfolioValue(position?.size, position?.position_size)
  const avgPrice = normalizePortfolioPrice(position?.avgPrice ?? position?.avg_entry_price ?? position?.entry_price)
  return numericPortfolioValue(size && avgPrice ? size * avgPrice : 0, position?.initialValue, position?.initial_value, position?.costBasis, position?.cost_basis)
}

export function getPositionPnl(position: any) {
  const size = numericPortfolioValue(position?.size, position?.position_size)
  const avgPrice = normalizePortfolioPrice(position?.avgPrice ?? position?.avg_entry_price ?? position?.entry_price)
  const currentPrice = normalizePortfolioPrice(position?.curPrice ?? position?.cur_price ?? position?.current_price ?? position?.price)
  const value = getPositionValue(position)
  const costBasis = getPositionCostBasis(position)
  const pricePnl = size && currentPrice && avgPrice ? size * (currentPrice - avgPrice) : 0
  const valuePnl = value && costBasis ? value - costBasis : 0
  const apiPnl = numericPortfolioValue(
    position?.cashPnl,
    position?.cash_pnl,
    position?.unrealizedPnl,
    position?.unrealized_pnl,
    position?.totalPnl,
    position?.total_pnl,
    position?.pnl
  )
  return pricePnl || valuePnl || apiPnl
}

export function getPositionPnlPercent(position: any) {
  const pnl = getPositionPnl(position)
  const costBasis = getPositionCostBasis(position)
  if (costBasis) return (pnl / costBasis) * 100
  const apiPercent = numericPortfolioValue(position?.percentPnl, position?.percent_pnl, position?.pnlPercent, position?.pnl_percent)
  return Math.abs(apiPercent) <= 2 ? apiPercent * 100 : apiPercent
}

export function usePolymarketPortfolio(address?: string | null, pollingMs?: number, options: PortfolioHookOptions = {}) {
  const [data, setData] = useState<PortfolioResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const dataRef = useRef<PortfolioResponse | null>(null)
  const enabled = options.enabled ?? true
  const initialDelayMs = options.initialDelayMs ?? 0

  const applyEntry = useCallback((entry: PortfolioCacheEntry) => {
    dataRef.current = entry.value
    setData(entry.value)
    setLastUpdated(entry.lastUpdated)
    setError(entry.value.partial ? "Some portfolio details are still syncing. Showing the latest available data." : null)
  }, [])

  const refresh = useCallback(async () => {
    if (!enabled || !address) {
      dataRef.current = null
      setData(null)
      setError(null)
      return
    }

    setLoading(true)
    setError(null)
    try {
      applyEntry(await fetchPortfolioEntry(address))
    } catch (err: any) {
      const hadData = Boolean(dataRef.current)
      if (!hadData) setData(null)
      setError(
        hadData
          ? "Portfolio connection dipped. Showing the last synced data while Rawli retries."
          : err?.name === "AbortError"
            ? "Portfolio load timed out. Pull to refresh or try again in a moment."
            : err?.message ?? "Portfolio load failed"
      )
    } finally {
      setLoading(false)
    }
  }, [address, applyEntry, enabled])

  useEffect(() => {
    if (!enabled || !address) {
      dataRef.current = null
      setData(null)
      setError(null)
      setLastUpdated(null)
      return
    }

    const cached = getPortfolioCacheEntry(address)
    if (cached) {
      applyEntry(cached)
      if (Date.now() - cached.fetchedAt < PORTFOLIO_FRESH_MS) return
    }

    const timer = window.setTimeout(() => {
      const fresh = getPortfolioCacheEntry(address, PORTFOLIO_FRESH_MS)
      if (fresh) {
        applyEntry(fresh)
        return
      }
      void refresh()
    }, initialDelayMs)

    return () => window.clearTimeout(timer)
  }, [address, applyEntry, enabled, initialDelayMs, refresh])

  useEffect(() => {
    if (!enabled || !pollingMs || !address) return
    const id = setInterval(() => void refresh(), pollingMs)
    return () => clearInterval(id)
  }, [address, enabled, pollingMs, refresh])

  const summary = useMemo(() => {
    const value = firstValueRecord(data?.value)
    const openValue = sumPortfolioValues(data?.positions, getPositionValue)
    const unrealizedRaw = numericPortfolioValue(
      value.unrealizedPnl,
      value.unrealized_pnl,
      value.cashPnl,
      value.cash_pnl,
      value.pnl,
      sumPortfolioValues(data?.positions, getPositionPnl)
    )
    const realizedRaw = numericPortfolioValue(
      value.realizedPnl,
      value.realized_pnl,
      sumPortfolioValues(data?.closedPositions, (position) =>
        numericPortfolioValue(position?.realizedPnl, position?.realized_pnl, position?.cashPnl, position?.cash_pnl, position?.pnl)
      )
    )
    const totalRaw = numericPortfolioValue(value.total, value.usdc, value.balance, value.value, value.currentValue, openValue)

    return {
      total: formatPortfolioNumber(totalRaw),
      totalMoney: formatPortfolioMoney(totalRaw),
      unrealized: formatPortfolioPnl(unrealizedRaw),
      realized: formatPortfolioPnl(realizedRaw),
      totalRaw,
      unrealizedRaw,
      realizedRaw,
    }
  }, [data])

  return { data, loading, error, summary, refresh, lastUpdated }
}
