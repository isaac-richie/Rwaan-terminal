import type { BridgeTransaction, FundingStatusPhase, FundingStatusResponse } from "@smartmarket/types";

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" ? (value as UnknownRecord) : {};
}

function normalizeTransaction(value: unknown): BridgeTransaction {
  const raw = asRecord(value);
  return {
    fromChainId: raw.fromChainId === undefined ? undefined : String(raw.fromChainId),
    fromTokenAddress: raw.fromTokenAddress === undefined ? undefined : String(raw.fromTokenAddress),
    fromAmountBaseUnit: raw.fromAmountBaseUnit === undefined ? undefined : String(raw.fromAmountBaseUnit),
    toChainId: raw.toChainId === undefined ? undefined : String(raw.toChainId),
    toTokenAddress: raw.toTokenAddress === undefined ? undefined : String(raw.toTokenAddress),
    status: raw.status === undefined ? undefined : String(raw.status),
    txHash: raw.txHash === undefined ? undefined : String(raw.txHash),
    createdTimeMs: Number.isFinite(Number(raw.createdTimeMs)) ? Number(raw.createdTimeMs) : undefined
  };
}

function transactionList(rawStatus: unknown): BridgeTransaction[] {
  const raw = asRecord(rawStatus);
  const transactions = Array.isArray(raw.transactions) ? raw.transactions : Array.isArray(rawStatus) ? rawStatus : [];
  return transactions
    .map(normalizeTransaction)
    .sort((a, b) => (b.createdTimeMs ?? 0) - (a.createdTimeMs ?? 0));
}

function phaseForStatus(status?: string): FundingStatusPhase {
  const normalized = (status ?? "").toUpperCase();
  if (!normalized) return "not_started";
  if (normalized.includes("FAILED")) return "failed";
  if (normalized.includes("COMPLETED")) return "completed";
  if (normalized.includes("PROCESSING") || normalized.includes("SUBMITTED") || normalized.includes("CONFIRMED")) {
    return "processing";
  }
  if (normalized.includes("DETECTED")) return "detected";
  return "processing";
}

function labelForPhase(phase: FundingStatusPhase): string {
  if (phase === "completed") return "Completed";
  if (phase === "failed") return "Failed";
  if (phase === "processing") return "Processing";
  if (phase === "detected") return "Deposit detected";
  return "Waiting for deposit";
}

function messageForPhase(phase: FundingStatusPhase): string {
  if (phase === "completed") return "Funds have completed bridge processing and should be available for trading balance checks.";
  if (phase === "failed") return "The bridge reported a failed transaction. Verify the source transaction before funding again.";
  if (phase === "processing") return "The bridge has detected funds and is processing the route into Polymarket pUSD.";
  if (phase === "detected") return "A deposit has been detected and is waiting for bridge processing.";
  return "Send a supported BNB Chain asset to the deposit address, then Rawli will track the bridge status here.";
}

export function normalizeFundingStatus(depositAddress: string, rawStatus: unknown, now = new Date()): FundingStatusResponse {
  const transactions = transactionList(rawStatus);
  const latest = transactions[0];
  const phase = phaseForStatus(latest?.status);

  return {
    ok: true,
    depositAddress,
    transactions,
    latest,
    phase,
    label: labelForPhase(phase),
    message: messageForPhase(phase),
    updatedAt: now.toISOString()
  };
}
