"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter, usePathname } from "next/navigation"
import {
  ChevronDown, Copy, Menu, Search, Wallet, X, Briefcase,
  TrendingUp, ArrowUpRight, Activity, Award, Bell, CircleDollarSign
} from "lucide-react"
import { usePrivy } from "@privy-io/react-auth"
import { BnbFundingModal } from "@/components/funding/bnb-funding-modal"
import {
  formatPortfolioMoney,
  formatPortfolioPnl,
  getPositionValue,
  usePolymarketPortfolio,
} from "@/hooks/use-polymarket-portfolio"
import { usePolymarketDepositWallet } from "@/hooks/use-polymarket-deposit-wallet"
import { useActivePrivyWallet } from "@/hooks/use-active-privy-wallet"
import { useTradeReadiness } from "@/hooks/use-trade-readiness"
import { useTradingProfile } from "@/hooks/use-trading-profile"
import { addAccountRefreshListener } from "@/lib/account-events"
import { cacheMarketForDetail } from "@/lib/market-detail-cache"
import { fetchMarkets } from "@/lib/markets"
import type { PolymarketMarket } from "@/lib/polymarket"
import { cn } from "@/lib/utils"

function getYesPrice(market: PolymarketMarket) {
  const yes = market.outcomes?.find((o) => o.name.toLowerCase().includes("yes"))?.price
  const fallback = market.outcomes?.[0]?.price
  return typeof yes === "number" ? yes : typeof fallback === "number" ? fallback : 50
}

// Wallet avatar gradient from address
function walletGradient(addr: string) {
  const seed = parseInt(addr.slice(2, 8), 16)
  const h1 = seed % 360
  const h2 = (seed * 137 + 60) % 360
  return `linear-gradient(135deg, oklch(0.55 0.18 ${h1}), oklch(0.45 0.16 ${h2}))`
}

function numericValue(...values: any[]) {
  for (const value of values) {
    if (Array.isArray(value)) {
      const nested = numericValue(...value)
      if (nested !== 0) return nested
      continue
    }
    if (value === undefined || value === null || value === "") continue
    const numeric = Number(value)
    if (Number.isFinite(numeric)) return numeric
  }
  return 0
}

function firstValueRecord(value: any) {
  if (Array.isArray(value)) return value[0] ?? {}
  return value ?? {}
}

const PUSD_DECIMALS = 6

function collateralAmount(raw?: string | null) {
  if (!raw) return 0
  const trimmed = String(raw).trim()
  const value = Number(trimmed)
  if (!Number.isFinite(value)) return 0
  if (trimmed.includes(".")) return value
  return Math.abs(value) >= 1_000 ? value / 10 ** PUSD_DECIMALS : value
}

