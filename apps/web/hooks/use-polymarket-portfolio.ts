"use client"

import { useEffect, useMemo, useState } from "react"

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000"

export type PortfolioResponse = {
  address: string
  positions?: any[]
  closedPositions?: any[]
  value?: any
  trades?: any[]
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

export function usePolymarketPortfolio(address?: string | null, pollingMs?: number) {
  const [data, setData] = useState<PortfolioResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const refresh = async () => {
    if (!address) {
      setData(null)
      setError(null)
      return
    }

    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/portfolio/${address}`)
      const payload = await res.json()
      if (!res.ok) throw new Error(payload?.error ?? "Failed to load portfolio")
      setData(payload as PortfolioResponse)
      setLastUpdated(new Date())
    } catch (err: any) {
      setData(null)
      setError(err?.message ?? "Portfolio load failed")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address])

  useEffect(() => {
    if (!pollingMs || !address) return
    const id = setInterval(() => void refresh(), pollingMs)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, pollingMs])

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
