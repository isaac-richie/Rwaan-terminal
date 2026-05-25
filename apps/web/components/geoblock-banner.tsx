"use client"

import { ShieldAlert } from "lucide-react"
import { useGeoblock } from "@/hooks/use-geoblock"

/**
 * Renders a full-page restriction notice when Polymarket's geoblock API
 * identifies the user's region as restricted. Renders nothing while loading
 * or if the user is not blocked.
 */
export function GeoblockBanner() {
  const { blocked, loading } = useGeoblock()

  if (loading || !blocked) return null

  return (
    <div className="fixed inset-0 z-[999] bg-background/95 backdrop-blur-sm flex items-center justify-center px-4">
      <div className="surface-card rounded-2xl p-8 max-w-md w-full flex flex-col items-center gap-5 text-center">
        <div className="w-14 h-14 rounded-2xl bg-[oklch(0.58_0.2_25/0.12)] border border-[oklch(0.58_0.2_25/0.3)] flex items-center justify-center">
          <ShieldAlert className="w-7 h-7 text-[oklch(0.62_0.18_25)]" />
        </div>

        <div>
          <h1 className="text-xl font-bold text-foreground">Region not supported</h1>
          <p className="text-sm text-muted-foreground mt-3 leading-relaxed">
            Polymarket prediction markets are not available in your region due to local
            regulations. Rawli routes all trades through the Polymarket CLOB and must
            respect the same restrictions.
          </p>
        </div>

        <div className="w-full rounded-xl border border-[oklch(0.22_0.015_255)] bg-[oklch(0.14_0.013_255)] p-3 text-left space-y-1.5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Restricted regions include</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            United States, United Kingdom, and other jurisdictions where prediction market
            trading is restricted by applicable law.
          </p>
        </div>

        <p className="text-[11px] text-muted-foreground/60">
          If you believe this is an error, check your network connection or VPN settings.
        </p>
      </div>
    </div>
  )
}
