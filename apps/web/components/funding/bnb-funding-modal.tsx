"use client"

import { useEffect, useMemo, useState } from "react"
import { BrowserProvider } from "ethers"
import { Copy, Fuel, Loader2, RefreshCw, Route, Send, Wallet } from "lucide-react"
import type { ConnectedWallet } from "@privy-io/react-auth"
import type { BridgeQuoteResponse, TradingProfile } from "@smartmarket/types"
import { encodeErc20Transfer } from "@/lib/abi"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { fundingStatusTone, useFundingStatus } from "@/hooks/use-funding-status"
import { useGasAssist } from "@/hooks/use-gas-assist"
import { shortAddress } from "@/hooks/use-trading-profile"
import { scheduleAccountRefresh } from "@/lib/account-events"

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000"
const PREFERRED_SYMBOLS = ["BNB", "USDC", "USDT", "DAI", "BTCB", "ETH", "BUSD"]
const POLYGON_CHAIN_ID = "137"
const POLYGON_CHAIN_NUMBER = 137
const POLYGON_CHAIN_HEX = "0x89"
const POLYMARKET_COLLATERAL_TOKEN = "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB"
const BSC_CHAIN_ID = 56
const BSC_CHAIN_HEX = "0x38"
const NATIVE_TOKEN_ADDRESS = "0x0000000000000000000000000000000000000000"
const BSC_USDT_ADDRESS = "0x55d398326f99059fF775485246999027B3197955"
const BSC_CHAIN_ID_STR = "56"

type FundingAsset = {
  chainId: string
  chainName: string
  token: {
    name: string
    symbol: string
    address: string
    decimals: number
  }
  minCheckoutUsd?: number
}

type FundingModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialTab?: "deposit" | "withdraw"
  profile: TradingProfile | null
  depositAddress: string | null
  loadingDeposit: boolean
  onCreateDepositAddress: () => Promise<TradingProfile | null>
  wallet?: ConnectedWallet | null
  collateralBalance?: string | null
  collateralAllowance?: string | null
  collateralSessionReady?: boolean
  onRefreshCollateralBalance?: () => Promise<void> | void
  onFundingSent?: () => void
}

type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
}

function sortAssets(assets: FundingAsset[]) {
  return [...assets].sort((a, b) => {
    const aIndex = PREFERRED_SYMBOLS.indexOf(a.token.symbol)
    const bIndex = PREFERRED_SYMBOLS.indexOf(b.token.symbol)
    if (aIndex !== -1 || bIndex !== -1) {
      return (aIndex === -1 ? 99 : aIndex) - (bIndex === -1 ? 99 : bIndex)
    }
    return a.token.symbol.localeCompare(b.token.symbol)
  })
}

function selectedAssetKey(asset: FundingAsset) {
  return `${asset.chainId}:${asset.token.address}`
}

function decimalToBaseUnit(value: string, decimals: number) {
  const trimmed = value.trim()
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null
  const [whole, fraction = ""] = trimmed.split(".")
  const paddedFraction = fraction.slice(0, decimals).padEnd(decimals, "0")
  const base = `${whole}${paddedFraction}`.replace(/^0+(?=\d)/, "")
  return base || "0"
}

function formatUsd(value?: number) {
  if (value === undefined || value === null || !Number.isFinite(value)) return "—"
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 })
}

function formatDuration(ms?: number) {
  if (!ms || !Number.isFinite(ms)) return "—"
  const minutes = Math.max(1, Math.round(ms / 60_000))
  return `${minutes} min`
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

function formatPusd(raw?: string | null) {
  if (raw === undefined || raw === null || raw === "") return "Not loaded"
  const value = collateralAmount(raw)
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value > 0 && value < 10 ? 2 : 0,
    maximumFractionDigits: 6,
  })
}

function formatPusdAllowance(raw?: string | null) {
  if (raw === undefined || raw === null || raw === "") return "Not loaded"
  const normalized = String(raw).trim()
  if (/^\d+$/.test(normalized) && normalized.length > 24) return "Unlimited"
  return formatPusd(raw)
}

function formatTokenAmount(value: number) {
  if (!Number.isFinite(value) || value <= 0) return ""
  return value.toFixed(6).replace(/\.?0+$/, "")
}

function extractEvmAddress(payload: any): string | null {
  const candidates = [
    payload?.address?.evm,
    payload?.withdrawalAddress?.evm,
    payload?.depositAddress?.evm,
    payload?.evm,
    payload?.address,
    payload?.withdrawalAddress,
  ]
  const found = candidates.find((value) => typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value))
  return found ?? null
}

function isDollarLike(symbol?: string) {
  return ["USDC", "USDT", "DAI", "BUSD", "FDUSD"].includes((symbol ?? "").toUpperCase())
}