function formatPusd(value?: number | null) {
  if (value === undefined || value === null || !Number.isFinite(value)) return "—"
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: value >= 100 ? 2 : 4,
    maximumFractionDigits: value >= 100 ? 2 : 4,
  })}`
}

function NavbarBalanceBreakdown() {
  const [open, setOpen] = useState(false)
  const [fundingOpen, setFundingOpen] = useState(false)
  const [fundingInitialTab, setFundingInitialTab] = useState<"deposit" | "withdraw">("deposit")
  const panelRef = useRef<HTMLDivElement>(null)
  const { walletAddress, wallet: connectedWallet } = useActivePrivyWallet()
  const polymarketDepositWallet = usePolymarketDepositWallet(connectedWallet)
  const profileConnectedWalletAddress = walletAddress ?? null
  const tradingProfile = useTradingProfile(
    profileConnectedWalletAddress,
    polymarketDepositWallet.address,
    polymarketDepositWallet.address ? "deposit" : undefined
  )
  const tradingWalletAddress = tradingProfile.profile?.tradingWalletAddress ?? null
  const portfolio = usePolymarketPortfolio(tradingWalletAddress)
  const readiness = useTradeReadiness({
    connectedWalletAddress: walletAddress,
    profile: tradingProfile.profile,
  })
  const positions = portfolio.data?.positions ?? []
  const valueRecord = firstValueRecord(portfolio.data?.value)
  const inPositions = positions.reduce((total: number, position: any) => total + getPositionValue(position), 0)
  const collateral = readiness.readiness?.collateral ?? null
  const pUsdBalance = collateral ? collateralAmount(collateral.balance) : null
  const pUsdAllowance = collateral ? collateralAmount(collateral.allowance) : null
  const spendablePusd = pUsdBalance === null || pUsdAllowance === null ? null : Math.min(pUsdBalance, pUsdAllowance)
  const accountValue = (pUsdBalance ?? 0) + inPositions
  const refreshRef = useRef({
    portfolioRefresh: portfolio.refresh,
    readinessRefresh: readiness.refresh,
    tradingWalletAddress,
  })
  const availableToTrade = numericValue(
    spendablePusd,
    valueRecord.availableBalance,
    valueRecord.available_balance,
    valueRecord.available,
    valueRecord.cash,
    Math.max(accountValue - inPositions, 0)
  )
  const realized = portfolio.summary.realizedRaw
  const realizedPositive = realized >= 0
  const openFundingModal = (tab: "deposit" | "withdraw" = pUsdBalance && pUsdBalance > 0 ? "withdraw" : "deposit") => {
    setFundingInitialTab(tab)
    setFundingOpen(true)
  }

  useEffect(() => {
    refreshRef.current = {
      portfolioRefresh: portfolio.refresh,
      readinessRefresh: readiness.refresh,
      tradingWalletAddress,
    }
  })

  useEffect(() => {
    return addAccountRefreshListener((detail) => {
      const current = refreshRef.current
      if (
        detail.address &&
        current.tradingWalletAddress &&
        detail.address.toLowerCase() !== current.tradingWalletAddress.toLowerCase()
      ) {
        return
      }
      void current.portfolioRefresh()
      void current.readinessRefresh()
    })
  }, [])

  useEffect(() => {
    if (!open) return
    const onClick = (event: MouseEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener("mousedown", onClick)
    return () => window.removeEventListener("mousedown", onClick)
  }, [open])

  return (
    <div className="relative hidden md:block" ref={panelRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "flex h-9 items-center gap-2 rounded-xl border border-[oklch(0.22_0.015_255/0.7)] bg-[oklch(0.155_0.014_255/0.9)] px-3 text-xs font-bold text-foreground transition-all hover:border-[oklch(0.78_0.16_82/0.35)] hover:bg-[oklch(0.18_0.014_255)]",
          open && "border-[oklch(0.78_0.16_82/0.40)] bg-[oklch(0.18_0.014_255)]"
        )}
        aria-expanded={open}
        aria-label="Open balance breakdown"
      >
        <CircleDollarSign className="h-4 w-4 text-[oklch(0.78_0.16_82)]" />
        <span>{portfolio.loading || readiness.loading ? "Syncing" : formatPortfolioMoney(accountValue)}</span>
        <ChevronDown className={cn("h-3 w-3 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>

      {open ? (
        <div className="absolute right-0 mt-2 w-[min(292px,calc(100vw-1rem))] overflow-hidden rounded-2xl border border-[oklch(0.26_0.016_255/0.7)] bg-[oklch(0.16_0.014_255/0.97)] shadow-[0_24px_72px_oklch(0_0_0/0.65)] backdrop-blur-2xl z-50">
          <div
            className="absolute inset-0 opacity-[0.08] pointer-events-none"
            style={{
              backgroundImage:
                "radial-gradient(circle at 1px 1px, oklch(1 0 0) 1px, transparent 0)",
              backgroundSize: "8px 8px",
            }}
          />
          <div className="relative p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                  Balance breakdown
                </div>
                <div className="mt-3 flex items-end gap-1.5">
                  <span className="font-mono text-4xl font-semibold text-foreground">
                    {formatPortfolioMoney(accountValue).replace(".00", "")}
                  </span>
                  <span className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">USD</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  portfolio.refresh()
                  readiness.refresh()
                }}
                disabled={!tradingWalletAddress || portfolio.loading || readiness.loading}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-[oklch(0.24_0.016_255)] bg-[oklch(0.13_0.013_255)] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                aria-label="Refresh balance"
              >
                <Activity className={cn("h-3.5 w-3.5", (portfolio.loading || readiness.loading) && "animate-pulse text-[oklch(0.78_0.16_82)]")} />
              </button>
            </div>

            <div className="my-4 border-t border-dashed border-[oklch(0.46_0.02_255/0.40)]" />

            <div className="space-y-4">
              <div>
                <div className="text-[11px] font-bold text-muted-foreground">Overview</div>
                <div className="mt-2 space-y-2">
                  <div className="flex items-center justify-between gap-4 text-xs">
                    <span className="underline decoration-dotted underline-offset-4 text-foreground">Available to trade</span>
                    <span className="font-mono font-bold text-foreground">{formatPortfolioMoney(availableToTrade)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4 text-xs">
                    <span className="underline decoration-dotted underline-offset-4 text-foreground">pUSD balance</span>
                    <span className="font-mono font-bold text-foreground">{formatPusd(pUsdBalance)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4 text-xs">
                    <span className="underline decoration-dotted underline-offset-4 text-foreground">In positions</span>
                    <span className="font-mono font-bold text-foreground">{formatPortfolioMoney(inPositions)}</span>
                  </div>
                </div>
              </div>

              <div>
                <div className="text-[11px] font-bold text-muted-foreground">Profit & Loss</div>
                <div className="mt-2 space-y-2">
                  <div className="flex items-center justify-between gap-4 text-xs">
                    <span className="underline decoration-dotted underline-offset-4 text-foreground">Realized P/L</span>
                    <span className={cn("font-mono font-bold", realizedPositive ? "text-[oklch(0.68_0.18_155)]" : "text-[oklch(0.60_0.18_25)]")}>
                      {formatPortfolioPnl(realized)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-4 text-xs">
                    <span className="underline decoration-dotted underline-offset-4 text-foreground">Unrealized P/L</span>
                    <span className={cn("font-mono font-bold", portfolio.summary.unrealizedRaw >= 0 ? "text-[oklch(0.68_0.18_155)]" : "text-[oklch(0.60_0.18_25)]")}>
                      {portfolio.summary.unrealized}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {!walletAddress ? (
              <div className="mt-4 rounded-lg border border-[oklch(0.78_0.16_82/0.25)] bg-[oklch(0.78_0.16_82/0.08)] px-3 py-2 text-[11px] leading-5 text-[oklch(0.82_0.16_82)]">
                Connect wallet to load live Rawli trading balances.
              </div>
            ) : (
              <button
                type="button"
                onClick={() => openFundingModal()}
                disabled={!tradingProfile.profile || tradingProfile.depositLoading}
                className="mt-4 flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-[oklch(0.78_0.16_82)] px-3 text-[11px] font-bold uppercase tracking-[0.12em] text-[oklch(0.10_0.012_260)] transition-colors hover:bg-[oklch(0.83_0.16_82)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Wallet className="h-3.5 w-3.5" />
                Manage funds
              </button>
            )}
          </div>
        </div>
      ) : null}
      <BnbFundingModal
        open={fundingOpen}
        onOpenChange={setFundingOpen}
        initialTab={fundingInitialTab}
        profile={tradingProfile.profile}
        depositAddress={tradingProfile.profile?.depositAddress?.evm ?? null}
        loadingDeposit={tradingProfile.depositLoading}
        onCreateDepositAddress={tradingProfile.createDepositAddress}
        wallet={connectedWallet}
        collateralBalance={collateral?.balance ?? null}
        collateralAllowance={collateral?.allowance ?? null}
        collateralSessionReady={Boolean(collateral)}
        onRefreshCollateralBalance={readiness.refresh}
        onFundingSent={() => {
          void readiness.refresh()
          void portfolio.refresh()
        }}
      />
    </div>
  )
}

function NavbarNotifications() {
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (event: MouseEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener("mousedown", onClick)
    return () => window.removeEventListener("mousedown", onClick)
  }, [open])

  return (
    <div className="relative hidden sm:block" ref={panelRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "relative flex h-9 w-9 items-center justify-center rounded-xl border border-[oklch(0.24_0.016_255)] bg-[oklch(0.16_0.014_255)] text-muted-foreground transition-all hover:border-[oklch(0.78_0.16_82/0.4)] hover:bg-[oklch(0.18_0.014_255)] hover:text-foreground",
          open && "border-[oklch(0.78_0.16_82/0.45)] text-foreground"
        )}
        aria-expanded={open}
        aria-label="Open notifications"
      >
        <Bell className="h-4 w-4" />
        <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-[oklch(0.78_0.16_82)] shadow-[0_0_10px_oklch(0.78_0.16_82/0.55)]" />
      </button>

      {open ? (
        <div className="absolute right-0 mt-2 w-[min(288px,calc(100vw-1rem))] rounded-2xl border border-[oklch(0.28_0.018_255)] bg-[oklch(0.15_0.014_255/0.98)] p-4 shadow-[0_24px_70px_oklch(0_0_0/0.65)] backdrop-blur-2xl z-50">
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Notifications</div>
          <div className="mt-4 rounded-xl border border-[oklch(0.24_0.016_255)] bg-[oklch(0.11_0.012_260)] p-4">
            <div className="font-semibold text-foreground">Coming soon</div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              Order fills, bridge arrivals, analysis unlocks, and points updates will land here.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function PrivyDesktopWallet() {
  const router = useRouter()
  const [walletMenuOpen, setWalletMenuOpen] = useState(false)
  const [walletError, setWalletError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const { ready, authenticated, login, logout, connectWallet } = usePrivy()
  const activePrivyWallet = useActivePrivyWallet()
  const walletAddress = activePrivyWallet.walletAddress
  const shortAddress = walletAddress ? `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}` : ""

  useEffect(() => {
    if (!walletMenuOpen) return
    const onClick = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("[data-wallet-menu]")) setWalletMenuOpen(false)
    }
    window.addEventListener("mousedown", onClick)
    return () => window.removeEventListener("mousedown", onClick)
  }, [walletMenuOpen])

  const handleConnect = async () => {
    setWalletError(null)
    try {
      if (authenticated) connectWallet()
      else await login()
    } catch (err: any) {
      setWalletError(err?.message ?? "Connection failed")
    }
  }

  const handleCopy = async () => {
    await navigator.clipboard?.writeText(walletAddress!)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
    setWalletMenuOpen(false)
  }

  const handleDisconnect = async () => {
    setDisconnecting(true)
    setWalletMenuOpen(false)
    try {
      await logout()
      window.localStorage.removeItem("smartmarket.wallet")
    } catch (err: any) {
      setWalletError(err?.message ?? "Disconnect failed")
    } finally {
      setDisconnecting(false)
    }
  }

  if (!activePrivyWallet.ready || !walletAddress) {
    return (
      <button
        onClick={handleConnect}
        disabled={!ready}
        className="relative flex items-center gap-2 px-4 h-9 rounded-xl text-xs font-bold text-[oklch(0.12_0.01_255)] disabled:opacity-50 overflow-hidden transition-all hover:scale-[1.02] active:scale-[0.98]"
        style={{ background: "linear-gradient(135deg, oklch(0.82 0.16 82), oklch(0.72 0.18 75))" }}
      >
        {/* Inner shine */}
        <span className="absolute inset-0 bg-gradient-to-b from-white/20 to-transparent pointer-events-none" />
        <Wallet className="w-3.5 h-3.5 relative z-10" />
        <span className="relative z-10">{!ready || !activePrivyWallet.ready ? "Loading…" : "Connect Wallet"}</span>
      </button>
    )
  }

  return (
    <div className="flex items-center gap-2" data-wallet-menu>
      {/* BNB Chain pill */}
      <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-[oklch(0.15_0.014_255/0.8)] border border-[oklch(0.22_0.015_255/0.6)]">
        <span className="w-1.5 h-1.5 rounded-full bg-[oklch(0.68_0.18_155)] pulse-dot" />
        <span className="text-[10px] font-semibold text-muted-foreground">BNB Chain</span>
      </div>

      {/* Connected wallet button */}
      <div className="relative">
        <button
          onClick={() => setWalletMenuOpen((v) => !v)}
          className="flex items-center gap-2.5 pl-2 pr-3 h-9 rounded-xl bg-[oklch(0.16_0.014_255)] border border-[oklch(0.24_0.016_255)] hover:border-[oklch(0.78_0.16_82/0.4)] transition-all hover:bg-[oklch(0.18_0.014_255)] group"
        >
          {/* Avatar */}
          <div
            className="w-5 h-5 rounded-full flex-shrink-0 ring-1 ring-[oklch(0.78_0.16_82/0.3)]"
            style={{ background: walletGradient(walletAddress) }}
          />
          <span className="text-[11px] font-mono font-semibold text-foreground">{shortAddress}</span>
          <ChevronDown className={cn(
            "w-3 h-3 text-muted-foreground transition-transform duration-200",
            walletMenuOpen && "rotate-180"
          )} />
        </button>

        {walletMenuOpen && (
          <div className="absolute right-0 mt-2 w-56 rounded-xl bg-[oklch(0.145_0.013_255)] border border-[oklch(0.22_0.015_255)] shadow-[0_20px_60px_oklch(0_0_0/0.6)] overflow-hidden z-50">
            {/* Menu header */}
            <div className="px-3.5 py-2.5 border-b border-[oklch(0.2_0.014_255)] flex items-center gap-2.5">
              <div
                className="w-6 h-6 rounded-full ring-1 ring-[oklch(0.78_0.16_82/0.35)]"
                style={{ background: walletGradient(walletAddress) }}
              />
              <div>
                <p className="text-[11px] font-mono font-semibold text-foreground">{shortAddress}</p>
                <p className="text-[9px] text-muted-foreground mt-0.5">BNB Chain · Privy</p>
              </div>
            </div>

            <div className="py-1">
              <button
                onClick={() => { router.push("/portfolio"); setWalletMenuOpen(false) }}
                className="w-full text-left px-3.5 py-2.5 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-[oklch(0.2_0.014_255)] transition-colors flex items-center gap-2.5"
              >
                <Briefcase className="w-3.5 h-3.5" />
                Portfolio
                <ArrowUpRight className="w-3 h-3 ml-auto opacity-50" />
              </button>
              <button
                onClick={handleCopy}
                className="w-full text-left px-3.5 py-2.5 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-[oklch(0.2_0.014_255)] transition-colors flex items-center gap-2.5"
              >
                <Copy className="w-3.5 h-3.5" />
                {copied ? "Copied!" : "Copy address"}
              </button>
              <button
                onClick={() => { connectWallet(); setWalletMenuOpen(false) }}
                className="w-full text-left px-3.5 py-2.5 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-[oklch(0.2_0.014_255)] transition-colors"
              >
                Switch wallet
              </button>
            </div>

            <div className="border-t border-[oklch(0.2_0.014_255)] py-1">
              <button
                onClick={handleDisconnect}
                disabled={disconnecting}
                className="w-full text-left px-3.5 py-2.5 text-[11px] font-medium text-[oklch(0.60_0.18_25)] hover:bg-[oklch(0.2_0.014_255)] hover:text-[oklch(0.68_0.2_25)] transition-colors"
              >
                {disconnecting ? "Disconnecting…" : "Disconnect"}
              </button>
            </div>
          </div>
        )}
      </div>

      {walletError && (
        <div className="absolute right-4 top-16 w-64 rounded-lg border border-[oklch(0.58_0.2_25/0.45)] bg-[oklch(0.16_0.014_255)] p-3 text-[11px] text-[oklch(0.68_0.2_25)] shadow-2xl z-50">
          {walletError}
        </div>
      )}
    </div>
  )
}

function PrivyMobileWallet({ onDone }: { onDone: () => void }) {
  const { ready, authenticated, login, connectWallet } = usePrivy()
  const activePrivyWallet = useActivePrivyWallet()
  const walletAddress = activePrivyWallet.walletAddress
  const shortAddress = walletAddress ? `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}` : ""

  return (
    <button
      onClick={async () => {
        if (walletAddress || authenticated) connectWallet()
        else await login()
        onDone()
      }}
      disabled={!ready || !activePrivyWallet.ready}
      className="w-full mt-2 flex items-center justify-center gap-2 h-11 px-3 rounded-xl text-sm font-bold text-[oklch(0.12_0.01_255)] disabled:opacity-60"
      style={{ background: "linear-gradient(135deg, oklch(0.82 0.16 82), oklch(0.72 0.18 75))" }}
    >
      <Wallet className="w-4 h-4" />
      {walletAddress ? shortAddress : !ready || !activePrivyWallet.ready ? "Loading…" : "Connect Wallet"}
    </button>
  )
}

function MissingPrivyWalletButton({ mobile = false }: { mobile?: boolean }) {
  return (
    <button
      disabled
      title="Set NEXT_PUBLIC_PRIVY_APP_ID in apps/web/.env to enable wallet login."
      className={cn(
        "items-center justify-center gap-2 text-sm font-bold text-[oklch(0.12_0.01_255)] opacity-50",
        mobile ? "w-full mt-2 flex h-11 px-3 rounded-xl" : "flex px-4 h-9 rounded-xl"
      )}
      style={{ background: "linear-gradient(135deg, oklch(0.82 0.16 82), oklch(0.72 0.18 75))" }}
    >
      <Wallet className="w-4 h-4" />
      Connect Wallet
    </button>
  )
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname()
  const isActive = pathname === href || (href !== "/" && pathname?.startsWith(href))

  return (
    <Link
      href={href}
      className={cn(
        "relative text-[13px] font-semibold transition-all duration-200 px-3 py-1.5 rounded-full",
        isActive
          ? "text-[oklch(0.10_0.012_260)] bg-[oklch(0.78_0.16_82)] shadow-[0_2px_10px_oklch(0.78_0.16_82/0.30)]"
          : "text-[oklch(0.55_0.01_90)] hover:text-foreground hover:bg-[oklch(0.16_0.014_255/0.8)]"
      )}
    >
      {children}
    </Link>
  )
}

const TRENDING_TERMS = ["Bitcoin", "Ethereum", "BNB", "Champions League", "GTA VI", "Ukraine"]

function SearchResultImage({ src }: { src?: string | null }) {
  const [errored, setErrored] = useState(false)
  if (!src || errored) {
    return <div className="w-8 h-8 rounded-lg bg-[oklch(0.18_0.014_255)] shrink-0 border border-[oklch(0.24_0.016_255)]" />
  }
  return (
    <img
      src={src}
      alt=""
      className="w-8 h-8 rounded-lg object-cover shrink-0"
      onError={() => setErrored(true)}
      onLoad={(e) => { if ((e.target as HTMLImageElement).naturalWidth === 0) setErrored(true) }}
    />
  )
}

export function Navbar() {
  const router = useRouter()
  const [scrolled, setScrolled] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchValue, setSearchValue] = useState("")
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchResults, setSearchResults] = useState<PolymarketMarket[]>([])
  const [searchError, setSearchError] = useState<string | null>(null)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const privyEnabled = Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID)

  useEffect(() => {
    let frame = 0
    const updateScrolled = () => {
      setScrolled((current) => {
        const y = window.scrollY
        const next = current ? y > 4 : y > 24
        return current === next ? current : next
      })
    }
    const handleScroll = () => {
      if (frame) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        updateScrolled()
      })
    }
    updateScrolled()
    window.addEventListener("scroll", handleScroll, { passive: true })
    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      window.removeEventListener("scroll", handleScroll)
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault()
        setSearchOpen(true)
      }
      if (e.key === "Escape" && searchOpen) {
        setSearchOpen(false)
      }
      if (searchOpen && searchResults.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault()
          setSelectedIndex((i) => Math.min(i + 1, searchResults.length - 1))
        } else if (e.key === "ArrowUp") {
          e.preventDefault()
          setSelectedIndex((i) => Math.max(i - 1, 0))
        } else if (e.key === "Enter" && selectedIndex >= 0) {
          e.preventDefault()
          const market = searchResults[selectedIndex]
          if (market) {
            cacheMarketForDetail(market)
            setSearchOpen(false)
            router.push(`/markets/${market.id}`)
          }
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [searchOpen, searchResults, selectedIndex])

  useEffect(() => {
    if (searchOpen) {
      setTimeout(() => inputRef.current?.focus(), 60)
    } else {
      setSearchValue("")
      setSearchResults([])
      setSearchError(null)
      setSelectedIndex(-1)
    }
  }, [searchOpen])

  // Reset selection when results change
  useEffect(() => { setSelectedIndex(-1) }, [searchResults])

  useEffect(() => {
    if (!searchOpen || !searchValue.trim()) {
      setSearchResults([])
      setSearchError(null)
      return
    }
    const handle = setTimeout(async () => {
      setSearchLoading(true)
      setSearchError(null)
      try {
        const data = await fetchMarkets("all", 10, "trending", 0, searchValue.trim())
        setSearchResults(data.filter((m) => m.source !== "kalshi"))
      } catch {
        setSearchError("Search failed. Try again.")
        setSearchResults([])
      } finally {
        setSearchLoading(false)
      }
    }, 260)
    return () => clearTimeout(handle)
  }, [searchValue, searchOpen])

  return (
    <>
      <header
        className={cn(
          "fixed top-0 left-0 right-0 z-50 pt-safe-top transform-gpu bg-[oklch(0.09_0.012_260)] sm:bg-[oklch(0.09_0.012_260/0.96)] backdrop-blur-xl [backface-visibility:hidden] [contain:paint] [will-change:transform] transition-[background-color,box-shadow] duration-200",
          scrolled
            ? "shadow-[0_1px_0_oklch(0.78_0.16_82/0.12),0_10px_34px_oklch(0_0_0/0.26)]"
            : "shadow-none"
        )}
      >
        {/* Bottom border — glows amber on scroll */}
        <div
          className={cn(
            "absolute bottom-0 left-0 right-0 h-px transition-all duration-500",
            scrolled
              ? "bg-gradient-to-r from-transparent via-[oklch(0.78_0.16_82/0.55)] to-transparent"
              : "bg-[oklch(0.22_0.015_255/0.4)]"
          )}
        />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-[70px] flex items-center gap-4">

          {/* Logo */}
          <Link href="/" className="flex items-center gap-3 shrink-0 group">
            <div
              className="relative flex h-10 w-[54px] items-center justify-center transition-all duration-300 group-hover:scale-[1.06]"
              style={{ filter: "drop-shadow(0 0 6px oklch(0.78 0.16 82 / 0.18))" }}
            >
              <img
                src="/rawli-brand.png"
                alt="Rawli Analytics"
                className="h-full w-full object-contain"
              />
            </div>
            <div className="leading-none">
              <div className="text-[13px] sm:text-[15px] font-extrabold tracking-tight">
                <span className="text-foreground">Rawli</span>{" "}
                <span className="text-[oklch(0.82_0.16_82)]">Analytics</span>
              </div>
              <div className="hidden sm:block text-[9px] uppercase tracking-[0.22em] text-muted-foreground/70 mt-[3px]">
                prediction terminal
              </div>
            </div>
          </Link>

          {/* Divider */}
          <div className="hidden md:block w-px h-6 bg-[oklch(0.24_0.016_255)]" />

          {/* Nav links */}
          <nav className="hidden md:flex items-center gap-1">
            <NavLink href="/">Markets</NavLink>
            <NavLink href="/portfolio">Portfolio</NavLink>
            <NavLink href="/points">Points</NavLink>
          </nav>

          {/* Search trigger */}
          <button
            onClick={() => setSearchOpen(true)}
            className="hidden md:flex flex-1 max-w-sm items-center gap-2.5 h-9 px-3.5 rounded-xl bg-[oklch(0.145_0.013_255/0.9)] border border-[oklch(0.22_0.015_255/0.7)] text-muted-foreground hover:border-[oklch(0.78_0.16_82/0.28)] hover:text-foreground/70 hover:bg-[oklch(0.16_0.014_255)] transition-all ml-auto group"
          >
            <Search className="w-3.5 h-3.5 shrink-0 group-hover:text-[oklch(0.78_0.16_82/0.75)] transition-colors duration-200" />
            <span className="text-xs flex-1 text-left">Search markets…</span>
            <kbd className="text-[9px] font-mono px-1.5 py-0.5 rounded-lg bg-[oklch(0.20_0.015_255/0.8)] border border-[oklch(0.24_0.016_255/0.6)] text-muted-foreground/60">
              ⌘K
            </kbd>
          </button>

          {/* Live status dot (desktop) */}
          <div className="hidden lg:flex items-center gap-1.5">
            <Activity className="w-3 h-3 text-[oklch(0.68_0.18_155)]" />
            <span className="text-[10px] font-semibold text-[oklch(0.68_0.18_155/0.8)]">Live</span>
          </div>

          {privyEnabled ? <NavbarNotifications /> : null}
          {privyEnabled ? <NavbarBalanceBreakdown /> : null}

          {/* Mobile search */}
          <button
            onClick={() => setSearchOpen(true)}
            className="md:hidden ml-auto w-8 h-8 rounded-lg bg-[oklch(0.15_0.013_255)] border border-[oklch(0.22_0.015_255)] flex items-center justify-center text-muted-foreground"
            aria-label="Search"
          >
            <Search className="w-3.5 h-3.5" />
          </button>

          {/* Wallet */}
          <div className="hidden sm:block">
            {privyEnabled ? <PrivyDesktopWallet /> : <MissingPrivyWalletButton />}
          </div>

          {/* Mobile menu */}
          <button
            className="md:hidden w-8 h-8 rounded-lg bg-[oklch(0.15_0.013_255)] border border-[oklch(0.22_0.015_255)] flex items-center justify-center text-muted-foreground"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label="Toggle menu"
          >
            {mobileOpen ? <X className="w-3.5 h-3.5" /> : <Menu className="w-3.5 h-3.5" />}
          </button>
        </div>

        {/* Mobile dropdown */}
        {mobileOpen && (
          <div className="md:hidden border-t border-[oklch(0.22_0.015_255/0.6)] bg-[oklch(0.10_0.012_260/0.98)] backdrop-blur-2xl px-4 py-3 space-y-1">
            <Link
              href="/"
              onClick={() => setMobileOpen(false)}
              className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium text-foreground hover:bg-[oklch(0.16_0.014_255)] transition-colors"
            >
              <TrendingUp className="w-3.5 h-3.5 text-[oklch(0.78_0.16_82)]" />
              Markets
            </Link>
            <Link
              href="/portfolio"
              onClick={() => setMobileOpen(false)}
              className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-[oklch(0.16_0.014_255)] transition-colors"
            >
              <Briefcase className="w-3.5 h-3.5" />
              Portfolio
            </Link>
            <Link
              href="/points"
              onClick={() => setMobileOpen(false)}
              className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-[oklch(0.16_0.014_255)] transition-colors"
            >
              <Award className="w-3.5 h-3.5" />
              Points
            </Link>
            {privyEnabled ? <PrivyMobileWallet onDone={() => setMobileOpen(false)} /> : <MissingPrivyWalletButton mobile />}
          </div>
        )}
      </header>

      {/* ── Search modal ── */}
      {searchOpen && (
        <div
          className="fixed inset-0 z-[60] bg-[oklch(0.06_0.01_260/0.75)] backdrop-blur-md flex items-start justify-center px-4"
          style={{ paddingTop: "clamp(60px, 14vh, 140px)" }}
          onClick={() => setSearchOpen(false)}
        >
          <div
            className="w-full max-w-[560px] rounded-2xl bg-[oklch(0.135_0.013_255/0.98)] border border-[oklch(0.24_0.016_255/0.7)] shadow-[0_40px_100px_oklch(0_0_0/0.72),inset_0_1px_0_oklch(1_0_0/0.05)] backdrop-blur-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Input row */}
            <div className="flex items-center gap-3 px-4 py-3.5 border-b border-[oklch(0.2_0.014_255)]">
              <Search className="w-4 h-4 text-[oklch(0.78_0.16_82/0.7)] shrink-0" />
              <input
                ref={inputRef}
                type="text"
                placeholder="Search prediction markets…"
                className="flex-1 bg-transparent text-foreground placeholder:text-muted-foreground/60 outline-none text-sm"
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
              />
              <div className="flex items-center gap-2">
                {searchValue && (
                  <button
                    className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => setSearchValue("")}
                  >
                    Clear
                  </button>
                )}
                <kbd
                  onClick={() => setSearchOpen(false)}
                  className="text-[9px] font-mono text-muted-foreground/70 px-1.5 py-0.5 rounded bg-[oklch(0.2_0.015_255)] border border-[oklch(0.22_0.015_255)] cursor-pointer hover:text-foreground transition-colors"
                >
                  ESC
                </kbd>
              </div>
            </div>

            <div className="max-h-[54vh] overflow-y-auto">
              {/* Empty state — trending suggestions */}
              {!searchValue && (
                <div className="px-4 py-3">
                  <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-muted-foreground/60 mb-2">
                    Trending searches
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {TRENDING_TERMS.map((term) => (
                      <button
                        key={term}
                        onClick={() => setSearchValue(term)}
                        className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-[oklch(0.18_0.014_255)] border border-[oklch(0.24_0.016_255)] text-muted-foreground hover:text-foreground hover:border-[oklch(0.78_0.16_82/0.3)] transition-all"
                      >
                        {term}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Loading */}
              {searchLoading && (
                <div className="flex items-center gap-2.5 px-4 py-3 text-xs text-muted-foreground">
                  <div className="w-3 h-3 border border-[oklch(0.78_0.16_82)] border-t-transparent rounded-full animate-spin" />
                  Searching markets…
                </div>
              )}

              {/* Error */}
              {!searchLoading && searchError && (
                <div className="px-4 py-3 text-xs text-[oklch(0.58_0.2_25)]">{searchError}</div>
              )}

              {/* No results */}
              {!searchLoading && !searchError && searchValue && searchResults.length === 0 && (
                <div className="px-4 py-4 text-center">
                  <p className="text-xs text-muted-foreground">No markets found for "{searchValue}"</p>
                  <p className="text-[10px] text-muted-foreground/60 mt-1">Try a different query</p>
                </div>
              )}

              {/* Results */}
              {!searchLoading && searchResults.length > 0 && (
                <div className="py-1">
                  <p className="px-4 pt-1.5 pb-1 text-[9px] font-bold uppercase tracking-[0.18em] text-muted-foreground/60">
                    {searchResults.length} result{searchResults.length !== 1 ? "s" : ""}
                    <span className="ml-2 text-muted-foreground/40">↑↓ to navigate · ↵ to open</span>
                  </p>
                  {searchResults.map((market, idx) => {
                    const price = getYesPrice(market)
                    const isUp = price >= 50
                    const isSelected = idx === selectedIndex
                    return (
                      <button
                        key={market.id}
                        onClick={() => {
                          cacheMarketForDetail(market)
                          setSearchOpen(false)
                          router.push(`/markets/${market.id}`)
                        }}
                        onMouseEnter={() => setSelectedIndex(idx)}
                        className={cn(
                          "w-full text-left px-4 py-2.5 transition-colors group/r",
                          isSelected
                            ? "bg-[oklch(0.78_0.16_82/0.08)] border-l-2 border-[oklch(0.78_0.16_82/0.6)]"
                            : "hover:bg-[oklch(0.17_0.014_255)] border-l-2 border-transparent"
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <SearchResultImage src={market.image ?? market.icon} />
                          <div className="flex-1 min-w-0">
                            <div className={cn(
                              "text-[12px] font-semibold line-clamp-1 transition-colors",
                              isSelected ? "text-[oklch(0.92_0.01_90)]" : "text-foreground group-hover/r:text-[oklch(0.92_0.01_90)]"
                            )}>
                              {market.question}
                            </div>
                            <div className="text-[9px] uppercase tracking-widest text-muted-foreground/70 mt-0.5">
                              {market.category}
                            </div>
                          </div>
                          <div className={cn(
                            "text-xs font-bold tabular-nums px-2 py-0.5 rounded-md shrink-0",
                            isUp
                              ? "bg-[oklch(0.68_0.18_155/0.12)] text-[oklch(0.68_0.18_155)]"
                              : "bg-[oklch(0.58_0.2_25/0.12)] text-[oklch(0.60_0.18_25)]"
                          )}>
                            {price.toFixed(0)}¢
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Footer hint */}
            <div className="px-4 py-2 border-t border-[oklch(0.2_0.014_255)] flex items-center justify-between">
              <div className="flex items-center gap-3 text-[9px] text-muted-foreground/50">
                <span>↵ Open market</span>
                <span>ESC Close</span>
              </div>
              {searchValue.trim() && (
                <button
                  onClick={() => {
                    setSearchOpen(false)
                    router.push(`/?q=${encodeURIComponent(searchValue.trim())}`)
                  }}
                  className="text-[10px] font-semibold text-[oklch(0.78_0.16_82)] hover:text-[oklch(0.88_0.14_82)] transition-colors"
                >
                  See all results →
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
