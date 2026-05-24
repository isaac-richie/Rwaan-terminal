"use client"

export const RAWALI_ACCOUNT_REFRESH_EVENT = "rawali:account-refresh"

export type RawaliAccountRefreshDetail = {
  address?: string | null
  reason?: string
}

export function emitAccountRefresh(detail: RawaliAccountRefreshDetail = {}) {
  if (typeof window === "undefined") return
  window.dispatchEvent(
    new CustomEvent<RawaliAccountRefreshDetail>(RAWALI_ACCOUNT_REFRESH_EVENT, {
      detail,
    })
  )
}

export function scheduleAccountRefresh(
  detail: RawaliAccountRefreshDetail = {},
  delaysMs: number[] = [0, 2_500, 8_000]
) {
  if (typeof window === "undefined") return
  delaysMs.forEach((delayMs) => {
    window.setTimeout(() => emitAccountRefresh(detail), delayMs)
  })
}

export function addAccountRefreshListener(listener: (detail: RawaliAccountRefreshDetail) => void) {
  if (typeof window === "undefined") return () => {}

  const handler = (event: Event) => {
    listener((event as CustomEvent<RawaliAccountRefreshDetail>).detail ?? {})
  }

  window.addEventListener(RAWALI_ACCOUNT_REFRESH_EVENT, handler)
  return () => window.removeEventListener(RAWALI_ACCOUNT_REFRESH_EVENT, handler)
}
