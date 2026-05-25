"use client"

export const RAWLI_ACCOUNT_REFRESH_EVENT = "rawli:account-refresh"

export type RawliAccountRefreshDetail = {
  address?: string | null
  reason?: string
}

export function emitAccountRefresh(detail: RawliAccountRefreshDetail = {}) {
  if (typeof window === "undefined") return
  window.dispatchEvent(
    new CustomEvent<RawliAccountRefreshDetail>(RAWLI_ACCOUNT_REFRESH_EVENT, {
      detail,
    })
  )
}

export function scheduleAccountRefresh(
  detail: RawliAccountRefreshDetail = {},
  delaysMs: number[] = [0, 2_500, 8_000]
) {
  if (typeof window === "undefined") return
  delaysMs.forEach((delayMs) => {
    window.setTimeout(() => emitAccountRefresh(detail), delayMs)
  })
}

export function addAccountRefreshListener(listener: (detail: RawliAccountRefreshDetail) => void) {
  if (typeof window === "undefined") return () => {}

  const handler = (event: Event) => {
    listener((event as CustomEvent<RawliAccountRefreshDetail>).detail ?? {})
  }

  window.addEventListener(RAWLI_ACCOUNT_REFRESH_EVENT, handler)
  return () => window.removeEventListener(RAWLI_ACCOUNT_REFRESH_EVENT, handler)
}
