"use client"

import { Fuel, Loader2, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useGasAssist } from "@/hooks/use-gas-assist"
import { cn } from "@/lib/utils"

type GasAssistButtonProps = {
  address?: string | null
  active?: boolean
  reason: string
  onAssisted?: () => Promise<void> | void
  className?: string
}

function reasonMessage(reason?: string) {
  switch (reason) {
    case "disabled":
      return "Polygon gas assist is not enabled on this API."
    case "relayer_not_configured":
      return "Polygon gas assist needs a relayer key in the API environment."
    case "insufficient_pusd":
      return "Gas assist unlocks after this wallet has pUSD."
    case "pol_balance_sufficient":
      return "This wallet already has enough POL for Polygon transactions."
    case "rate_limited":
      return "Gas assist was already sent recently."
    case "relayer_underfunded":
      return "Gas assist relayer needs more POL."
    default:
      return null
  }
}

export function GasAssistButton({ address, active = true, reason, onAssisted, className }: GasAssistButtonProps) {
  const gasAssist = useGasAssist(address, active && Boolean(address))
  const status = gasAssist.status
  const message = gasAssist.error ?? reasonMessage(status?.reason)

  if (!address || !active) return null

  if (gasAssist.loading && !status) {
    return (
      <div className={cn("flex items-center gap-2 rounded-lg border border-[oklch(0.22_0.015_255)] bg-[oklch(0.16_0.014_255)] p-2.5 text-[11px] text-muted-foreground", className)}>
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Checking Polygon gas...
      </div>
    )
  }

  if (!status?.eligible) {
    if (!message) return null
    return (
      <div className={cn("flex items-start gap-2 rounded-lg border border-[oklch(0.22_0.015_255)] bg-[oklch(0.145_0.014_255)] p-2.5 text-[11px] leading-snug text-muted-foreground", className)}>
        <Fuel className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[oklch(0.78_0.16_82)]" />
        <span>{message}</span>
        <button
          type="button"
          onClick={() => gasAssist.refresh()}
          disabled={gasAssist.loading}
          className="ml-auto shrink-0 text-muted-foreground hover:text-foreground disabled:opacity-50"
          aria-label="Refresh Polygon gas assist"
        >
          <RefreshCw className={cn("h-3 w-3", gasAssist.loading && "animate-spin")} />
        </button>
      </div>
    )
  }

  return (
    <div className={cn("space-y-2", className)}>
      <div className="rounded-lg border border-[oklch(0.78_0.16_82/0.25)] bg-[oklch(0.78_0.16_82/0.08)] p-2.5 text-[11px] leading-snug text-[oklch(0.78_0.16_82)]">
        This wallet has pUSD but low Polygon gas. Rawli can send {status.topupPol} POL for approval or withdrawal.
      </div>
      <Button
        type="button"
        onClick={async () => {
          const result = await gasAssist.requestAssist(reason)
          if (result?.recentTxHash || result?.txHash) await onAssisted?.()
        }}
        disabled={gasAssist.requesting}
        className="h-9 w-full gap-2 border border-[oklch(0.78_0.16_82/0.35)] bg-[oklch(0.78_0.16_82/0.1)] text-[oklch(0.78_0.16_82)] hover:bg-[oklch(0.78_0.16_82/0.16)] text-xs font-semibold"
      >
        {gasAssist.requesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Fuel className="h-3.5 w-3.5" />}
        {gasAssist.requesting ? "Sending POL..." : "Get Polygon Gas Assist"}
      </Button>
      {gasAssist.error ? (
        <p className="text-[11px] leading-snug text-[oklch(0.74_0.14_25)]">{gasAssist.error}</p>
      ) : null}
    </div>
  )
}
