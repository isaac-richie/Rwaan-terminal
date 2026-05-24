import { config } from "../config.js";
import { isVerifiedPaymentUsed, recordVerifiedPayment } from "./db.js";
import { recordPremiumUnlockReward } from "./rewards.js";
import type { PaymentRequirement } from "@smartmarket/types";

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

type VerifyResult = { valid: boolean; payer?: string; error?: string };

async function bscRpc(method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(config.payment.bscRpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await res.json() as { result?: unknown; error?: { message?: string } };
  if (body.error) throw new Error(body.error.message ?? "RPC error");
  return body.result;
}

export async function isPaymentUsed(txHash: string): Promise<boolean> {
  return isVerifiedPaymentUsed(txHash);
}

async function markPaymentUsed(txHash: string, payer: string, marketId: string, amount: string): Promise<void> {
  await recordVerifiedPayment({ txHash, payer, marketId, amount });
  await recordPremiumUnlockReward({ wallet: payer, txHash, marketId, amountRaw: amount });
}

export async function verifyBscPayment(txHash: string, marketId: string): Promise<VerifyResult> {
  if (!config.payment.receiverAddress) {
    return { valid: false, error: "payment_not_configured" };
  }

  if (await isPaymentUsed(txHash)) {
    return { valid: false, error: "payment_already_used" };
  }

  let receipt: any;
  try {
    receipt = await bscRpc("eth_getTransactionReceipt", [txHash]);
  } catch {
    return { valid: false, error: "rpc_error" };
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
    return { valid: false, error: "block_lookup_failed" };
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