export function BnbFundingModal({
  open,
  onOpenChange,
  initialTab = "deposit",
  profile,
  depositAddress,
  loadingDeposit,
  onCreateDepositAddress,
  wallet,
  collateralBalance,
  collateralAllowance,
  collateralSessionReady = false,
  onRefreshCollateralBalance,
  onFundingSent,
}: FundingModalProps) {
  const [activeTab, setActiveTab] = useState<"deposit" | "withdraw">("deposit")
  const [assets, setAssets] = useState<FundingAsset[]>([])
  const [selectedAssetId, setSelectedAssetId] = useState("")
  const [amount, setAmount] = useState("")
  const [loadingAssets, setLoadingAssets] = useState(false)
  const [quoteLoading, setQuoteLoading] = useState(false)
  const [quote, setQuote] = useState<BridgeQuoteResponse | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sendStatus, setSendStatus] = useState<"idle" | "switching" | "sending" | "confirming" | "sent">("idle")
  const fundingStatus = useFundingStatus(depositAddress, { active: open && Boolean(depositAddress), intervalMs: 12_000 })

  // Withdraw state
  const [withdrawAmount, setWithdrawAmount] = useState("")
  const [withdrawStatus, setWithdrawStatus] = useState<"idle" | "preparing" | "switching" | "sending" | "confirming" | "done" | "error">("idle")
  const [withdrawResult, setWithdrawResult] = useState<any>(null)
  const [withdrawError, setWithdrawError] = useState<string | null>(null)
  const [refreshingCollateral, setRefreshingCollateral] = useState(false)

  const sortedAssets = useMemo(() => sortAssets(assets), [assets])
  const selectedAsset = sortedAssets.find((asset) => selectedAssetKey(asset) === selectedAssetId) ?? sortedAssets[0]
  const minCheckoutUsd = selectedAsset?.minCheckoutUsd ?? 2
  const amountNumber = Number(amount)
  const invalidAmount = Boolean(amount) && (!Number.isFinite(amountNumber) || amountNumber <= 0)
  const canCompareMinimum = isDollarLike(selectedAsset?.token.symbol)
  const amountBelowMin = canCompareMinimum && Boolean(amount) && Number.isFinite(amountNumber) && amountNumber < minCheckoutUsd
  const amountBaseUnit = selectedAsset ? decimalToBaseUnit(amount, selectedAsset.token.decimals) : null
  const quoteDisabled = !profile?.tradingWalletAddress || !selectedAsset || !amountBaseUnit || amountBaseUnit === "0" || invalidAmount || amountBelowMin || quoteLoading
  const latestTransaction = fundingStatus.latest
  const hasKnownWithdrawBalance = collateralBalance !== undefined && collateralBalance !== null && collateralBalance !== ""
  const withdrawBalanceAmount = collateralAmount(collateralBalance)
  const withdrawAmountNumber = Number(withdrawAmount)
  const withdrawAmountBaseUnit = decimalToBaseUnit(withdrawAmount, PUSD_DECIMALS)
  const withdrawAmountInvalid = Boolean(withdrawAmount) && (!Number.isFinite(withdrawAmountNumber) || withdrawAmountNumber <= 0)
  const withdrawAmountExceedsBalance = Boolean(withdrawAmount) && Number.isFinite(withdrawAmountNumber) && withdrawAmountNumber > withdrawBalanceAmount
  const walletMatchesTradingWallet =
    Boolean(wallet?.address && profile?.tradingWalletAddress) &&
    wallet!.address.toLowerCase() === profile!.tradingWalletAddress.toLowerCase()
  const depositWalletWithdrawMode =
    profile?.tradingWalletKind === "deposit" &&
    Boolean(wallet?.address && profile?.tradingWalletAddress)
  const canSubmitWithdrawTransfer = walletMatchesTradingWallet || depositWalletWithdrawMode
  const withdrawGasAssist = useGasAssist(
    profile?.tradingWalletAddress,
    activeTab === "withdraw" && !depositWalletWithdrawMode && collateralSessionReady && hasKnownWithdrawBalance && withdrawBalanceAmount > 0
  )
  const withdrawNeedsGasAssist = !depositWalletWithdrawMode && Boolean(withdrawGasAssist.status?.eligible)
  const withdrawGasAssistBusy = withdrawGasAssist.loading || withdrawGasAssist.requesting
  const depositMessage = error ?? fundingStatus.error ?? notice
  const depositMessageTone = error || fundingStatus.error ? "error" : notice ? "info" : "idle"
  const withdrawMessage = withdrawError
    ?? (withdrawAmountInvalid
      ? "Enter a valid positive pUSD amount."
      : withdrawAmountExceedsBalance
      ? `Amount exceeds your available ${formatTokenAmount(withdrawBalanceAmount)} pUSD balance.`
      : "")

  const handleWithdrawAmountChange = (value: string) => {
    if (withdrawStatus === "done" || withdrawStatus === "error") {
      setWithdrawStatus("idle")
      setWithdrawResult(null)
      setWithdrawError(null)
    }
    setWithdrawAmount(value)
  }

  const withdrawDisabled =
    !profile?.tradingWalletAddress ||
    !wallet?.address ||
    withdrawStatus === "preparing" ||
    withdrawStatus === "switching" ||
    withdrawStatus === "sending" ||
    withdrawStatus === "confirming" ||
    withdrawStatus === "done" ||
    (!depositWalletWithdrawMode && !collateralSessionReady) ||
    !hasKnownWithdrawBalance ||
    withdrawBalanceAmount <= 0 ||
    !withdrawAmountBaseUnit ||
    withdrawAmountBaseUnit === "0" ||
    withdrawAmountInvalid ||
    withdrawAmountExceedsBalance ||
    !canSubmitWithdrawTransfer ||
    withdrawNeedsGasAssist ||
    withdrawGasAssistBusy

  const loadAssets = async () => {
    setLoadingAssets(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/funding/bnb-assets`)
      const payload = await res.json()
      if (!res.ok) throw new Error(payload?.error ?? "Failed to load BNB assets")
      const list = Array.isArray(payload?.supportedAssets) ? payload.supportedAssets as FundingAsset[] : []
      setAssets(list)
      if (!selectedAssetId && list.length) setSelectedAssetId(selectedAssetKey(sortAssets(list)[0]))
    } catch (err: any) {
      setError(err?.message ?? "Failed to load BNB assets")
    } finally {
      setLoadingAssets(false)
    }
  }

  const handlePrepareAddress = async () => {
    setNotice(null)
    setError(null)
    const nextProfile = await onCreateDepositAddress()
    if (nextProfile?.depositAddress?.evm) setNotice("Deposit address ready")
  }

  const handleQuote = async () => {
    if (!profile?.tradingWalletAddress || !selectedAsset || !amountBaseUnit || amountBaseUnit === "0") {
      setError("Choose an asset and enter an amount before requesting a quote.")
      return
    }

    if (amountBelowMin) {
      setError(`Amount is below the estimated $${minCheckoutUsd} minimum for ${selectedAsset.token.symbol}.`)
      return
    }

    setQuoteLoading(true)
    setQuote(null)
    setNotice(null)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/funding/quote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromAmountBaseUnit: amountBaseUnit,
          fromChainId: selectedAsset.chainId,
          fromTokenAddress: selectedAsset.token.address,
          recipientAddress: profile.tradingWalletAddress,
          toChainId: POLYGON_CHAIN_ID,
          toTokenAddress: POLYMARKET_COLLATERAL_TOKEN,
        }),
      })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload?.error ?? "Unable to quote funding route")
      setQuote(payload as BridgeQuoteResponse)
      setNotice("Quote refreshed")
    } catch (err: any) {
      setError(err?.message ?? "Unable to quote funding route")
    } finally {
      setQuoteLoading(false)
    }
  }

  const copyDepositAddress = async () => {
    if (!depositAddress) return
    await navigator.clipboard?.writeText(depositAddress)
    setNotice("Deposit address copied")
  }

  const handleSendFromWallet = async () => {
    if (!wallet || !depositAddress || !selectedAsset || !amountBaseUnit || amountBaseUnit === "0") return

    setError(null)
    setNotice(null)
    setSendStatus("switching")

    try {
      const switchable = wallet as ConnectedWallet & { switchChain?: (id: number) => Promise<void> }
      const provider = await wallet.getEthereumProvider()
      const currentChain = await (provider as any).request({ method: "eth_chainId" }).catch(() => null)

      if (String(currentChain).toLowerCase() !== BSC_CHAIN_HEX && typeof switchable.switchChain === "function") {
        await switchable.switchChain(BSC_CHAIN_ID)
      }

      const freshProvider = await wallet.getEthereumProvider()
      const ethersProvider = new BrowserProvider(freshProvider as any)
      const signer = await ethersProvider.getSigner()

      setSendStatus("sending")

      const isNative =
        selectedAsset.token.address === NATIVE_TOKEN_ADDRESS ||
        selectedAsset.token.symbol.toUpperCase() === "BNB"

      let tx
      if (isNative) {
        tx = await signer.sendTransaction({
          to: depositAddress,
          value: BigInt(amountBaseUnit),
        })
      } else {
        const data = encodeErc20Transfer(depositAddress, amountBaseUnit)
        tx = await signer.sendTransaction({
          to: selectedAsset.token.address,
          data,
        })
      }

      setSendStatus("confirming")
      await tx.wait(1)

      setSendStatus("sent")
      setNotice(`Sent! TX: ${tx.hash.slice(0, 10)}...${tx.hash.slice(-6)}`)
      onFundingSent?.()
      fundingStatus.refresh()
    } catch (err: any) {
      setSendStatus("idle")
      if (err?.code === "ACTION_REJECTED") {
        setError("Transaction rejected by wallet")
      } else {
        setError(err?.message ?? "Failed to send transaction")
      }
    }
  }

  const sendDisabled = !wallet || !depositAddress || !selectedAsset || !amountBaseUnit || amountBaseUnit === "0" || invalidAmount || amountBelowMin || sendStatus !== "idle"
  const sendLabel = sendStatus === "switching" ? "Switching to BSC..." : sendStatus === "sending" ? "Approve in wallet..." : sendStatus === "confirming" ? "Confirming..." : sendStatus === "sent" ? "Sent!" : "Send from wallet"

  const handleWithdraw = async () => {
    const tradingWalletAddr = profile?.tradingWalletAddress
    const recipientAddr = wallet?.address
    if (!tradingWalletAddr || !recipientAddr) {
      setWithdrawError("Trading wallet or connected wallet address is missing.")
      return
    }

    if (!canSubmitWithdrawTransfer) {
      setWithdrawError("Withdrawals must be sent from the wallet that controls the Polymarket trading wallet.")
      return
    }

    if (!withdrawAmountBaseUnit || withdrawAmountBaseUnit === "0" || withdrawAmountInvalid || withdrawAmountExceedsBalance) {
      setWithdrawError("Enter a valid pUSD amount that does not exceed your available balance.")
      return
    }

    if (!wallet) {
      setWithdrawError("Connected wallet is missing.")
      return
    }

    if (!depositWalletWithdrawMode && withdrawGasAssist.status?.eligible) {
      setWithdrawError("Get Polygon Gas Assist first, then retry the pUSD transfer.")
      return
    }

    setWithdrawStatus("preparing")
    setWithdrawError(null)
    setWithdrawResult(null)
    try {
      const res = await fetch(`${API_BASE}/bridge/withdraw`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: tradingWalletAddr,
          toChainId: BSC_CHAIN_ID_STR,
          toTokenAddress: BSC_USDT_ADDRESS,
          recipientAddr,
        }),
      })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload?.error ?? "Withdrawal route request failed")
      const withdrawalAddress = extractEvmAddress(payload)
      if (!withdrawalAddress) throw new Error("Bridge did not return a Polygon withdrawal address.")

      if (depositWalletWithdrawMode) {
        setWithdrawStatus("switching")
        const provider = (await wallet.getEthereumProvider()) as Eip1193Provider
        const prepareRes = await fetch(`${API_BASE}/deposit-wallet/withdraw/prepare`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            owner: recipientAddr,
            depositWallet: tradingWalletAddr,
            withdrawalAddress,
            amountBaseUnit: withdrawAmountBaseUnit,
          }),
        })
        const prepared = await prepareRes.json()
        if (!prepareRes.ok || prepared?.ok === false) {
          throw new Error(prepared?.error ?? "Unable to prepare deposit wallet withdrawal.")
        }

        setWithdrawStatus("sending")
        const signature = await provider.request({
          method: "eth_signTypedData_v4",
          params: [recipientAddr, JSON.stringify(prepared.typedData)],
        }) as string

        setWithdrawStatus("confirming")
        const submitRes = await fetch(`${API_BASE}/deposit-wallet/withdraw/submit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            owner: recipientAddr,
            depositWallet: tradingWalletAddr,
            withdrawalAddress,
            amountBaseUnit: withdrawAmountBaseUnit,
            nonce: prepared.nonce,
            deadline: prepared.deadline,
            calls: prepared.calls,
            signature,
          }),
        })
        const submitted = await submitRes.json()
        if (!submitRes.ok || submitted?.ok === false) {
          throw new Error(submitted?.error ?? "Deposit wallet withdrawal submit failed.")
        }

        setWithdrawResult({
          ...payload,
          relayer: submitted,
          withdrawalAddress,
          amount: withdrawAmount,
          amountBaseUnit: withdrawAmountBaseUnit,
          txHash: submitted.transactionHash ?? submitted.hash,
          transactionID: submitted.transactionID,
        })
        setWithdrawStatus("done")
        setWithdrawAmount("")
        await onRefreshCollateralBalance?.()
        scheduleAccountRefresh({ reason: "withdrawal_submitted", address: tradingWalletAddr })
        return
      }

      setWithdrawStatus("switching")
      const switchable = wallet as ConnectedWallet & { switchChain?: (id: number) => Promise<void> }
      const provider = await wallet.getEthereumProvider()
      const currentChain = await (provider as any).request({ method: "eth_chainId" }).catch(() => null)
      if (String(currentChain).toLowerCase() !== POLYGON_CHAIN_HEX && typeof switchable.switchChain === "function") {
        await switchable.switchChain(POLYGON_CHAIN_NUMBER)
      } else if (String(currentChain).toLowerCase() !== POLYGON_CHAIN_HEX) {
        await (provider as any).request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: POLYGON_CHAIN_HEX }],
        })
      }

      const freshProvider = await wallet.getEthereumProvider()
      const ethersProvider = new BrowserProvider(freshProvider as any)
      const signer = await ethersProvider.getSigner()
      const data = encodeErc20Transfer(withdrawalAddress, withdrawAmountBaseUnit)

      setWithdrawStatus("sending")
      const tx = await signer.sendTransaction({
        to: POLYMARKET_COLLATERAL_TOKEN,
        data,
      })

      setWithdrawStatus("confirming")
      await tx.wait(1)

      setWithdrawResult({
        ...payload,
        withdrawalAddress,
        amount: withdrawAmount,
        amountBaseUnit: withdrawAmountBaseUnit,
        txHash: tx.hash,
      })
      setWithdrawStatus("done")
      setWithdrawAmount("")
      await onRefreshCollateralBalance?.()
      scheduleAccountRefresh({ reason: "withdrawal_submitted", address: tradingWalletAddr })
    } catch (err: any) {
      if (err?.code === "ACTION_REJECTED") {
        setWithdrawError("Withdrawal transaction rejected by wallet.")
      } else {
        setWithdrawError(err?.message ?? "Withdraw request failed")
      }
      setWithdrawStatus("error")
    }
  }

  const handleRefreshCollateral = async () => {
    if (!onRefreshCollateralBalance) return
    setRefreshingCollateral(true)
    setWithdrawError(null)
    try {
      await onRefreshCollateralBalance()
    } catch (err: any) {
      setWithdrawError(err?.message ?? "Unable to refresh pUSD balance.")
    } finally {
      setRefreshingCollateral(false)
    }
  }

  useEffect(() => {
    if (open) setActiveTab(initialTab)
  }, [open, initialTab])

  // Load BNB assets once when the modal opens. Assets don't depend on depositAddress —
  // removing it from the dep array prevents an extra refetch after address creation.
  useEffect(() => {
    if (!open) return
    loadAssets()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    setQuote(null)
    setNotice(null)
    setError(null)
  }, [selectedAssetId, amount, profile?.tradingWalletAddress])

  // Reset withdraw state when switching away from withdraw tab or closing modal
  useEffect(() => {
    if (!open || activeTab !== "withdraw") {
      setWithdrawStatus("idle")
      setWithdrawResult(null)
      setWithdrawError(null)
      setWithdrawAmount("")
    }
  }, [open, activeTab])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-1.5rem)] max-w-[min(38rem,calc(100vw-1.5rem))] flex-col overflow-hidden border-[oklch(0.22_0.015_255)] bg-[oklch(0.115_0.012_260)] p-0 sm:max-w-[38rem]">
        <DialogHeader className="shrink-0 border-b border-[oklch(0.22_0.015_255)] px-5 pb-4 pt-5 pr-10">
          <DialogTitle className="text-foreground">Manage bridge funds</DialogTitle>
          <DialogDescription className="break-words">
            Deposit from BNB or withdraw Polymarket pUSD back to your connected BNB wallet.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden px-5 py-4">
        {/* Tab switcher */}
        <div className="flex rounded-lg border border-[oklch(0.22_0.015_255)] bg-[oklch(0.14_0.013_255)] p-0.5">
          {(["deposit", "withdraw"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                "min-w-0 flex-1 rounded-md py-1.5 text-[10px] font-bold uppercase tracking-wider transition-all",
                activeTab === tab
                  ? "bg-[oklch(0.78_0.16_82/0.18)] text-[oklch(0.78_0.16_82)]"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {tab === "deposit" ? "Deposit" : "Withdraw"}
            </button>
          ))}
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-[oklch(0.22_0.015_255)] bg-[oklch(0.145_0.014_255)] p-4 text-xs">
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Trading wallet</span>
              <span className="font-mono text-foreground">{shortAddress(profile?.tradingWalletAddress)}</span>
            </div>
            <div className="mt-3 flex items-center justify-between gap-3">
              <span className="text-muted-foreground">{activeTab === "deposit" ? "Destination" : "Source"}</span>
              <span className="font-semibold text-[oklch(0.78_0.16_82)]">Polymarket pUSD</span>
            </div>
          </div>

          {activeTab === "deposit" && (
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_0.7fr] gap-3">
            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Asset</label>
              <Select value={selectedAsset ? selectedAssetKey(selectedAsset) : selectedAssetId} onValueChange={setSelectedAssetId}>
                <SelectTrigger className="h-11 w-full border-[oklch(0.22_0.015_255)] bg-[oklch(0.16_0.014_255)]">
                  <SelectValue placeholder={loadingAssets ? "Loading assets" : "Select asset"} />
                </SelectTrigger>
                <SelectContent className="border-[oklch(0.22_0.015_255)] bg-[oklch(0.14_0.014_255)]">
                  {sortedAssets.map((asset) => (
                    <SelectItem key={selectedAssetKey(asset)} value={selectedAssetKey(asset)}>
                      {asset.token.symbol} · min ${asset.minCheckoutUsd ?? 2}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Amount</label>
              <Input
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                inputMode="decimal"
                placeholder={selectedAsset ? `${selectedAsset.token.symbol} amount` : `Min $${minCheckoutUsd}`}
                className="h-11 border-[oklch(0.22_0.015_255)] bg-[oklch(0.16_0.014_255)]"
              />
            </div>
          </div>
          )}

          {activeTab === "deposit" && selectedAsset ? (
            <div className="rounded-xl border border-[oklch(0.22_0.015_255)] bg-[oklch(0.125_0.012_260/0.72)] p-4 text-xs space-y-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Network</span>
                <span className="font-semibold text-foreground">{selectedAsset.chainName}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Token</span>
                <span className="font-mono text-foreground">{shortAddress(selectedAsset.token.address)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Minimum</span>
                <span className={cn("font-semibold", amountBelowMin ? "text-[oklch(0.58_0.2_25)]" : "text-foreground")}>
                  ${minCheckoutUsd} estimated value
                </span>
              </div>
            </div>
          ) : null}

          {/* ── Withdraw tab content ── */}
          {activeTab === "withdraw" && (
            <div className="space-y-4">
              <div className="rounded-xl border border-[oklch(0.22_0.015_255)] bg-[oklch(0.145_0.014_255)] p-4 text-xs space-y-3">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                  <span className="text-muted-foreground">Available pUSD</span>
                  <span className="min-w-0 max-w-full truncate text-right font-mono text-foreground">{formatPusd(collateralBalance)}</span>
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                  <span className="text-muted-foreground">Trading allowance</span>
                  <span className="min-w-0 max-w-full truncate text-right font-mono text-foreground">{formatPusdAllowance(collateralAllowance)}</span>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleRefreshCollateral}
                  disabled={!collateralSessionReady || refreshingCollateral || !onRefreshCollateralBalance}
                  className="h-8 w-full gap-2 text-[10px] font-bold uppercase tracking-widest"
                >
                  <RefreshCw className={cn("h-3 w-3", refreshingCollateral && "animate-spin")} />
                  Refresh pUSD balance
                </Button>
                {!collateralSessionReady && !depositWalletWithdrawMode ? (
                  <p className="text-[11px] leading-snug text-[oklch(0.78_0.16_82)]">
                    Prepare the CLOB session first so Rawali can read your live Polymarket pUSD balance before withdrawal.
                  </p>
                ) : !hasKnownWithdrawBalance ? (
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    Refresh your pUSD balance before entering a withdrawal amount.
                  </p>
                ) : withdrawBalanceAmount <= 0 ? (
                  <p className="text-[11px] leading-snug text-[oklch(0.74_0.14_25)]">
                    No withdrawable pUSD balance is currently loaded for this trading wallet.
                  </p>
                ) : !canSubmitWithdrawTransfer ? (
                  <p className="text-[11px] leading-snug text-[oklch(0.74_0.14_25)]">
                    Connect the wallet that controls this Polymarket trading wallet to send pUSD into the withdrawal route.
                  </p>
                ) : depositWalletWithdrawMode ? (
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    Enter an amount or choose Max. Rawali will relay the Polygon pUSD transfer after your wallet signs.
                  </p>
                ) : (
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    Enter an amount or choose Max. Errors and wallet messages stay below the form.
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Withdraw amount</label>
                  <Input
                    value={withdrawAmount}
                    onChange={(event) => handleWithdrawAmountChange(event.target.value)}
                    inputMode="decimal"
                    placeholder="pUSD amount"
                    className="h-11 border-[oklch(0.22_0.015_255)] bg-[oklch(0.16_0.014_255)]"
                  />
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => handleWithdrawAmountChange(formatTokenAmount(withdrawBalanceAmount))}
                  disabled={!hasKnownWithdrawBalance || withdrawBalanceAmount <= 0}
                  className="h-11 self-end px-4 text-[10px] font-bold uppercase tracking-widest"
                >
                  Max
                </Button>
              </div>

              <div
                aria-live="polite"
                className={cn(
                  "flex min-h-[44px] items-start rounded-lg border p-2.5 text-[11px] leading-snug transition-colors",
                  withdrawMessage
                    ? "border-[oklch(0.58_0.2_25/0.35)] bg-[oklch(0.58_0.2_25/0.08)] text-[oklch(0.74_0.14_25)]"
                    : "border-transparent bg-transparent text-transparent"
                )}
              >
                <span className="line-clamp-2">{withdrawMessage || "No withdrawal message."}</span>
              </div>

              {(withdrawGasAssist.loading || withdrawGasAssist.status?.eligible || withdrawGasAssist.error) ? (
                <div className="space-y-2">
                  <div className="rounded-lg border border-[oklch(0.78_0.16_82/0.25)] bg-[oklch(0.78_0.16_82/0.08)] p-2.5 text-[11px] leading-snug text-[oklch(0.78_0.16_82)]">
                    {withdrawGasAssist.loading && !withdrawGasAssist.status
                      ? "Checking Polygon gas before withdrawal..."
                      : withdrawGasAssist.status?.eligible
                      ? `This wallet has pUSD but no Polygon gas. Rawali will send ${withdrawGasAssist.status.topupPol} POL before withdrawal.`
                      : withdrawGasAssist.error ?? "Polygon gas assist is not currently available."}
                  </div>
                  {withdrawGasAssist.status?.eligible ? (
                    <Button
                      type="button"
                      onClick={async () => {
                        const result = await withdrawGasAssist.requestAssist("withdraw_pusd")
                        if (result?.recentTxHash || result?.txHash) {
                          await withdrawGasAssist.refresh()
                          await handleRefreshCollateral()
                        }
                      }}
                      disabled={withdrawGasAssist.requesting}
                      className="h-9 w-full gap-2 border border-[oklch(0.78_0.16_82/0.35)] bg-[oklch(0.78_0.16_82/0.1)] text-[oklch(0.78_0.16_82)] hover:bg-[oklch(0.78_0.16_82/0.16)] text-xs font-semibold"
                    >
                      {withdrawGasAssist.requesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Fuel className="h-3.5 w-3.5" />}
                      {withdrawGasAssist.requesting ? "Sending POL..." : "Get Polygon Gas Assist"}
                    </Button>
                  ) : null}
                </div>
              ) : null}

              <div className="rounded-xl border border-[oklch(0.78_0.16_82/0.2)] bg-[oklch(0.78_0.16_82/0.06)] p-4 text-xs space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">From (Polymarket trading wallet)</span>
                  <span className="font-mono text-foreground">{shortAddress(profile?.tradingWalletAddress)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">To (Connected BNB wallet)</span>
                  <span className="font-mono text-foreground">{shortAddress(wallet?.address)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Receive as</span>
                  <span className="font-semibold text-[oklch(0.78_0.16_82)]">USDT on BNB Chain</span>
                </div>
              </div>

              <p className="text-[11px] leading-snug text-muted-foreground">
                Rawali first creates a Polymarket withdrawal route, then your wallet sends the selected pUSD amount to that route on Polygon. The bridge returns it to your connected BNB wallet as USDT.
              </p>

              {withdrawStatus === "done" && withdrawResult && (
                <div className="rounded-xl border border-[oklch(0.68_0.18_155/0.35)] bg-[oklch(0.68_0.18_155/0.08)] p-4 text-xs space-y-2">
                  <span className="block text-[10px] font-bold uppercase tracking-widest text-[oklch(0.68_0.18_155)]">
                    Withdrawal transfer sent
                  </span>
                  <p className="text-muted-foreground leading-snug">
                    {withdrawResult.amount ? `${withdrawResult.amount} pUSD was sent to the Polymarket withdrawal route. ` : ""}
                    Funds typically arrive within 10–30 minutes depending on bridge congestion.
                  </p>
                  {withdrawResult.txHash && (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">TX Hash</span>
                      <span className="font-mono text-foreground">{shortAddress(withdrawResult.txHash)}</span>
                    </div>
                  )}
                  {withdrawResult.withdrawalAddress && (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">Route</span>
                      <span className="font-mono text-foreground">{shortAddress(withdrawResult.withdrawalAddress)}</span>
                    </div>
                  )}
                </div>
              )}

              <Button
                type="button"
                onClick={handleWithdraw}
                disabled={withdrawDisabled}
                className="w-full h-10 gap-2 bg-[oklch(0.78_0.16_82)] text-[oklch(0.12_0.01_255)] hover:bg-[oklch(0.82_0.16_82)] font-semibold"
              >
                {withdrawStatus !== "idle" && withdrawStatus !== "error" && withdrawStatus !== "done" ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : withdrawStatus === "done" ? (
                  <Send className="w-4 h-4" />
                ) : (
                  <Route className="w-4 h-4" />
                )}
                {withdrawStatus === "preparing"
                  ? "Preparing withdrawal route..."
                  : withdrawStatus === "switching"
                  ? depositWalletWithdrawMode
                    ? "Preparing relayed transfer..."
                    : "Switching to Polygon..."
                  : withdrawStatus === "sending"
                  ? depositWalletWithdrawMode
                    ? "Sign withdrawal..."
                    : "Confirm pUSD transfer..."
                  : withdrawStatus === "confirming"
                  ? depositWalletWithdrawMode
                    ? "Relaying transfer..."
                    : "Confirming transfer..."
                  : withdrawStatus === "done"
                  ? "Withdrawal transfer sent ✓"
                  : "Withdraw pUSD"}
              </Button>
            </div>
          )}

          {activeTab === "deposit" && (<>
          <div className="rounded-xl border border-[oklch(0.22_0.015_255)] bg-[oklch(0.145_0.014_255)] p-4 text-xs">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Route quote</div>
                <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                  Preview bridge output and timing before sending assets to the deposit address.
                </p>
              </div>
              <Button type="button" onClick={handleQuote} disabled={quoteDisabled} variant="secondary" className="gap-2">
                {quoteLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Route className="h-4 w-4" />}
                Get quote
              </Button>
            </div>

            {invalidAmount || amountBelowMin ? (
              <p className="mt-3 text-[11px] leading-snug text-[oklch(0.74_0.14_25)]">
                {invalidAmount ? "Enter a valid positive amount." : `Minimum estimated value is $${minCheckoutUsd} for this stable asset.`}
              </p>
            ) : null}

            {quote ? (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-[oklch(0.12_0.012_260)] p-2">
                  <span className="block text-[10px] text-muted-foreground">Input value</span>
                  <span className="font-mono text-foreground">{formatUsd(quote.estInputUsd)}</span>
                </div>
                <div className="rounded-lg bg-[oklch(0.12_0.012_260)] p-2">
                  <span className="block text-[10px] text-muted-foreground">Output value</span>
                  <span className="font-mono text-foreground">{formatUsd(quote.estOutputUsd)}</span>
                </div>
                <div className="rounded-lg bg-[oklch(0.12_0.012_260)] p-2">
                  <span className="block text-[10px] text-muted-foreground">ETA</span>
                  <span className="font-mono text-foreground">{formatDuration(quote.estCheckoutTimeMs)}</span>
                </div>
                <div className="rounded-lg bg-[oklch(0.12_0.012_260)] p-2">
                  <span className="block text-[10px] text-muted-foreground">Gas est.</span>
                  <span className="font-mono text-foreground">{formatUsd(Number(quote.estFeeBreakdown?.gasUsd))}</span>
                </div>
              </div>
            ) : null}
          </div>

          <div className="rounded-xl border border-[oklch(0.78_0.16_82/0.2)] bg-[oklch(0.78_0.16_82/0.07)] p-4">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="text-muted-foreground">Deposit address</span>
              <span className="font-mono text-foreground">{shortAddress(depositAddress)}</span>
            </div>
            {depositAddress ? (
              <div className="mt-3 rounded-lg border border-[oklch(0.22_0.015_255)] bg-[oklch(0.10_0.012_260)] p-3 font-mono text-[11px] leading-relaxed text-muted-foreground break-all">
                {depositAddress}
              </div>
            ) : null}

            <div className="mt-3 flex flex-col sm:flex-row gap-2">
              {!depositAddress ? (
                <Button onClick={handlePrepareAddress} disabled={!profile || loadingDeposit} className="gap-2">
                  <Wallet className="w-4 h-4" />
                  {loadingDeposit ? "Preparing" : "Prepare address"}
                </Button>
              ) : (
                <>
                  <Button onClick={handleSendFromWallet} disabled={sendDisabled} className="gap-2">
                    {sendStatus === "sending" || sendStatus === "confirming" || sendStatus === "switching" ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                    {sendLabel}
                  </Button>
                  <Button onClick={copyDepositAddress} variant="secondary" className="gap-2">
                    <Copy className="w-4 h-4" />
                    Copy address
                  </Button>
                </>
              )}
              <Button onClick={fundingStatus.refresh} variant="secondary" disabled={!depositAddress || fundingStatus.loading} className="gap-2">
                <RefreshCw className={cn("w-4 h-4", fundingStatus.loading && "animate-spin")} />
                Refresh status
              </Button>
            </div>
          </div>

          <div className="rounded-xl border border-[oklch(0.22_0.015_255)] bg-[oklch(0.145_0.014_255)] p-4 text-xs">
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Latest status</span>
              <span className={cn("font-semibold", fundingStatusTone(fundingStatus.phase))}>{fundingStatus.label}</span>
            </div>
            <p className="mt-2 text-[11px] leading-snug text-muted-foreground">{fundingStatus.message}</p>
            {latestTransaction?.txHash ? (
              <div className="mt-2 flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Transaction</span>
                <span className="font-mono text-foreground">{shortAddress(latestTransaction.txHash)}</span>
              </div>
            ) : null}
            {fundingStatus.transactions.length ? (
              <div className="mt-2 flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Tracked deposits</span>
                <span className="font-mono text-foreground">{fundingStatus.transactions.length}</span>
              </div>
            ) : null}
          </div>

          <div
            aria-live="polite"
            className={cn(
              "flex min-h-[44px] items-start rounded-lg border p-2.5 text-[11px] leading-snug transition-colors",
              depositMessageTone === "error"
                ? "border-[oklch(0.58_0.2_25/0.35)] bg-[oklch(0.58_0.2_25/0.08)] text-[oklch(0.74_0.14_25)]"
                : depositMessageTone === "info"
                ? "border-[oklch(0.78_0.16_82/0.24)] bg-[oklch(0.78_0.16_82/0.06)] text-muted-foreground"
                : "border-transparent bg-transparent text-transparent"
            )}
          >
            <span className="line-clamp-2">{depositMessage || "No funding message."}</span>
          </div>
          </>)}
        </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
