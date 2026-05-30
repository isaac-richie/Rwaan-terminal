"use client"

import { useEffect, useRef, useState } from "react"
import { BrowserProvider } from "ethers"
import {
  AssetType,
  Chain,
  ClobClient,
  OrderType,
  Side,
  SignatureTypeV2,
  createL2Headers,
  isV2Order,
  type ApiKeyCreds,
  type OpenOrder,
  type OpenOrderParams,
  type SignedOrder,
} from "@polymarket/clob-client-v2"
import type { TradingProfile } from "@smartmarket/types"
import type { ConnectedWallet } from "@privy-io/react-auth"
import { extractErrorText, friendlyErrorMessage } from "@/lib/friendly-errors"

const CLOB_HOST = "https://clob.polymarket.com"
const POLYGON_CHAIN_ID = 137
const CLOB_CHAIN = Chain.POLYGON
const POLYGON_CHAIN_HEX = "0x89"
const DEFAULT_CLOB_NONCE = 0
const SESSION_STORAGE_KEY = "rawli.clob_session"
const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000"
const BUILDER_CODE = process.env.NEXT_PUBLIC_POLYMARKET_BUILDER_CODE?.trim()
const PUSD_CONTRACT = "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB"
const CONDITIONAL_TOKENS_CONTRACT = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045"
const CLOB_OPERATORS = [
  "0xE111180000d2663C0091e4f400237545B87B996B",
  "0xe2222d279d744050d28e00520010520000310F59",
  "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296",
]
const MAX_UINT256 = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
const POLYGON_RPC_URLS = [
  ...(process.env.NEXT_PUBLIC_POLYGON_RPC_URL ?? "https://polygon-rpc.com")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean),
  "https://rpc.ankr.com/polygon",
  "https://polygon.publicnode.com",
  "https://polygon.drpc.org",
].filter((url, index, urls) => urls.indexOf(url) === index)

type StoredClobSession = {
  walletAddress: string
  key: string
  secret: string
  passphrase: string
  signatureType: number
  funderAddress?: string
  storedAt: number
}

/** Session TTL — 23 hours. CLOB API keys last 24h, so we expire slightly early. */
const SESSION_TTL_MS = 23 * 60 * 60 * 1000

function saveSession(session: StoredClobSession) {
  try {
    // Encode the session as base64 so it's not trivially readable in DevTools
    const encoded = btoa(JSON.stringify(session))
    sessionStorage.setItem(SESSION_STORAGE_KEY, encoded)
  } catch {
    // sessionStorage may be unavailable in some contexts
  }
}

function loadSession(walletAddress: string, expectedSignatureType?: number, expectedFunderAddress?: string): StoredClobSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY)
    if (!raw) return null
    const decoded = JSON.parse(atob(raw)) as StoredClobSession
    if (decoded.walletAddress?.toLowerCase() !== walletAddress.toLowerCase()) return null
    if (expectedSignatureType !== undefined && Number(decoded.signatureType) !== expectedSignatureType) return null
    const storedFunder = decoded.funderAddress?.toLowerCase() ?? ""
    const expectedFunder = expectedFunderAddress?.toLowerCase() ?? ""
    if (storedFunder !== expectedFunder) return null
    if (Date.now() - decoded.storedAt > SESSION_TTL_MS) {
      sessionStorage.removeItem(SESSION_STORAGE_KEY)
      return null
    }
    return decoded
  } catch {
    return null
  }
}

function clearStoredSession() {
  try {
    sessionStorage.removeItem(SESSION_STORAGE_KEY)
  } catch {
    // noop
  }
}
const POLYGON_CHAIN_PARAMS = {
  chainId: POLYGON_CHAIN_HEX,
  chainName: "Polygon",
  nativeCurrency: {
    name: "POL",
    symbol: "POL",
    decimals: 18,
  },
  // Multiple RPCs so wallets that validate connectivity have fallbacks
  rpcUrls: POLYGON_RPC_URLS,
  blockExplorerUrls: ["https://polygonscan.com"],
}

type ClobSessionStatus = "idle" | "preparing" | "ready" | "error"
type OrderSubmitStatus = "idle" | "submitting" | "submitted" | "error"
type OrderStatusRefresh = "idle" | "loading" | "ready" | "error"
type OpenOrdersStatus = "idle" | "loading" | "ready" | "error"

type BalanceAllowance = {
  balance: string
  allowance: string
}

type ClobSessionState = {
  status: ClobSessionStatus
  submitStatus: OrderSubmitStatus
  sessionKey: string | null
  balanceAllowance: BalanceAllowance | null
  conditionalBalanceAllowance: BalanceAllowance | null
  signedOrderPreview: SignedOrderPreview | null
  orderSubmission: OrderSubmission | null
  orderStatus: OrderStatusSnapshot | null
  openOrders: OpenOrderSnapshot[]
  openOrdersStatus: OpenOrdersStatus
  orderStatusRefresh: OrderStatusRefresh
  error: string | null
  prepareSession: () => Promise<void>
  refreshBalanceAllowance: () => Promise<void>
  refreshConditionalBalanceAllowance: (tokenId: string) => Promise<BalanceAllowance | null>
  createSignedBuyOrder: (input: SignedBuyOrderInput) => Promise<SignedOrderPreview | null>
  createSignedSellOrder: (input: SignedSellOrderInput) => Promise<SignedOrderPreview | null>
  createSignedLimitOrder: (input: SignedLimitOrderInput) => Promise<SignedOrderPreview | null>
  submitSignedOrder: () => Promise<OrderSubmission | null>
  refreshSubmittedOrder: () => Promise<OrderStatusSnapshot | null>
  refreshOpenOrders: (params?: OpenOrderParams) => Promise<OpenOrderSnapshot[]>
  cancelOpenOrder: (orderId: string) => Promise<boolean>
  createReadinessHeaders: () => Promise<Record<string, string> | null>
  createOrderLookupHeaders: (orderId: string) => Promise<Record<string, string> | null>
  clearSignedOrderPreview: () => void
  approveCollateral: () => Promise<boolean>
  approveConditionalTokens: () => Promise<boolean>
  approvalStatus: ApprovalStatus
}

