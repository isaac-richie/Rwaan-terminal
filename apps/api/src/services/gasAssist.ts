import { Contract, FallbackProvider, JsonRpcProvider, AbstractProvider, Wallet, formatEther, formatUnits, parseEther, parseUnits } from "ethers";
import { config } from "../config.js";
import { getRecentGasAssist, recordGasAssist } from "./db.js";

const EVM_RE = /^0x[a-fA-F0-9]{40}$/;
const PUSD_CONTRACT = "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB";
const PUSD_DECIMALS = 6;
const ERC20_BALANCE_ABI = ["function balanceOf(address account) view returns (uint256)"];

export type GasAssistStatus = {
  ok: boolean;
  enabled: boolean;
  eligible: boolean;
  reason:
    | "ready"
    | "disabled"
    | "invalid_address"
    | "relayer_not_configured"
    | "insufficient_pusd"
    | "pol_balance_sufficient"
    | "rate_limited"
    | "relayer_underfunded";
  wallet: string;
  polBalance: string;
  polBalanceHuman: string;
  pUsdBalance: string;
  pUsdBalanceHuman: string;
  minPolBalance: string;
  topupPol: string;
  recentTxHash?: string;
  relayerAddress?: string;
};

/**
 * Build a FallbackProvider across all configured Polygon RPC endpoints.
 * Ethers tries each provider in priority order (lowest number = highest priority),
 * automatically falling back if one stalls or errors.
 */
function provider(): FallbackProvider {
  const primary = config.gasAssist.polygonRpcUrl;
  const fallbacks = config.gasAssist.polygonRpcFallbacks ?? [];
  const all = [primary, ...fallbacks].filter((u, i, arr) => arr.indexOf(u) === i);

  if (all.length === 1) {
    // Wrap single provider in FallbackProvider for a consistent return type
    return new FallbackProvider([{ provider: new JsonRpcProvider(all[0]), priority: 1, stallTimeout: 3000 }]);
  }

  return new FallbackProvider(
    all.map((url, i) => ({
      provider: new JsonRpcProvider(url),
      priority: i + 1,      // 1 = highest priority (primary)
      stallTimeout: 3000,   // wait 3s before trying next
      weight: i === 0 ? 2 : 1, // primary gets double weight for quorum
    })),
    1 // quorum of 1 — first successful response wins
  );
}

function relayerWallet(rpc: AbstractProvider = provider()) {
  if (!config.gasAssist.relayerPrivateKey) return null;
  try {
    return new Wallet(config.gasAssist.relayerPrivateKey, rpc);
  } catch {
    return null;
  }
}

async function polygonGasPrice(rpc: AbstractProvider): Promise<bigint> {
  const feeData = await rpc.getFeeData();
  return feeData.gasPrice ?? 30_000_000_000n; // fallback 30 gwei
}

function sinceCooldownIso() {
  return new Date(Date.now() - config.gasAssist.cooldownHours * 60 * 60 * 1000).toISOString();
}

function disabledStatus(wallet: string, reason: GasAssistStatus["reason"]): GasAssistStatus {
  return {
    ok: true,
    enabled: config.gasAssist.enabled,
    eligible: false,
    reason,
    wallet,
    polBalance: "0",
    polBalanceHuman: "0",
    pUsdBalance: "0",
    pUsdBalanceHuman: "0",
    minPolBalance: config.gasAssist.minPolBalance,
    topupPol: config.gasAssist.topupPol,
  };
}

export async function getGasAssistStatus(wallet: string): Promise<GasAssistStatus> {
  if (!EVM_RE.test(wallet)) return disabledStatus(wallet, "invalid_address");
  const normalized = wallet.toLowerCase();

  if (!config.gasAssist.enabled) return disabledStatus(normalized, "disabled");

  const rpc = provider();
  const relayer = relayerWallet(rpc);
  if (!relayer) return disabledStatus(normalized, "relayer_not_configured");

  const pUsd = new Contract(PUSD_CONTRACT, ERC20_BALANCE_ABI, rpc);

  const [polBalance, pUsdBalance, recent] = await Promise.all([
    rpc.getBalance(normalized),
    pUsd.balanceOf(normalized) as Promise<bigint>,
    getRecentGasAssist(normalized, sinceCooldownIso()),
  ]);

  const minPusd = parseUnits(config.gasAssist.minPusdBalance, PUSD_DECIMALS);
  const minPol = parseEther(config.gasAssist.minPolBalance);
  const topup = parseEther(config.gasAssist.topupPol);
  const maxTopup = parseEther(config.gasAssist.maxTopupPol);
  const relayerBalance = await rpc.getBalance(relayer.address);

  const base = {
    ok: true,
    enabled: true,
    wallet: normalized,
    polBalance: polBalance.toString(),
    polBalanceHuman: formatEther(polBalance),
    pUsdBalance: pUsdBalance.toString(),
    pUsdBalanceHuman: formatUnits(pUsdBalance, PUSD_DECIMALS),
    minPolBalance: config.gasAssist.minPolBalance,
    topupPol: config.gasAssist.topupPol,
    relayerAddress: relayer.address,
  };

  if (pUsdBalance < minPusd) {
    return { ...base, eligible: false, reason: "insufficient_pusd" };
  }

  if (polBalance >= minPol) {
    return { ...base, eligible: false, reason: "pol_balance_sufficient" };
  }

  if (recent) {
    return { ...base, eligible: false, reason: "rate_limited", recentTxHash: recent.tx_hash ?? undefined };
  }

  if (topup <= 0n || topup > maxTopup || relayerBalance < topup) {
    return { ...base, eligible: false, reason: "relayer_underfunded" };
  }

  return { ...base, eligible: true, reason: "ready" };
}

export async function sendGasAssist(wallet: string, reason = "polygon_gas_assist"): Promise<GasAssistStatus & { txHash?: string }> {
  const status = await getGasAssistStatus(wallet);
  if (!status.eligible) return status;

  const rpc = provider();
  const relayer = relayerWallet(rpc);
  if (!relayer) return { ...status, eligible: false, reason: "relayer_not_configured" };

  const amount = parseEther(config.gasAssist.topupPol);

  try {
    const gasPrice = await polygonGasPrice(rpc);
    const tx = await relayer.sendTransaction({
      to: status.wallet,
      value: amount,
      gasLimit: 21_000n,
      gasPrice,
    });
    await tx.wait(1);
    await recordGasAssist({
      wallet: status.wallet,
      amountWei: amount.toString(),
      txHash: tx.hash,
      reason,
      status: "sent",
    });
    return { ...status, eligible: false, reason: "rate_limited", txHash: tx.hash, recentTxHash: tx.hash };
  } catch (err) {
    await recordGasAssist({
      wallet: status.wallet,
      amountWei: amount.toString(),
      reason,
      status: "failed",
    });
    throw err;
  }
}
