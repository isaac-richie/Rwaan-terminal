import { config } from "../config.js";
import { isVerifiedPaymentUsed, recordVerifiedPayment } from "./db.js";
import { recordPremiumUnlockReward } from "./rewards.js";
import type { PaymentRequirement } from "@smartmarket/types";

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const RPC_TIMEOUT_MS = 8000;

type VerifyResult = { valid: boolean; payer?: string; error?: string };

// ─── Resilient RPC layer ──────────────────────────────────────────────────────
// Builds a prioritised endpoint list: premium URL first, then public fallbacks.
// Deduplicates so BSC_RPC_URL isn't tried twice if it matches a fallback.

function buildRpcList(): string[] {
  const primary = config.payment.bscRpcUrl;
  const fallbacks = config.payment.bscRpcFallbacks ?? [];
  const all = [primary, ...fallbacks];
  // Deduplicate while preserving order
  return all.filter((url, idx) => all.indexOf(url) === idx);
}

const RPC_LIST = buildRpcList();

function rpcLabel(endpoint: string) {
  const slot = RPC_LIST.indexOf(endpoint);
  return slot >= 0 ? `slot ${slot}` : "custom endpoint";
}

// Track which endpoint is currently healthy to avoid always retrying from slot 0.
// In practice payment.ts is called once per unlock so this is a lightweight hint.
let preferredRpcIndex = 0;