type SignedBuyOrderInput = {
  tokenId: string
  amountUsd: number
  price?: number | null
  tickSize?: number | null
  negRisk?: boolean
}

type SignedSellOrderInput = {
  tokenId: string
  amountShares: number
  price?: number | null
  tickSize?: number | null
  negRisk?: boolean
}

export type ClobOrderType = "FAK" | "GTC" | "GTD"

type SignedLimitOrderInput = {
  tokenId: string
  side: "BUY" | "SELL"
  /** Conditional-token share size for both BUY and SELL limit orders. */
  amount: number
  /** Limit price in cents (0–100) */
  limitPriceCents: number
  orderType: "GTC" | "GTD"
  /** Required for GTD: Unix timestamp seconds */
  expiresAt?: number
  tickSize?: number | null
  negRisk?: boolean
}

type ApprovalStatus = "idle" | "approving" | "approved" | "error"

export type SignedOrderPreview = {
  tokenId: string
  side: "BUY" | "SELL"
  orderType: "FAK" | "GTC" | "GTD"
  maker: string
  signer: string
  makerAmount: string
  takerAmount: string
  feeRateBps?: string
  nonce?: string
  expiration: string
  timestamp?: string
  metadata?: string
  builder?: string
  signatureType: number
  signaturePreview: string
}

export type OrderSubmission = {
  success: boolean
  orderId?: string
  status?: string
  takingAmount?: string
  makingAmount?: string
  transactionHashes?: string[]
  errorMsg?: string
}

export type OrderStatusSnapshot = {
  id: string
  status?: string
  market?: string
  assetId?: string
  side?: string
  originalSize?: string
  sizeMatched?: string
  price?: string
  outcome?: string
  orderType?: string
}

export type OpenOrderSnapshot = {
  id: string
  status: string
  market?: string
  assetId?: string
  side?: string
  originalSize?: string
  sizeMatched?: string
  price?: string
  outcome?: string
  createdAt?: number
  expiration?: string
  orderType?: string
}

type EthersTypedDataSigner = {
  getAddress: () => Promise<string>
  _signTypedData: (domain: Record<string, unknown>, types: Record<string, Array<{ name: string; type: string }>>, value: Record<string, unknown>) => Promise<string>
}

type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
}

type SwitchablePrivyWallet = ConnectedWallet & {
  switchChain?: (chainId: number) => Promise<void>
}

function signatureTypeFor(profile?: TradingProfile | null) {
  if (profile?.tradingWalletKind === "deposit") return SignatureTypeV2.POLY_1271
  if (profile?.tradingWalletKind === "safe") return SignatureTypeV2.POLY_GNOSIS_SAFE
  if (profile?.tradingWalletKind === "proxy") return SignatureTypeV2.POLY_PROXY
  return SignatureTypeV2.EOA
}

function builderConfig() {
  if (!BUILDER_CODE) return undefined
  if (/^0x[a-fA-F0-9]{64}$/.test(BUILDER_CODE)) return { builderCode: BUILDER_CODE }
  console.warn("[rawli] Ignoring invalid NEXT_PUBLIC_POLYMARKET_BUILDER_CODE. Expected bytes32 hex.")
  return undefined
}

function redactedKey(key?: string) {
  if (!key) return null
  return key.length > 10 ? `${key.slice(0, 6)}...${key.slice(-4)}` : key
}

function normalizeBalanceAllowance(raw: unknown, allowanceMode: "min" | "max" = "min"): BalanceAllowance | null {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
  const allowanceValues = value.allowances && typeof value.allowances === "object"
    ? Object.values(value.allowances as Record<string, unknown>)
    : []
  const selectedAllowance = allowanceValues
    .map((allowance) => {
      try {
        return BigInt(String(allowance))
      } catch {
        return null
      }
    })
    .filter((allowance): allowance is bigint => allowance !== null)
    .reduce<bigint | null>((selected, allowance) => {
      if (selected === null) return allowance
      return allowanceMode === "max"
        ? allowance > selected ? allowance : selected
        : allowance < selected ? allowance : selected
    }, null)
  const allowance =
    value.allowance ??
    (selectedAllowance !== null ? selectedAllowance.toString() : undefined)
  if (value.balance === undefined || allowance === undefined) return null
  return {
    balance: String(value.balance),
    allowance: String(allowance),
  }
}

function isApiKeyCreds(value: unknown): value is ApiKeyCreds {
  const creds = value && typeof value === "object" ? (value as Record<string, unknown>) : {}
  return Boolean(
    typeof creds.key === "string" &&
      typeof creds.secret === "string" &&
      typeof creds.passphrase === "string" &&
      creds.key &&
      creds.secret &&
      creds.passphrase
  )
}

function apiKeyError(value: unknown) {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {}
  return extractErrorText(raw.error) ?? extractErrorText(raw.message)
}

