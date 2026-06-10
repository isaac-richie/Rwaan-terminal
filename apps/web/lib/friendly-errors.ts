type FriendlyErrorContext = "general" | "trade" | "portfolio" | "funding" | "claim" | "analysis"

function objectCode(value: unknown): string {
  if (!value || typeof value !== "object") return ""
  const raw = value as Record<string, any>
  return String(raw.code ?? raw.error?.code ?? raw.data?.code ?? raw.info?.error?.code ?? raw.cause?.code ?? "")
}

export function extractErrorText(value: unknown, depth = 0): string | null {
  if (value === undefined || value === null || depth > 4) return null
  if (typeof value === "string") return value.trim() || null
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (value instanceof Error) return extractErrorText(value.message, depth + 1)
  if (Array.isArray(value)) {
    const parts = value.map((item) => extractErrorText(item, depth + 1)).filter(Boolean)
    return parts.length ? parts.join(" · ") : null
  }
  if (typeof value !== "object") return null

  const raw = value as Record<string, unknown>
  const directKeys = [
    "shortMessage",
    "message",
    "errorMsg",
    "error_msg",
    "reason",
    "details",
    "detail",
    "description",
    "statusText",
    "error",
  ]

  for (const key of directKeys) {
    const text = extractErrorText(raw[key], depth + 1)
    if (text) return text
  }

  for (const key of ["data", "body", "response", "result", "info", "cause"]) {
    const text = extractErrorText(raw[key], depth + 1)
    if (text) return text
  }

  return null
}

function rejectedWalletMessage(context: FriendlyErrorContext) {
  if (context === "claim") return "Claim rejected in wallet. No funds moved."
  if (context === "funding") return "Wallet request rejected. No funds moved."
  if (context === "analysis") return "Signature rejected in wallet. Analysis was not unlocked."
  return "Signature request rejected in wallet. No order was submitted."
}

function networkFallback(context: FriendlyErrorContext) {
  if (context === "portfolio") return "Rawli could not refresh portfolio data. Showing the latest available data while it retries."
  if (context === "analysis") return "Analysis service is taking too long. Try again in a moment."
  return "Connection timed out. Please try again in a moment."
}

function shouldHideRaw(raw: string) {
  const normalized = raw.toLowerCase()
  return (
    raw.includes("{") ||
    raw.includes("[object Object]") ||
    normalized.includes("jsonrpc") ||
    normalized.includes("payload") ||
    normalized.includes("signtypeddata") ||
    normalized.includes("eth_signtypeddata") ||
    normalized.includes("could not coalesce error")
  )
}

export function friendlyErrorMessage(
  err: unknown,
  fallback = "Something went wrong. Please try again.",
  context: FriendlyErrorContext = "general"
) {
  const raw = extractErrorText(err) ?? ""
  const normalized = raw.toLowerCase()
  const code = objectCode(err).toLowerCase()

  if (
    code === "4001" ||
    code === "action_rejected" ||
    normalized.includes("user rejected") ||
    normalized.includes("user-denied") ||
    normalized.includes("rejected by wallet") ||
    normalized.includes("reason=\"rejected\"")
  ) {
    return rejectedWalletMessage(context)
  }

  if (normalized.includes("duplicat")) {
    return "This order was already submitted. Sign a fresh order and try again."
  }

  if (normalized.includes("internal_error") || normalized.includes("request_error")) {
    if (context === "funding") return "Rawli could not complete that funding request. Refresh status and try again."
    if (context === "trade") return "Rawli could not prepare that trade. Refresh the market and try again."
    return fallback
  }

  if (normalized.includes("order submission failed") || normalized.includes("could not submit")) {
    return "We could not submit that order. Please check the amount and try again in a moment."
  }

  if (normalized.includes("unknown connector error") || normalized.includes("connector")) {
    return "Wallet connector could not complete the request. Reopen your wallet, approve the network/signature prompt, then try again."
  }

  if (
    normalized.includes("chainid should be same") ||
    normalized.includes("wrong network") ||
    normalized.includes("current chain") ||
    normalized.includes("network switch") ||
    normalized.includes("switch chain")
  ) {
    return "Rawli could not activate the required wallet network. Approve the network switch in your wallet, then try again."
  }

  if (normalized.includes("maker address not allowed") || normalized.includes("deposit wallet flow")) {
    return "Polymarket requires the deposit wallet for this trade. Prepare the trading session again, then retry."
  }

  if (
    normalized.includes("transfer amount exceeds balance") ||
    normalized.includes("insufficient funds") ||
    normalized.includes("insufficient balance") ||
    normalized.includes("not enough balance") ||
    normalized.includes("not enough funds")
  ) {
    return "Not enough spendable funds for this request. Add funds or lower the amount, then try again."
  }

  if (
    normalized.includes("insufficient shares") ||
    normalized.includes("not enough shares") ||
    normalized.includes("insufficient tokens") ||
    normalized.includes("not enough tokens")
  ) {
    return "Not enough tradable shares for this sell amount. Lower the amount or refresh the portfolio."
  }

  if (normalized.includes("allowance") || normalized.includes("approval")) {
    return "Trading approval is missing or expired. Approve trading access again, then retry."
  }

  if (normalized.includes("minimum") || normalized.includes("min size") || normalized.includes("too small") || normalized.includes("below min")) {
    return "That amount is below the exchange minimum. Increase the amount and try again."
  }

  if (normalized.includes("market") && (normalized.includes("not found") || normalized.includes("lookup failed") || normalized.includes("unavailable"))) {
    return "Rawli could not refresh this market from Polymarket. Wait a moment, then reopen the market."
  }

  if (normalized.includes("market") && (normalized.includes("closed") || normalized.includes("resolved"))) {
    return "This market is closed or settling, so new orders cannot be submitted."
  }

  if (
    normalized.includes("liquidity") ||
    normalized.includes("orderbook") ||
    normalized.includes("no match") ||
    normalized.includes("not matchable") ||
    normalized.includes("would not be filled")
  ) {
    return "Not enough liquidity at that price right now. Try a smaller order or a limit order."
  }

  if (normalized.includes("region") || normalized.includes("restricted") || normalized.includes("geoblock")) {
    return "Trading is not available for this wallet or region right now."
  }

  if (normalized.includes("signature") || normalized.includes("signer")) {
    return "The signature could not be verified. Refresh, reconnect the wallet, and sign a fresh request."
  }

  if (normalized.includes("timeout") || normalized.includes("timed out") || normalized.includes("fetch failed") || normalized.includes("failed to fetch")) {
    return networkFallback(context)
  }

  if (normalized.includes("execution reverted") || normalized.includes("reverted")) {
    return "The blockchain rejected this transaction. Check the amount, balance, and approvals, then try again."
  }

  if (normalized.includes("invalid") || normalized.includes("bad request") || normalized.includes("400")) {
    return "The request was rejected. Refresh, sign a new request, and try again."
  }

  if (!raw || shouldHideRaw(raw)) return fallback

  return raw.length > 180 ? `${raw.slice(0, 180)}...` : raw
}
