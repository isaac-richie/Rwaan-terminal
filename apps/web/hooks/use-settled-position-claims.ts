"use client"

import { useCallback, useState } from "react"
import type { ConnectedWallet } from "@privy-io/react-auth"
import type { TradingWalletKind } from "@smartmarket/types"
import { BrowserProvider, Contract } from "ethers"
import {
  getPositionValue,
  isPortfolioPositionClosed,
} from "@/hooks/use-polymarket-portfolio"

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000"
const POLYGON_CHAIN_ID = 137
const POLYGON_CHAIN_HEX = "0x89"
const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000"
const PUSD_CONTRACT = "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB"
const CONDITIONAL_TOKENS_CONTRACT = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045"
const CTF_COLLATERAL_ADAPTER = "0xAdA100Db00Ca00073811820692005400218FcE1f"
const NEG_RISK_CTF_COLLATERAL_ADAPTER = "0xadA2005600Dec949baf300f4C6120000bDB6eAab"
const REDEEM_INDEX_SETS = [1, 2]
const POLYGON_RPC_URLS = [
  ...(process.env.NEXT_PUBLIC_POLYGON_RPC_URL ?? "https://polygon-rpc.com")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean),
  "https://rpc.ankr.com/polygon",
  "https://polygon.publicnode.com",
  "https://polygon.drpc.org",
].filter((url, index, urls) => urls.indexOf(url) === index)

const CONDITIONAL_TOKENS_ABI = [
  "function isApprovedForAll(address account, address operator) view returns (bool)",
  "function setApprovalForAll(address operator, bool approved)",
]

const REDEEM_ADAPTER_ABI = [
  "function redeemPositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] indexSets)",
]

const POLYGON_CHAIN_PARAMS = {
  chainId: POLYGON_CHAIN_HEX,
  chainName: "Polygon",
  nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
  rpcUrls: POLYGON_RPC_URLS,
  blockExplorerUrls: ["https://polygonscan.com"],
}

type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
}

type SwitchableWallet = ConnectedWallet & {
  switchChain?: (chainId: number) => Promise<void>
}

export type ClaimStatus = "idle" | "preparing" | "signing" | "approving" | "claiming" | "confirming" | "claimed" | "error"

export type ClaimablePositionGroup = {
  key: string
  conditionId: string
  negRisk: boolean
  title: string
  outcome: string
  value: number
  size: number
  positions: any[]
}

type ClaimOptions = {
  wallet?: ConnectedWallet | null
  ownerAddress?: string | null
  tradingWalletAddress?: string | null
  tradingWalletKind?: TradingWalletKind | null
  onClaimed?: () => Promise<void> | void
}