async function createOrDeriveApiKey(client: ClobClient): Promise<ApiKeyCreds> {
  const derived = await client.deriveApiKey(DEFAULT_CLOB_NONCE) as unknown
  if (isApiKeyCreds(derived)) return derived

  const created = await client.createApiKey(DEFAULT_CLOB_NONCE) as unknown
  if (isApiKeyCreds(created)) return created

  const rederived = await client.deriveApiKey(DEFAULT_CLOB_NONCE) as unknown
  if (isApiKeyCreds(rederived)) return rederived

  throw new Error(apiKeyError(created) ?? apiKeyError(rederived) ?? apiKeyError(derived) ?? "Unable to create or derive a Polymarket CLOB API key.")
}

function redactedSignature(signature?: string) {
  if (!signature) return "—"
  return signature.length > 18 ? `${signature.slice(0, 10)}...${signature.slice(-8)}` : signature
}

function toSignedOrderPreview(order: SignedOrder, side: "BUY" | "SELL" = "BUY", orderType: "FAK" | "GTC" | "GTD" = "FAK"): SignedOrderPreview {
  const v2 = isV2Order(order)
  return {
    tokenId: order.tokenId,
    side,
    orderType,
    maker: order.maker,
    signer: order.signer,
    makerAmount: order.makerAmount,
    takerAmount: order.takerAmount,
    feeRateBps: v2 ? undefined : order.feeRateBps,
    nonce: v2 ? undefined : order.nonce,
    expiration: order.expiration,
    timestamp: v2 ? order.timestamp : undefined,
    metadata: v2 ? order.metadata : undefined,
    builder: v2 ? order.builder : undefined,
    signatureType: Number(order.signatureType),
    signaturePreview: redactedSignature(order.signature),
  }
}

function normalizeOrderSubmission(raw: unknown): OrderSubmission {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
  const success = value.success === true
  const errorMsg =
    extractErrorText(value.errorMsg) ??
    extractErrorText(value.error_msg) ??
    extractErrorText(value.error) ??
    extractErrorText(value.message) ??
    extractErrorText(value.reason)
  // Exclude raw HTTP status codes (e.g. "400") from the display status field —
  // they look confusing and the error message already conveys the failure.
  const rawStatus = value.status ? String(value.status) : undefined
  const status = rawStatus && /^\d{3}$/.test(rawStatus) ? undefined : rawStatus
  return {
    success,
    orderId: value.orderID ? String(value.orderID) : value.orderId ? String(value.orderId) : undefined,
    status,
    takingAmount: value.takingAmount ? String(value.takingAmount) : undefined,
    makingAmount: value.makingAmount ? String(value.makingAmount) : undefined,
    transactionHashes: Array.isArray(value.transactionHashes)
      ? value.transactionHashes.map(String)
      : Array.isArray(value.transactionsHashes)
        ? value.transactionsHashes.map(String)
        : undefined,
    errorMsg: errorMsg ?? (success ? undefined : "Order submission failed."),
  }
}

function normalizeOrderStatus(raw: unknown): OrderStatusSnapshot | null {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
  const id = value.id ?? value.orderID ?? value.orderId
  if (!id) return null

  return {
    id: String(id),
    status: value.status ? String(value.status) : undefined,
    market: value.market ? String(value.market) : undefined,
    assetId: value.asset_id ? String(value.asset_id) : value.assetId ? String(value.assetId) : undefined,
    side: value.side ? String(value.side) : undefined,
    originalSize: value.original_size ? String(value.original_size) : value.originalSize ? String(value.originalSize) : undefined,
    sizeMatched: value.size_matched ? String(value.size_matched) : value.sizeMatched ? String(value.sizeMatched) : undefined,
    price: value.price ? String(value.price) : undefined,
    outcome: value.outcome ? String(value.outcome) : undefined,
    orderType: value.order_type ? String(value.order_type) : value.orderType ? String(value.orderType) : undefined,
  }
}

function normalizeOpenOrder(order: OpenOrder): OpenOrderSnapshot {
  return {
    id: String(order.id),
    status: String(order.status ?? ""),
    market: order.market ? String(order.market) : undefined,
    assetId: order.asset_id ? String(order.asset_id) : undefined,
    side: order.side ? String(order.side) : undefined,
    originalSize: order.original_size ? String(order.original_size) : undefined,
    sizeMatched: order.size_matched ? String(order.size_matched) : undefined,
    price: order.price ? String(order.price) : undefined,
    outcome: order.outcome ? String(order.outcome) : undefined,
    createdAt: typeof order.created_at === "number" ? order.created_at : Number(order.created_at),
    expiration: order.expiration ? String(order.expiration) : undefined,
    orderType: order.order_type ? String(order.order_type) : undefined,
  }
}

function stringHeaders(headers: Record<string, string | number | boolean>) {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, String(value)]))
}

function isWrongChainError(err: unknown) {
  const message = err && typeof err === "object" && "message" in err ? String((err as any).message) : String(err ?? "")
  const normalized = message.toLowerCase()
  return normalized.includes("chainid should be same as current chainid") || normalized.includes("current chain")
}

function errorMessage(err: unknown, fallback: string) {
  const raw = extractErrorText(err) ?? ""
  const normalizedRaw = raw.toLowerCase()

  if (normalizedRaw.includes("maker address not allowed") || normalizedRaw.includes("deposit wallet flow")) {
    return "Polymarket rejected this order because the signer is an EOA maker. This market now requires Polymarket Deposit Wallet trading, so Rawli must create/use the user's deposit wallet before live submission."
  }

  if (isWrongChainError(err)) {
    return "Rawli could not activate the Polygon execution context for the Polymarket signature. Approve the network request in your wallet and try again."
  }

  return friendlyErrorMessage(err, fallback, "trade")
}

