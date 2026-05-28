"use client"

import { useCallback, useState } from "react"
import type { ConnectedWallet } from "@privy-io/react-auth"

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000"
const POLYGON_CHAIN_ID = 137
const POLYGON_CHAIN_HEX = "0x89"
const POLYGON_RPC_URLS = [
  ...(process.env.NEXT_PUBLIC_POLYGON_RPC_URL ?? "https://polygon-rpc.com")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean),
  "https://rpc.ankr.com/polygon",
  "https://polygon.publicnode.com",
].filter((url, index, urls) => urls.indexOf(url) === index)

type ApprovalStatus = "idle" | "preparing" | "signing" | "submitting" | "approved" | "error"

type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
}

type SwitchableWallet = ConnectedWallet & {
  switchChain?: (chainId: number) => Promise<void>
}

type ApprovalState = {
  status: ApprovalStatus
  error: string | null
  result: any
  approve: () => Promise<boolean>
}

function approvalErrorMessage(error?: string) {
  switch (error) {
    case "stale_deposit_wallet_batch":
      return "This approval request expired or was already used. Try approving again."
    case "expired_deposit_wallet_batch":
      return "This approval signature expired. Try approving again."
    case "deposit_wallet_batch_mismatch":
      return "Approval payload changed before submission. Refresh and try again."
    case "deposit_wallet_owner_mismatch":
      return "This deposit wallet does not belong to the connected wallet."
    case "deposit_wallet_not_deployed":
      return "Deploy the Polymarket deposit wallet before approving trading permissions."
    case "deposit_wallet_deadline_too_soon":
      return "The relayer needs a longer approval window. Try approving again."
    case "deposit_wallet_signature_owner_mismatch":
      return "The wallet signed from a different active account. Open your wallet, select the Rawli connected address, and approve again."
    case "builder_relayer_not_configured":
      return "Relayer credentials are not configured on the backend."
    case "deposit_wallet_approval_submit_failed":
      return "The relayer rejected the approval batch. Try again in a moment."
    default:
      return error || "Deposit wallet approval failed."
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function waitForChain(provider: Eip1193Provider, targetHex: string, attempts = 15) {
  for (let i = 0; i < attempts; i++) {
    const id = await provider.request({ method: "eth_chainId" }).catch(() => null)
    if (String(id).toLowerCase() === targetHex) return true
    await sleep(250)
  }
  return false
}

async function ensurePolygon(wallet: ConnectedWallet): Promise<Eip1193Provider> {
  const switchable = wallet as SwitchableWallet
  let provider = (await wallet.getEthereumProvider()) as Eip1193Provider
  const chainId = await provider.request({ method: "eth_chainId" }).catch(() => null)
  if (String(chainId).toLowerCase() === POLYGON_CHAIN_HEX) return provider

  // Strategy 1: Use Privy's native switchChain
  if (typeof switchable.switchChain === "function") {
    try {
      await switchable.switchChain(POLYGON_CHAIN_ID)
      await sleep(500)
      provider = (await wallet.getEthereumProvider()) as Eip1193Provider
      if (await waitForChain(provider, POLYGON_CHAIN_HEX)) return provider
    } catch {
      // Fall through to EIP-1193
    }
  }

  // Strategy 2: EIP-1193 wallet_switchEthereumChain
  provider = (await wallet.getEthereumProvider()) as Eip1193Provider
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: POLYGON_CHAIN_HEX }],
    })
    await sleep(300)
    provider = (await wallet.getEthereumProvider()) as Eip1193Provider
    if (await waitForChain(provider, POLYGON_CHAIN_HEX)) return provider
  } catch {
    // Try adding the chain first
    try {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: POLYGON_CHAIN_HEX,
          chainName: "Polygon",
          nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
          rpcUrls: POLYGON_RPC_URLS,
          blockExplorerUrls: ["https://polygonscan.com"],
        }],
      })
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: POLYGON_CHAIN_HEX }],
      })
      await sleep(300)
      provider = (await wallet.getEthereumProvider()) as Eip1193Provider
      if (await waitForChain(provider, POLYGON_CHAIN_HEX)) return provider
    } catch {
      // Fall through to error
    }
  }

  throw new Error("Could not switch wallet to Polygon for deposit wallet approval.")
}

export function useDepositWalletApproval(
  owner?: string | null,
  depositWallet?: string | null,
  wallet?: ConnectedWallet | null,
  onApproved?: () => Promise<void> | void
): ApprovalState {
  const [status, setStatus] = useState<ApprovalStatus>("idle")
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<any>(null)

  const approve = useCallback(async () => {
    if (!owner || !depositWallet || !wallet) {
      setError("Connect a wallet before approving trading permissions.")
      setStatus("error")
      return false
    }

    setError(null)
    setResult(null)
    try {
      setStatus("preparing")
      const prepareRes = await fetch(`${API_BASE}/deposit-wallet/approval/prepare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner, depositWallet }),
      })
      const prepared = await prepareRes.json()
      if (!prepareRes.ok || prepared?.ok === false) {
        throw new Error(approvalErrorMessage(prepared?.error ?? "Unable to prepare deposit wallet approval."))
      }

      setStatus("signing")
      const provider = await ensurePolygon(wallet)
      const signature = await provider.request({
        method: "eth_signTypedData_v4",
        params: [owner, JSON.stringify(prepared.typedData)],
      }) as string

      setStatus("submitting")
      const submitRes = await fetch(`${API_BASE}/deposit-wallet/approval/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner,
          depositWallet,
          nonce: prepared.nonce,
          deadline: prepared.deadline,
          calls: prepared.calls,
          signature,
        }),
      })
      const submitted = await submitRes.json()
      if (!submitRes.ok || submitted?.ok === false) {
        throw new Error(approvalErrorMessage(submitted?.error))
      }

      setResult(submitted)
      setStatus("approved")
      await onApproved?.()
      return true
    } catch (err: any) {
      setError(err?.message ?? "Deposit wallet approval failed.")
      setStatus("error")
      return false
    }
  }, [owner, depositWallet, wallet, onApproved])

  return { status, error, result, approve }
}