type ClaimResult = {
  txHash?: string
  transactionID?: string
  relayed?: boolean
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function firstNumber(...values: any[]) {
  for (const value of values) {
    if (value === undefined || value === null || value === "") continue
    const numeric = Number(value)
    if (Number.isFinite(numeric)) return numeric
  }
  return 0
}

function normalizedText(value: any) {
  return typeof value === "string" ? value.trim().toLowerCase() : ""
}

function normalizePrice(value: any) {
  const numeric = firstNumber(value)
  if (!numeric) return 0
  return numeric > 1 ? numeric / 100 : numeric
}

function normalizeConditionId(value: any) {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return /^0x[a-fA-F0-9]{64}$/.test(trimmed) ? trimmed : null
}

function positionTitle(position: any) {
  return position?.title ?? position?.market ?? position?.question ?? position?.event ?? position?.conditionId ?? position?.condition_id ?? "Settled position"
}

function positionOutcome(position: any) {
  return position?.outcome ?? position?.outcomeName ?? position?.outcome_name ?? position?.assetName ?? position?.asset_name ?? "Outcome"
}

export function resolvePositionConditionId(position: any) {
  return normalizeConditionId(
    position?.conditionId ??
    position?.condition_id ??
    position?.marketConditionId ??
    position?.market_condition_id
  )
}

function positionNegRisk(position: any) {
  return Boolean(
    position?.negRisk ??
    position?.neg_risk ??
    position?.negativeRisk ??
    position?.negative_risk ??
    position?.market?.negRisk ??
    position?.market?.neg_risk ??
    position?.market?.negativeRisk ??
    position?.market?.negative_risk
  )
}

function positionRedeemed(position: any) {
  return Boolean(position?.redeemed || normalizedText(position?.status).includes("redeemed"))
}

export function getClaimablePositionValue(position: any) {
  if (!position || positionRedeemed(position)) return 0
  const closed = isPortfolioPositionClosed(position)
  const redeemable = Boolean(position?.redeemable)
  if (!closed && !redeemable) return 0

  const explicit = firstNumber(
    position?.claimable,
    position?.claimableValue,
    position?.claimable_value,
    position?.redeemableValue,
    position?.redeemable_value,
    position?.payout,
    position?.payoutValue,
    position?.payout_value
  )
  if (explicit > 0) return explicit

  const value = getPositionValue(position)
  if (value > 0) return value

  const size = firstNumber(position?.size, position?.position_size, position?.shares)
  const currentPrice = normalizePrice(position?.curPrice ?? position?.cur_price ?? position?.current_price ?? position?.price)
  if ((redeemable || currentPrice >= 0.995) && size > 0) return size

  return 0
}

export function groupClaimablePositions(positions: any[] | undefined): ClaimablePositionGroup[] {
  const groups = new Map<string, ClaimablePositionGroup>()

  for (const position of positions ?? []) {
    const conditionId = resolvePositionConditionId(position)
    const value = getClaimablePositionValue(position)
    if (!conditionId || value <= 0) continue

    const negRisk = positionNegRisk(position)
    const key = `${negRisk ? "neg" : "std"}:${conditionId.toLowerCase()}`
    const existing = groups.get(key)
    const size = firstNumber(position?.size, position?.position_size, position?.shares)

    if (existing) {
      existing.value += value
      existing.size += size
      existing.positions.push(position)
    } else {
      groups.set(key, {
        key,
        conditionId,
        negRisk,
        title: positionTitle(position),
        outcome: positionOutcome(position),
        value,
        size,
        positions: [position],
      })
    }
  }

  return [...groups.values()].sort((a, b) => b.value - a.value)
}

function claimErrorMessage(err: any) {
  const raw = err?.shortMessage ?? err?.reason ?? err?.message ?? String(err ?? "")
  const normalized = raw.toLowerCase()
  if (normalized.includes("user rejected") || normalized.includes("rejected by wallet") || err?.code === 4001) {
    return "Claim rejected in wallet."
  }
  // Route/endpoint missing on the server (stale deploy) — was previously a cryptic "Not Found".
  if (normalized.includes("claim_endpoint_unavailable") || normalized === "not found" || normalized.includes("route post")) {
    return "Settlement claiming is temporarily unavailable. Your winnings are safe — please try again shortly."
  }
  if (normalized.includes("unknown connector error") || normalized.includes("connector")) {
    return "Wallet connector could not complete the claim. Reopen your wallet, approve Polygon, then try again."
  }
  if (normalized.includes("insufficient funds")) {
    return "Wallet needs a little POL on Polygon to claim settled positions."
  }
  if (normalized.includes("deposit_wallet_not_deployed")) {
    return "Deploy the Polymarket deposit wallet before claiming from it."
  }
  if (normalized.includes("builder_relayer_not_configured")) {
    return "Relayed deposit-wallet claims are not configured on the backend."
  }
  if (normalized.includes("signature")) {
    return "Claim signature could not be verified. Refresh, sign a fresh claim, and try again."
  }
  if (normalized.includes("deposit_wallet")) {
    return "Deposit-wallet claim failed. Refresh the portfolio and try again."
  }
  if (normalized.includes("execution reverted") || normalized.includes("call exception")) {
    return "Claim transaction reverted. The market may still be finalizing or this position may already be redeemed."
  }
  if (!raw || raw === "[object Object]") return "Claim failed. Try again in a moment."
  return raw.length > 220 ? `${raw.slice(0, 220)}...` : raw
}

async function waitForChain(provider: Eip1193Provider, attempts = 15) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const chainId = await provider.request({ method: "eth_chainId" }).catch(() => null)
    if (String(chainId).toLowerCase() === POLYGON_CHAIN_HEX) return true
    await sleep(250)
  }
  return false
}

async function ensurePolygon(wallet: ConnectedWallet): Promise<Eip1193Provider> {
  const switchable = wallet as SwitchableWallet
  let provider = (await wallet.getEthereumProvider()) as Eip1193Provider
  const currentChain = await provider.request({ method: "eth_chainId" }).catch(() => null)
  if (String(currentChain).toLowerCase() === POLYGON_CHAIN_HEX) return provider

  if (typeof switchable.switchChain === "function") {
    try {
      await switchable.switchChain(POLYGON_CHAIN_ID)
      await sleep(500)
      provider = (await wallet.getEthereumProvider()) as Eip1193Provider
      if (await waitForChain(provider)) return provider
    } catch {
      // Fall back to EIP-1193 switching below.
    }
  }

  provider = (await wallet.getEthereumProvider()) as Eip1193Provider
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: POLYGON_CHAIN_HEX }],
    })
  } catch (err: any) {
    const code = Number(err?.code ?? err?.data?.code)
    if (code !== 4902) throw err
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [POLYGON_CHAIN_PARAMS],
    })
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: POLYGON_CHAIN_HEX }],
    })
  }

  await sleep(300)
  provider = (await wallet.getEthereumProvider()) as Eip1193Provider
  if (!(await waitForChain(provider))) {
    throw new Error("Rawli could not activate Polygon for claiming.")
  }
  return provider
}