function isChainMissingError(err: unknown) {
  const code = err && typeof err === "object" && "code" in err ? Number((err as any).code) : undefined
  const dataCode =
    err && typeof err === "object" && "data" in err && (err as any).data && typeof (err as any).data === "object"
      ? Number((err as any).data.code)
      : undefined
  return code === 4902 || dataCode === 4902
}

function userRejectedMessage(err: unknown) {
  const code = err && typeof err === "object" && "code" in err ? Number((err as any).code) : undefined
  if (code === 4001) return "Wallet rejected Rawli's Polygon execution request."
  return null
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function readChainId(provider: Eip1193Provider) {
  const chainId = await provider.request({ method: "eth_chainId" }).catch(() => null)
  return String(chainId ?? "").toLowerCase()
}

async function waitForPolygonChain(provider: Eip1193Provider, maxAttempts = 15, delayMs = 250) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if ((await readChainId(provider)) === POLYGON_CHAIN_HEX) return true
    await sleep(delayMs)
  }
  return false
}

async function ensurePolygonForClob(provider: Eip1193Provider) {
  const currentChain = await provider.request({ method: "eth_chainId" }).catch(() => null)
  if (String(currentChain).toLowerCase() === POLYGON_CHAIN_HEX) return

  // Try switching with retries — Privy embedded wallets can be slow to settle
  for (let retry = 0; retry < 3; retry += 1) {
    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: POLYGON_CHAIN_HEX }],
      })
      // Give the provider extra time to settle after switch
      await sleep(300)
      if (await waitForPolygonChain(provider)) return
    } catch (err) {
      if (isChainMissingError(err)) {
        try {
          await provider.request({
            method: "wallet_addEthereumChain",
            params: [POLYGON_CHAIN_PARAMS],
          })
          await sleep(200)
          await provider.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: POLYGON_CHAIN_HEX }],
          })
          await sleep(300)
          if (await waitForPolygonChain(provider)) return
        } catch (addErr) {
          const addRejection = userRejectedMessage(addErr)
          if (addRejection) throw new Error(addRejection)
          // Fall through to retry
        }
      } else {
        const rejection = userRejectedMessage(err)
        if (rejection) throw new Error(rejection)
        // Non-rejection error — wait and retry
        if (retry < 2) {
          await sleep(500)
          continue
        }
        throw err
      }
    }
  }

  throw new Error("Rawli could not activate Polygon execution context in this wallet.")
}

async function getPolygonProvider(wallet: ConnectedWallet): Promise<Eip1193Provider> {
  const switchableWallet = wallet as SwitchablePrivyWallet
  let provider = (await wallet.getEthereumProvider()) as Eip1193Provider
  const currentChain = await readChainId(provider)

  if (currentChain !== POLYGON_CHAIN_HEX) {
    // Strategy 1: Use Privy's native switchChain (most reliable for embedded wallets)
    if (typeof switchableWallet.switchChain === "function") {
      try {
        await switchableWallet.switchChain(POLYGON_CHAIN_ID)
        // Critical: re-fetch the provider after Privy switch and give it time to settle
        await sleep(500)
        provider = (await wallet.getEthereumProvider()) as Eip1193Provider
        if (await waitForPolygonChain(provider)) {
          return provider
        }
      } catch (err) {
        const rejection = userRejectedMessage(err)
        if (rejection) throw new Error(rejection)
        // Privy switchChain failed non-fatally — fall through to EIP-1193 methods
        console.warn("[rawli] Privy switchChain failed, trying EIP-1193 fallback:", err)
      }
    }

    // Strategy 2: EIP-1193 wallet_switchEthereumChain
    // Re-fetch provider in case Privy's switchChain partially updated state
    provider = (await wallet.getEthereumProvider()) as Eip1193Provider
    await ensurePolygonForClob(provider)

    // Re-fetch provider one final time after EIP-1193 switch
    await sleep(300)
    provider = (await wallet.getEthereumProvider()) as Eip1193Provider
  }

  const activeChain = await provider.request({ method: "eth_chainId" }).catch(() => null)
  if (String(activeChain).toLowerCase() !== POLYGON_CHAIN_HEX) {
    throw new Error("Rawli could not activate Polygon execution context in this wallet.")
  }

  return provider
}

async function getPolygonSigner(wallet: ConnectedWallet) {
  const provider = await getPolygonProvider(wallet)
  const ethersProvider = new BrowserProvider(provider as any)
  const signer = await ethersProvider.getSigner()
  return { provider, signer }
}

/** Create a resilient _signTypedData wrapper that re-acquires Polygon context before every sign attempt */
function createResilientTypedDataSigner(
  wallet: ConnectedWallet,
  baseSigner: { getAddress: () => Promise<string> }
): { signer: EthersTypedDataSigner, refreshSigner: () => Promise<{ provider: Eip1193Provider; signer: any }> } {
  let latestSigner: { provider: Eip1193Provider; signer: any } | null = null

  const refreshSigner = async () => {
    latestSigner = await getPolygonSigner(wallet)
    return latestSigner
  }

  const signer: EthersTypedDataSigner = {
    getAddress: () => baseSigner.getAddress(),
    _signTypedData: async (domain, types, value) => {
      // Always re-acquire Polygon context before signing to avoid stale chain state
      const fresh = await refreshSigner()
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          return await fresh.signer.signTypedData(domain as any, types as any, value as any)
        } catch (err) {
          if (isWrongChainError(err) && attempt < 2) {
            // Chain drifted — re-acquire and retry
            await sleep(300)
            const retried = await refreshSigner()
            try {
              return await retried.signer.signTypedData(domain as any, types as any, value as any)
            } catch (retryErr) {
              if (attempt < 1) continue
              throw retryErr
            }
          }
          throw err
        }
      }
      throw new Error("Rawli could not sign after multiple Polygon context attempts.")
    },
  }

  return { signer, refreshSigner }
}