async function rpcCall(
  endpoint: string,
  method: string,
  params: unknown[]
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as {
      result?: unknown;
      error?: { message?: string };
    };
    if (body.error) throw new Error(body.error.message ?? "RPC error");
    return body.result;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Tries RPC endpoints in priority order starting from `preferredRpcIndex`.
 * On success, promotes that endpoint to preferred. On total failure throws.
 */
async function bscRpc(method: string, params: unknown[]): Promise<unknown> {
  // Rotate list so preferred index is tried first
  const ordered = [
    ...RPC_LIST.slice(preferredRpcIndex),
    ...RPC_LIST.slice(0, preferredRpcIndex),
  ];

  let lastError: Error | null = null;

  for (let i = 0; i < ordered.length; i++) {
    const endpoint = ordered[i];
    try {
      const result = await rpcCall(endpoint, method, params);
      // Promote this endpoint for next call
      const globalIdx = RPC_LIST.indexOf(endpoint);
      if (globalIdx !== preferredRpcIndex) {
        preferredRpcIndex = globalIdx;
        if (i > 0) {
          console.log(`[bsc-rpc] Promoted ${rpcLabel(endpoint)} to preferred`);
        }
      }
      return result;
    } catch (err: any) {
      lastError = err;
      console.warn(`[bsc-rpc] ${rpcLabel(endpoint)} failed (${err.message ?? err}) — trying next`);
    }
  }

  throw lastError ?? new Error("All BSC RPC endpoints failed");
}

// ─── Health check (optional — called on startup) ──────────────────────────────

export async function checkRpcHealth(): Promise<void> {
  const results = await Promise.allSettled(
    RPC_LIST.map(async (url, i) => {
      const start = Date.now();
      try {
        await rpcCall(url, "eth_blockNumber", []);
        const latencyMs = Date.now() - start;
        console.log(`[bsc-rpc] slot ${i} ok (${latencyMs}ms)`);
        return { url, latencyMs };
      } catch (err: any) {
        console.warn(`[bsc-rpc] slot ${i} failed (${err.message})`);
        throw err;
      }
    })
  );

  // Promote fastest healthy endpoint
  const healthy = results
    .map((r, i) => ({ i, result: r }))
    .filter((x) => x.result.status === "fulfilled")
    .sort(
      (a, b) =>
        (a.result as PromiseFulfilledResult<{ latencyMs: number }>).value.latencyMs -
        (b.result as PromiseFulfilledResult<{ latencyMs: number }>).value.latencyMs
    );

  if (healthy.length > 0) {
    const best = healthy[0];
    const bestResult = best.result as PromiseFulfilledResult<{ url: string; latencyMs: number }>;
    preferredRpcIndex = RPC_LIST.indexOf(bestResult.value.url);
    console.log(
      `[bsc-rpc] Best endpoint: slot ${preferredRpcIndex} (${bestResult.value.latencyMs}ms)`
    );
  } else {
    console.error("[bsc-rpc] ⚠ All RPC endpoints are unreachable — payment verification will fail");
  }
}

// ─── Payment logic ────────────────────────────────────────────────────────────

export async function isPaymentUsed(txHash: string): Promise<boolean> {
  return isVerifiedPaymentUsed(txHash);
}

async function markPaymentUsed(
  txHash: string,
  payer: string,
  marketId: string,
  amount: string
): Promise<void> {
  await recordVerifiedPayment({ txHash, payer, marketId, amount });
  await recordPremiumUnlockReward({ wallet: payer, txHash, marketId, amountRaw: amount });
}

export async function verifyBscPayment(
  txHash: string,
  marketId: string
): Promise<VerifyResult> {
  if (!config.payment.receiverAddress) {
    return { valid: false, error: "payment_not_configured" };
  }

  if (await isPaymentUsed(txHash)) {
    return { valid: false, error: "payment_already_used" };
  }

  let receipt: any;
  try {
    receipt = await bscRpc("eth_getTransactionReceipt", [txHash]);
  } catch (err: any) {
    console.error("[payment] Receipt fetch failed:", err.message);
    return { valid: false, error: "rpc_unavailable" };
  }

  if (!receipt) {
    return { valid: false, error: "tx_not_found" };
  }

  if (receipt.status !== "0x1") {
    return { valid: false, error: "tx_reverted" };
  }

  const logs: any[] = Array.isArray(receipt.logs) ? receipt.logs : [];
  const receiver = config.payment.receiverAddress.toLowerCase();
  const usdtContract = config.payment.usdtContract.toLowerCase();
  const requiredAmount = BigInt(config.payment.priceRaw);

  const transferLog = logs.find((log: any) => {
    if (log.address?.toLowerCase() !== usdtContract) return false;
    if (!Array.isArray(log.topics) || log.topics.length < 3) return false;
    if (log.topics[0] !== TRANSFER_TOPIC) return false;
    const to = "0x" + (log.topics[2] as string).slice(26).toLowerCase();
    return to === receiver;
  });

  if (!transferLog) {
    return { valid: false, error: "no_matching_transfer" };
  }

  const transferAmount = BigInt(transferLog.data);
  if (transferAmount < requiredAmount) {
    return { valid: false, error: "insufficient_amount" };
  }

  const payer = "0x" + (transferLog.topics[1] as string).slice(26).toLowerCase();

  let block: any;
  try {
    block = await bscRpc("eth_getBlockByNumber", [receipt.blockNumber, false]);
  } catch {
    // Block lookup is age-validation only — don't fail the whole payment for this
    console.warn("[payment] Block timestamp lookup failed — skipping age check");
    block = null;
  }

  if (block?.timestamp) {
    const blockTime = Number(BigInt(block.timestamp));
    const now = Math.floor(Date.now() / 1000);
    if (now - blockTime > config.payment.txMaxAgeSeconds) {
      return { valid: false, error: "tx_too_old" };
    }
  }

  await markPaymentUsed(txHash, payer, marketId, transferAmount.toString());

  return { valid: true, payer };
}

export function buildPaymentRequirement(): PaymentRequirement {
  return {
    chainId: 56,
    tokenContract: config.payment.usdtContract,
    tokenSymbol: "USDT",
    tokenDecimals: config.payment.usdtDecimals,
    receiver: config.payment.receiverAddress,
    amountRaw: config.payment.priceRaw,
    amountHuman: config.payment.priceHuman,
  };
}