function shouldUseRelayedClaim(options: ClaimOptions) {
  const owner = options.ownerAddress?.toLowerCase()
  const trading = options.tradingWalletAddress?.toLowerCase()
  return Boolean(owner && trading && owner !== trading && options.tradingWalletKind === "deposit")
}

export function useSettledPositionClaims(options: ClaimOptions) {
  const [status, setStatus] = useState<ClaimStatus>("idle")
  const [error, setError] = useState<string | null>(null)
  const [claimingKey, setClaimingKey] = useState<string | null>(null)

  const claim = useCallback(async (group: ClaimablePositionGroup): Promise<ClaimResult | null> => {
    if (!options.wallet || !options.ownerAddress || !options.tradingWalletAddress) {
      setStatus("error")
      setError("Connect wallet before claiming settled positions.")
      return null
    }

    setError(null)
    setClaimingKey(group.key)

    try {
      if (shouldUseRelayedClaim(options)) {
        setStatus("preparing")
        const provider = await ensurePolygon(options.wallet)
        const prepareRes = await fetch(`${API_BASE}/deposit-wallet/claim/prepare`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            owner: options.ownerAddress,
            depositWallet: options.tradingWalletAddress,
            conditionId: group.conditionId,
            negRisk: group.negRisk,
          }),
        })
        const prepared = await prepareRes.json().catch(() => ({}))
        // A 404 here means the API doesn't expose the claim route (e.g. a stale
        // deploy that predates it) — surface a clear message, not a raw "Not Found".
        if (prepareRes.status === 404) {
          throw new Error("claim_endpoint_unavailable")
        }
        if (!prepareRes.ok || prepared?.ok === false) {
          throw new Error(prepared?.error ?? "Unable to prepare deposit wallet claim.")
        }

        setStatus("signing")
        const signature = await provider.request({
          method: "eth_signTypedData_v4",
          params: [options.ownerAddress, JSON.stringify(prepared.typedData)],
        }) as string

        setStatus("confirming")
        const submitRes = await fetch(`${API_BASE}/deposit-wallet/claim/submit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            owner: options.ownerAddress,
            depositWallet: options.tradingWalletAddress,
            conditionId: group.conditionId,
            negRisk: group.negRisk,
            nonce: prepared.nonce,
            deadline: prepared.deadline,
            calls: prepared.calls,
            signature,
          }),
        })
        const submitted = await submitRes.json().catch(() => ({}))
        if (submitRes.status === 404) {
          throw new Error("claim_endpoint_unavailable")
        }
        if (!submitRes.ok || submitted?.ok === false) {
          throw new Error(submitted?.error ?? "Deposit wallet claim submit failed.")
        }

        setStatus("claimed")
        await options.onClaimed?.()
        return {
          relayed: true,
          txHash: submitted.transactionHash ?? submitted.hash,
          transactionID: submitted.transactionID,
        }
      }

      setStatus("approving")
      const provider = await ensurePolygon(options.wallet)
      const ethersProvider = new BrowserProvider(provider as any)
      const signer = await ethersProvider.getSigner()
      const signerAddress = (await signer.getAddress()).toLowerCase()
      const tradingAddress = options.tradingWalletAddress.toLowerCase()
      if (signerAddress !== tradingAddress) {
        throw new Error("Switch to the wallet that holds this Polymarket position before claiming.")
      }

      const adapter = group.negRisk ? NEG_RISK_CTF_COLLATERAL_ADAPTER : CTF_COLLATERAL_ADAPTER
      const conditionalTokens = new Contract(CONDITIONAL_TOKENS_CONTRACT, CONDITIONAL_TOKENS_ABI, signer)
      const approved = await conditionalTokens.isApprovedForAll(signerAddress, adapter)
      if (!approved) {
        const approvalTx = await conditionalTokens.setApprovalForAll(adapter, true)
        await approvalTx.wait(1)
      }

      setStatus("claiming")
      const adapterContract = new Contract(adapter, REDEEM_ADAPTER_ABI, signer)
      const tx = await adapterContract.redeemPositions(PUSD_CONTRACT, ZERO_BYTES32, group.conditionId, REDEEM_INDEX_SETS)
      setStatus("confirming")
      const receipt = await tx.wait(1)

      setStatus("claimed")
      await options.onClaimed?.()
      return { txHash: receipt?.hash ?? tx.hash, relayed: false }
    } catch (err: any) {
      setStatus("error")
      setError(claimErrorMessage(err))
      return null
    } finally {
      setClaimingKey(null)
    }
  }, [options])

  return {
    claim,
    status,
    error,
    claimingKey,
    relayedMode: shouldUseRelayedClaim(options),
    busy: status === "preparing" || status === "signing" || status === "approving" || status === "claiming" || status === "confirming",
  }
}