export function useClobSession(wallet?: ConnectedWallet | null, profile?: TradingProfile | null): ClobSessionState {
  const [status, setStatus] = useState<ClobSessionStatus>("idle")
  const [submitStatus, setSubmitStatus] = useState<OrderSubmitStatus>("idle")
  const [orderStatusRefresh, setOrderStatusRefresh] = useState<OrderStatusRefresh>("idle")
  const [sessionKey, setSessionKey] = useState<string | null>(null)
  const [balanceAllowance, setBalanceAllowance] = useState<BalanceAllowance | null>(null)
  const [conditionalBalanceAllowance, setConditionalBalanceAllowance] = useState<BalanceAllowance | null>(null)
  const [signedOrderPreview, setSignedOrderPreview] = useState<SignedOrderPreview | null>(null)
  const [orderSubmission, setOrderSubmission] = useState<OrderSubmission | null>(null)
  const [orderStatus, setOrderStatus] = useState<OrderStatusSnapshot | null>(null)
  const [openOrders, setOpenOrders] = useState<OpenOrderSnapshot[]>([])
  const [openOrdersStatus, setOpenOrdersStatus] = useState<OpenOrdersStatus>("idle")
  const [error, setError] = useState<string | null>(null)
  const [approvalStatus, setApprovalStatus] = useState<ApprovalStatus>("idle")
  const clientRef = useRef<ClobClient | null>(null)
  const signedOrderRef = useRef<SignedOrder | null>(null)
  const providerRef = useRef<Eip1193Provider | null>(null)
  const signerRef = useRef<EthersTypedDataSigner | null>(null)
  const credsRef = useRef<ApiKeyCreds | null>(null)
  const lastWalletAddressRef = useRef<string | null>(null)

  // Reset all session state when the connected wallet address changes to prevent
  // a stale CLOB session from a previous wallet being used by a newly-connected one.
  useEffect(() => {
    const addr = wallet?.address?.toLowerCase() ?? null
    if (addr !== lastWalletAddressRef.current) {
      lastWalletAddressRef.current = addr
      clientRef.current = null
      signedOrderRef.current = null
      providerRef.current = null
      signerRef.current = null
      credsRef.current = null
      clearStoredSession()
      setStatus("idle")
      setSubmitStatus("idle")
      setApprovalStatus("idle")
      setSessionKey(null)
      setBalanceAllowance(null)
      setConditionalBalanceAllowance(null)
      setSignedOrderPreview(null)
      setOrderSubmission(null)
      setOrderStatus(null)
      setOrderStatusRefresh("idle")
      setOpenOrders([])
      setOpenOrdersStatus("idle")
      setError(null)
    }
  // Only trigger on address change, not on every render
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet?.address, profile?.tradingWalletAddress, profile?.tradingWalletKind])

  // Attempt to restore a persisted CLOB session from sessionStorage on mount / wallet change.
  // This avoids requiring re-signing after a page refresh.
  useEffect(() => {
    const addr = wallet?.address
    if (!addr || status !== "idle" || clientRef.current) return

    const expectedSignatureType = signatureTypeFor(profile)
    const expectedFunderAddress = expectedSignatureType === SignatureTypeV2.EOA ? undefined : profile?.tradingWalletAddress
    const stored = loadSession(addr, expectedSignatureType, expectedFunderAddress)
    if (!stored) return

    const restore = async () => {
      setStatus("preparing")
      setError(null)
      try {
        const polygonSigner = await getPolygonSigner(wallet)
        const { signer: typedDataSigner, refreshSigner } = createResilientTypedDataSigner(wallet, polygonSigner.signer)

        const creds = { key: stored.key, secret: stored.secret, passphrase: stored.passphrase }
        const funderAddress = stored.funderAddress
        const restoredClient = new ClobClient({
          host: CLOB_HOST,
          chain: CLOB_CHAIN,
          signer: typedDataSigner as any,
          creds,
          signatureType: stored.signatureType as SignatureTypeV2,
          funderAddress,
          builderConfig: builderConfig(),
        })
        clientRef.current = restoredClient
        providerRef.current = polygonSigner.provider
        signerRef.current = typedDataSigner
        credsRef.current = creds
        setSessionKey(redactedKey(creds.key))

        const collateral = await restoredClient.getBalanceAllowance({ asset_type: AssetType.COLLATERAL })
        setBalanceAllowance(normalizeBalanceAllowance(collateral))
        setStatus("ready")
      } catch (err: unknown) {
        // Restoration failed — clear stale session and surface a soft error.
        // Do NOT set status to "error" (that blocks the whole UI); use a warning
        // the trade panel can show in the onboarding stepper.
        clearStoredSession()
        clientRef.current = null
        providerRef.current = null
        signerRef.current = null
        credsRef.current = null
        setStatus("idle")
        setSessionKey(null)
        setBalanceAllowance(null)
        setConditionalBalanceAllowance(null)
        setOpenOrders([])
        setOpenOrdersStatus("idle")
        // Surface the restoration failure so the UI can prompt the user to re-prepare
        const msg = err instanceof Error ? err.message : "Session restore failed"
        if (!msg.toLowerCase().includes("reject") && !msg.toLowerCase().includes("denied")) {
          setError("Previous session could not be restored. Please prepare the CLOB session again.")
        }
      }
    }
    restore()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet?.address, profile?.tradingWalletAddress, profile?.tradingWalletKind])

  const prepareSession = async () => {
    if (!wallet) {
      setError("Connect a wallet before preparing a CLOB session.")
      return
    }

    setStatus("preparing")
    setError(null)

    try {
      const polygonSigner = await getPolygonSigner(wallet)
      const signerAddress = (await polygonSigner.signer.getAddress()).toLowerCase()
      const walletAddress = wallet.address.toLowerCase()

      if (signerAddress !== walletAddress) {
        throw new Error("The active wallet signer does not match the connected wallet.")
      }

      const { signer: typedDataSigner } = createResilientTypedDataSigner(wallet, polygonSigner.signer)

      const signatureType = signatureTypeFor(profile)
      const funderAddress = signatureType === 0 ? undefined : profile?.tradingWalletAddress
      const setupClient = new ClobClient({
        host: CLOB_HOST,
        chain: CLOB_CHAIN,
        signer: typedDataSigner as any,
        signatureType,
        funderAddress,
        builderConfig: builderConfig(),
      })
      const creds = await createOrDeriveApiKey(setupClient)
      const tradingClient = new ClobClient({
        host: CLOB_HOST,
        chain: CLOB_CHAIN,
        signer: typedDataSigner as any,
        creds,
        signatureType,
        funderAddress,
        builderConfig: builderConfig(),
      })
      clientRef.current = tradingClient
      providerRef.current = polygonSigner.provider
      signerRef.current = typedDataSigner
      credsRef.current = creds
      setSessionKey(redactedKey(creds.key))
      signedOrderRef.current = null
      setSignedOrderPreview(null)
      setOrderSubmission(null)
      setOrderStatus(null)
      setOpenOrders([])
      setOpenOrdersStatus("idle")
      setOrderStatusRefresh("idle")
      setSubmitStatus("idle")

      // Persist session to survive page refreshes (base64 in sessionStorage, 23h TTL)
      saveSession({
        walletAddress: walletAddress,
        key: creds.key,
        secret: creds.secret,
        passphrase: creds.passphrase,
        signatureType,
        funderAddress: funderAddress ?? undefined,
        storedAt: Date.now(),
      })

      const collateral = await tradingClient.getBalanceAllowance({ asset_type: AssetType.COLLATERAL })
      setBalanceAllowance(normalizeBalanceAllowance(collateral))
      setStatus("ready")
    } catch (err: any) {
      setStatus("error")
      setBalanceAllowance(null)
      setConditionalBalanceAllowance(null)
      setSessionKey(null)
      signedOrderRef.current = null
      setSignedOrderPreview(null)
      setOrderSubmission(null)
      setOrderStatus(null)
      setOrderStatusRefresh("idle")
      setSubmitStatus("idle")
      clientRef.current = null
      signerRef.current = null
      credsRef.current = null
      setError(errorMessage(err, "Unable to prepare CLOB session."))
    }
  }

  const refreshBalanceAllowance = async () => {
    if (!clientRef.current) {
      setError("Prepare a CLOB session before refreshing balance.")
      return
    }

    setError(null)
    try {
      await clientRef.current.updateBalanceAllowance?.({ asset_type: AssetType.COLLATERAL })
      const collateral = await clientRef.current.getBalanceAllowance({ asset_type: AssetType.COLLATERAL })
      setBalanceAllowance(normalizeBalanceAllowance(collateral))
    } catch (err: any) {
      setError(errorMessage(err, "Unable to refresh pUSD balance and allowance."))
    }
  }

  const refreshConditionalBalanceAllowance = async (tokenId: string): Promise<BalanceAllowance | null> => {
    if (!clientRef.current) {
      setError("Prepare a CLOB session before refreshing position allowance.")
      return null
    }

    if (!tokenId) {
      setConditionalBalanceAllowance(null)
      return null
    }

    setError(null)
    try {
      const params = { asset_type: AssetType.CONDITIONAL, token_id: tokenId }
      await clientRef.current.updateBalanceAllowance?.(params)
      const conditional = await clientRef.current.getBalanceAllowance(params)
      const normalized = normalizeBalanceAllowance(conditional, "max")
      setConditionalBalanceAllowance(normalized)
      return normalized
    } catch (err: any) {
      setError(errorMessage(err, "Unable to refresh position balance and allowance."))
      return null
    }
  }

  const createSignedBuyOrder = async (input: SignedBuyOrderInput) => {
    if (!clientRef.current) {
      setError("Prepare a CLOB session before signing an order.")
      return null
    }

    if (!input.tokenId || !input.amountUsd || input.amountUsd <= 0) {
      setError("A token and amount are required before signing an order.")
      return null
    }

    setError(null)
    try {
      const signedOrder = await clientRef.current.createMarketOrder(
        {
          tokenID: input.tokenId,
          amount: input.amountUsd,
          side: Side.BUY,
          price: input.price ?? undefined,
          orderType: OrderType.FAK,
        },
        {
          tickSize: input.tickSize ? String(input.tickSize) as any : undefined,
          negRisk: input.negRisk,
        }
      )
      signedOrderRef.current = signedOrder
      const preview = toSignedOrderPreview(signedOrder)
      setSignedOrderPreview(preview)
      setOrderSubmission(null)
      setOrderStatus(null)
      setOrderStatusRefresh("idle")
      setSubmitStatus("idle")
      return preview
    } catch (err: any) {
      signedOrderRef.current = null
      setSignedOrderPreview(null)
      setOrderSubmission(null)
      setOrderStatus(null)
      setOrderStatusRefresh("idle")
      setSubmitStatus("idle")
      setError(errorMessage(err, "Unable to create signed order preview."))
      return null
    }
  }

  const submitSignedOrder = async () => {
    if (!clientRef.current || !signedOrderRef.current) {
      setError("Create a signed order preview before submitting.")
      return null
    }

    setSubmitStatus("submitting")
    setOrderStatusRefresh("idle")
    setError(null)
    setOrderSubmission(null)
    setOrderStatus(null)

    try {
      // Use the order type recorded in the signed preview so GTC/GTD orders submit correctly
      const orderTypeStr = signedOrderPreview?.orderType ?? "FAK"
      const postOrderType = orderTypeStr === "GTC"
        ? OrderType.GTC
        : orderTypeStr === "GTD"
          ? OrderType.GTD
          : OrderType.FAK
      const raw = await clientRef.current.postOrder(signedOrderRef.current, postOrderType)
      const submission = normalizeOrderSubmission(raw)
      setOrderSubmission(submission)

      if (!submission.success) {
        setSubmitStatus("error")
        // Clear the signed order so the user cannot accidentally re-submit
        // the same order hash (which Polymarket would reject as "Duplicated")
        signedOrderRef.current = null
        setSignedOrderPreview(null)
        // Do NOT set session-level error here — the error lives in orderSubmission
        // and is displayed in the Order Submission panel, not Trading Access
        return submission
      }

      setSubmitStatus("submitted")
      signedOrderRef.current = null
      setSignedOrderPreview(null)
      if (postOrderType === OrderType.GTC || postOrderType === OrderType.GTD) {
        void refreshOpenOrders()
      }
      return submission
    } catch (err: any) {
      setSubmitStatus("error")
      // Clear the signed order to prevent duplicate re-submission
      signedOrderRef.current = null
      setSignedOrderPreview(null)
      const message = errorMessage(err, "Order submission failed.")
      // Do NOT set session-level error — keep it in orderSubmission only
      // so it shows in the Order Submission panel, not in Trading Access
      const submission = { success: false, errorMsg: message }
      setOrderSubmission(submission)
      return submission
    }
  }

  const refreshSubmittedOrder = async (orderId = orderSubmission?.orderId) => {
    if (!clientRef.current || !orderId) {
      setError("Submit an order before refreshing order status.")
      return null
    }

    setOrderStatusRefresh("loading")
    setError(null)
    try {
      const raw = await clientRef.current.getOrder(orderId)
      const status = normalizeOrderStatus(raw)
      setOrderStatus(status)
      setOrderStatusRefresh(status ? "ready" : "error")
      if (!status) setError("Order status response was empty.")
      return status
    } catch (err: any) {
      const message = errorMessage(err, "Unable to refresh order status.")
      setOrderStatus(null)
      setOrderStatusRefresh("error")
      setError(message)
      return null
    }
  }

  const refreshOpenOrders = async (params?: OpenOrderParams) => {
    if (!clientRef.current) {
      setError("Prepare a CLOB session before loading open orders.")
      return []
    }

    setOpenOrdersStatus("loading")
    setError(null)
    try {
      const rawOrders = await clientRef.current.getOpenOrders(params)
      const orders = rawOrders.map(normalizeOpenOrder)
      setOpenOrders(orders)
      setOpenOrdersStatus("ready")
      return orders
    } catch (err: any) {
      setOpenOrders([])
      setOpenOrdersStatus("error")
      setError(errorMessage(err, "Unable to load open orders."))
      return []
    }
  }

  const cancelOpenOrder = async (orderId: string) => {
    if (!clientRef.current) {
      setError("Prepare a CLOB session before canceling an order.")
      return false
    }

    if (!orderId) {
      setError("An order id is required before canceling.")
      return false
    }

    setError(null)
    try {
      await clientRef.current.cancelOrder({ orderID: orderId })
      await refreshOpenOrders()
      return true
    } catch (err: any) {
      setError(errorMessage(err, "Unable to cancel open order."))
      return false
    }
  }

  const createReadinessHeaders = async () => {
    if (!signerRef.current || !credsRef.current) return null
    try {
      const headers = await createL2Headers(
        signerRef.current as any,
        credsRef.current,
        { method: "GET", requestPath: "/balance-allowance" }
      )
      return stringHeaders(headers)
    } catch {
      return null
    }
  }

  const createOrderLookupHeaders = async (orderId: string) => {
    if (!signerRef.current || !credsRef.current || !orderId) return null
    try {
      const headers = await createL2Headers(
        signerRef.current as any,
        credsRef.current,
        { method: "GET", requestPath: `/data/order/${orderId}` }
      )
      return stringHeaders(headers)
    } catch {
      return null
    }
  }

  const createSignedSellOrder = async (input: SignedSellOrderInput) => {
    if (!clientRef.current) {
      setError("Prepare a CLOB session before signing a sell order.")
      return null
    }

    if (!input.tokenId || !input.amountShares || input.amountShares <= 0) {
      setError("A token and share amount are required before signing a sell order.")
      return null
    }

    setError(null)
    try {
      const signedOrder = await clientRef.current.createMarketOrder(
        {
          tokenID: input.tokenId,
          amount: input.amountShares,
          side: Side.SELL,
          price: input.price ?? undefined,
          orderType: OrderType.FAK,
        },
        {
          tickSize: input.tickSize ? String(input.tickSize) as any : undefined,
          negRisk: input.negRisk,
        }
      )
      signedOrderRef.current = signedOrder
      const preview = toSignedOrderPreview(signedOrder, "SELL", "FAK")
      setSignedOrderPreview(preview)
      setOrderSubmission(null)
      setOrderStatus(null)
      setOrderStatusRefresh("idle")
      setSubmitStatus("idle")
      return preview
    } catch (err: any) {
      signedOrderRef.current = null
      setSignedOrderPreview(null)
      setOrderSubmission(null)
      setOrderStatus(null)
      setOrderStatusRefresh("idle")
      setSubmitStatus("idle")
      setError(errorMessage(err, "Unable to create signed sell order."))
      return null
    }
  }

  const createSignedLimitOrder = async (input: SignedLimitOrderInput) => {
    if (!clientRef.current) {
      setError("Prepare a CLOB session before signing a limit order.")
      return null
    }

    if (!input.tokenId || !input.amount || input.amount <= 0) {
      setError("Token, amount, and limit price are required.")
      return null
    }

    if (!input.limitPriceCents || input.limitPriceCents <= 0 || input.limitPriceCents >= 100) {
      setError("Limit price must be between 1¢ and 99¢.")
      return null
    }

    if (input.orderType === "GTD" && (!input.expiresAt || input.expiresAt <= Date.now() / 1000)) {
      setError("GTD orders require a future expiry timestamp.")
      return null
    }

    setError(null)
    try {
      const side = input.side === "SELL" ? Side.SELL : Side.BUY
      // Convert cents to decimal price (e.g. 65¢ → 0.65)
      const priceDecimal = input.limitPriceCents / 100

      const signedOrder = await clientRef.current.createOrder(
        {
          tokenID: input.tokenId,
          size: input.amount,
          side,
          price: priceDecimal,
          ...(input.orderType === "GTD" && input.expiresAt ? { expiration: input.expiresAt } : {}),
        },
        {
          tickSize: input.tickSize ? String(input.tickSize) as any : undefined,
          negRisk: input.negRisk,
        }
      )
      signedOrderRef.current = signedOrder
      const preview = toSignedOrderPreview(signedOrder, input.side, input.orderType)
      setSignedOrderPreview(preview)
      setOrderSubmission(null)
      setOrderStatus(null)
      setOrderStatusRefresh("idle")
      setSubmitStatus("idle")
      return preview
    } catch (err: any) {
      signedOrderRef.current = null
      setSignedOrderPreview(null)
      setOrderSubmission(null)
      setOrderStatus(null)
      setOrderStatusRefresh("idle")
      setSubmitStatus("idle")
      setError(errorMessage(err, "Unable to create signed limit order."))
      return null
    }
  }

  const approveCollateral = async (): Promise<boolean> => {
    if (!wallet) {
      setError("Connect a wallet before approving pUSD.")
      return false
    }

    setApprovalStatus("approving")
    setError(null)

    try {
      const polygonSigner = await getPolygonSigner(wallet)
      providerRef.current = polygonSigner.provider
      const signer = polygonSigner.signer

      for (const spender of CLOB_OPERATORS) {
        const approveData = "0x095ea7b3" +
          spender.slice(2).padStart(64, "0") +
          MAX_UINT256.slice(2)

        const tx = await signer.sendTransaction({
          to: PUSD_CONTRACT,
          data: approveData,
          gasLimit: 100_000n,
        })

        await tx.wait(1)
      }
      setApprovalStatus("approved")

      // Refresh the balance/allowance after approval
      if (clientRef.current) {
        await clientRef.current.updateBalanceAllowance?.({ asset_type: AssetType.COLLATERAL })
        const collateral = await clientRef.current.getBalanceAllowance({ asset_type: AssetType.COLLATERAL })
        setBalanceAllowance(normalizeBalanceAllowance(collateral))
      }

      return true
    } catch (err: any) {
      setApprovalStatus("error")
      setError(errorMessage(err, "pUSD approval transaction failed."))
      return false
    }
  }

  const approveConditionalTokens = async (): Promise<boolean> => {
    if (!wallet) {
      setError("Connect a wallet before approving position tokens.")
      return false
    }

    setApprovalStatus("approving")
    setError(null)

    try {
      const polygonSigner = await getPolygonSigner(wallet)
      providerRef.current = polygonSigner.provider
      const signer = polygonSigner.signer

      for (const operator of CLOB_OPERATORS) {
        const approvalData = "0xa22cb465" +
          operator.slice(2).padStart(64, "0") +
          "1".padStart(64, "0")

        const tx = await signer.sendTransaction({
          to: CONDITIONAL_TOKENS_CONTRACT,
          data: approvalData,
          gasLimit: 100_000n,
        })

        await tx.wait(1)
      }

      setApprovalStatus("approved")
      return true
    } catch (err: any) {
      setApprovalStatus("error")
      setError(errorMessage(err, "Position token approval transaction failed."))
      return false
    }
  }

  const clearSignedOrderPreview = () => {
    signedOrderRef.current = null
    setSignedOrderPreview(null)
    setOrderSubmission(null)
    setOrderStatus(null)
    setOrderStatusRefresh("idle")
    setSubmitStatus("idle")
  }

  return {
    status,
    submitStatus,
    sessionKey,
    balanceAllowance,
    conditionalBalanceAllowance,
    signedOrderPreview,
    orderSubmission,
    orderStatus,
    openOrders,
    openOrdersStatus,
    orderStatusRefresh,
    error,
    approvalStatus,
    prepareSession,
    refreshBalanceAllowance,
    refreshConditionalBalanceAllowance,
    createSignedBuyOrder,
    createSignedSellOrder,
    createSignedLimitOrder,
    submitSignedOrder,
    refreshSubmittedOrder,
    refreshOpenOrders,
    cancelOpenOrder,
    createReadinessHeaders,
    createOrderLookupHeaders,
    clearSignedOrderPreview,
    approveCollateral,
    approveConditionalTokens,
  }
}
