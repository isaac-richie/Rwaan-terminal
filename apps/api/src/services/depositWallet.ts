import { BuilderConfig } from "@polymarket/builder-signing-sdk";
import { RelayClient, TransactionType } from "@polymarket/builder-relayer-client";
import { createWalletClient, encodeFunctionData, fallback, http, recoverTypedDataAddress } from "viem";
import { polygon } from "viem/chains";
import { config } from "../config.js";

const POLYGON_CHAIN_ID = 137;
const EVM_RE = /^0x[a-fA-F0-9]{40}$/;
const PUSD_CONTRACT = "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB";
const CONDITIONAL_TOKENS_CONTRACT = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045";
const CTF_COLLATERAL_ADAPTER = "0xAdA100Db00Ca00073811820692005400218FcE1f";
const NEG_RISK_CTF_COLLATERAL_ADAPTER = "0xadA2005600Dec949baf300f4C6120000bDB6eAab";
const CTF_EXCHANGE_V2 = "0xE111180000d2663C0091e4f400237545B87B996B";
const NEG_RISK_EXCHANGE_V2 = "0xe2222d279d744050d28e00520010520000310F59";
const NEG_RISK_ADAPTER = "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296";
const CLOB_OPERATORS = [CTF_EXCHANGE_V2, NEG_RISK_EXCHANGE_V2, NEG_RISK_ADAPTER];
const MAX_UINT256 = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
const DEPOSIT_WALLET_FACTORY = "0x00000000000Fb5C9ADea0298D729A0CB3823Cc07";
const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000";
const APPROVAL_DEADLINE_SECONDS = 15 * 60;
const MAX_APPROVAL_DEADLINE_SECONDS = 60 * 60;
const WITHDRAW_DEADLINE_SECONDS = 15 * 60;
const MAX_WITHDRAW_DEADLINE_SECONDS = 60 * 60;
const CLAIM_DEADLINE_SECONDS = 15 * 60;
const MAX_CLAIM_DEADLINE_SECONDS = 60 * 60;
const BYTES32_RE = /^0x[a-fA-F0-9]{64}$/;

const REDEEM_POSITIONS_ABI = [
  {
    type: "function",
    name: "redeemPositions",
    stateMutability: "nonpayable",
    inputs: [
      { name: "collateralToken", type: "address" },
      { name: "parentCollectionId", type: "bytes32" },
      { name: "conditionId", type: "bytes32" },
      { name: "indexSets", type: "uint256[]" },
    ],
    outputs: [],
  },
] as const;

type DepositWalletClient = {
  relayClient: RelayClient;
  builderConfigured: boolean;
};

function assertEvmAddress(address: string, label: string) {
  if (!EVM_RE.test(address)) throw new Error(`invalid_${label}`);
}

function assertBytes32(value: string, label: string) {
  if (!BYTES32_RE.test(value)) throw new Error(`invalid_${label}`);
}

function builderConfig() {
  const creds = config.polymarket.builderCreds;
  if (!creds.key || !creds.secret || !creds.passphrase) return undefined;
  return new BuilderConfig({
    localBuilderCreds: {
      key: creds.key,
      secret: creds.secret,
      passphrase: creds.passphrase,
    },
  });
}

function requireBuilderConfig() {
  const builder = builderConfig();
  if (!builder) throw new Error("builder_relayer_not_configured");
  return builder;
}

/**
 * Viem fallback transport across all configured Polygon RPC endpoints.
 * Tries each in order; automatically retries the next on failure.
 */
function polygonTransport() {
  const primary = config.gasAssist.polygonRpcUrl;
  const extras = config.gasAssist.polygonRpcFallbacks ?? [];
  const all = [primary, ...extras].filter((u, i, arr) => arr.indexOf(u) === i);
  return all.length === 1
    ? http(all[0])
    : fallback(all.map((url) => http(url, { timeout: 8_000 })));
}

function depositWalletClient(owner: string): DepositWalletClient {
  assertEvmAddress(owner, "owner");
  const walletClient = createWalletClient({
    account: owner.toLowerCase() as `0x${string}`,
    chain: polygon,
    transport: polygonTransport(),
  });
  const builder = builderConfig();
  return {
    relayClient: new RelayClient(
      config.polymarket.relayerUrl,
      POLYGON_CHAIN_ID,
      walletClient as any,
      builder as any
    ),
    builderConfigured: Boolean(builder),
  };
}

export type DepositWalletStatus = {
  ok: boolean;
  owner: string;
  depositWallet: string;
  deployed: boolean;
  relayerUrl: string;
  builderConfigured: boolean;
};

export async function getDepositWalletStatus(owner: string): Promise<DepositWalletStatus> {
  const normalizedOwner = owner.toLowerCase();
  const { relayClient, builderConfigured } = depositWalletClient(normalizedOwner);
  const depositWallet = await relayClient.deriveDepositWalletAddress();
  const deployed = await relayClient.getDeployed(depositWallet, "WALLET");
  return {
    ok: true,
    owner: normalizedOwner,
    depositWallet,
    deployed,
    relayerUrl: config.polymarket.relayerUrl,
    builderConfigured,
  };
}

export type DepositWalletDeployResult = DepositWalletStatus & {
  transactionID?: string;
  transactionHash?: string;
  state?: string;
};

export async function deployDepositWallet(owner: string): Promise<DepositWalletDeployResult> {
  const normalizedOwner = owner.toLowerCase();
  const { relayClient, builderConfigured } = depositWalletClient(normalizedOwner);
  if (!builderConfigured) {
    const status = await getDepositWalletStatus(normalizedOwner);
    return { ...status, ok: false };
  }

  const depositWallet = await relayClient.deriveDepositWalletAddress();
  const deployed = await relayClient.getDeployed(depositWallet, "WALLET");
  if (deployed) {
    return {
      ok: true,
      owner: normalizedOwner,
      depositWallet,
      deployed: true,
      relayerUrl: config.polymarket.relayerUrl,
      builderConfigured,
    };
  }

  const response = await relayClient.deployDepositWallet();

  // Wait for mining with a 45s timeout — the relayer can be slow
  const DEPLOY_TIMEOUT_MS = 45_000;
  let mined: any = null;
  try {
    mined = await Promise.race([
      response.wait(),
      new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error("deploy_wait_timeout")), DEPLOY_TIMEOUT_MS)
      ),
    ]);
  } catch (waitErr: any) {
    // Timeout or wait error — still check if it deployed
    if (waitErr?.message !== "deploy_wait_timeout") throw waitErr;
  }

  // Check deploy status regardless of whether wait() succeeded or timed out
  const deployedAfter = await relayClient.getDeployed(depositWallet, "WALLET").catch(() => false);
  return {
    ok: deployedAfter ? true : (mined != null),
    owner: normalizedOwner,
    depositWallet,
    deployed: deployedAfter,
    relayerUrl: config.polymarket.relayerUrl,
    builderConfigured,
    transactionID: response.transactionID,
    transactionHash: mined?.transactionHash ?? response.transactionHash,
    state: mined?.state ?? response.state ?? (deployedAfter ? "mined" : "pending"),
  };
}

function encodeApprove(spender: string, amount = MAX_UINT256): string {
  assertEvmAddress(spender, "spender");
  return "0x095ea7b3" + spender.slice(2).padStart(64, "0") + amount.slice(2).padStart(64, "0");
}

function encodeTransfer(to: string, amount: string): string {
  assertEvmAddress(to, "withdrawal_address");
  if (!/^\d+$/.test(amount) || BigInt(amount) <= 0n) throw new Error("invalid_withdraw_amount");
  return "0xa9059cbb" + to.slice(2).padStart(64, "0") + BigInt(amount).toString(16).padStart(64, "0");
}

function encodeSetApprovalForAll(operator: string, approved = true): string {
  assertEvmAddress(operator, "operator");
  return "0xa22cb465" + operator.slice(2).padStart(64, "0") + (approved ? "1" : "0").padStart(64, "0");
}

function approvalCalls(): DepositWalletCall[] {
  const collateralApprovals = CLOB_OPERATORS.map((spender) => ({
    target: PUSD_CONTRACT,
    value: "0",
    data: encodeApprove(spender),
  }));

  const conditionalTokenApprovals = CLOB_OPERATORS.map((operator) => ({
    target: CONDITIONAL_TOKENS_CONTRACT,
    value: "0",
    data: encodeSetApprovalForAll(operator),
  }));

  return [...collateralApprovals, ...conditionalTokenApprovals];
}

function withdrawCalls(withdrawalAddress: string, amountBaseUnit: string): DepositWalletCall[] {
  return [
    {
      target: PUSD_CONTRACT,
      value: "0",
      data: encodeTransfer(withdrawalAddress, amountBaseUnit),
    },
  ];
}

function claimCalls(conditionId: string, negRisk = false): DepositWalletCall[] {
  assertBytes32(conditionId, "condition_id");
  const adapter = negRisk ? NEG_RISK_CTF_COLLATERAL_ADAPTER : CTF_COLLATERAL_ADAPTER;
  return [
    {
      target: CONDITIONAL_TOKENS_CONTRACT,
      value: "0",
      data: encodeSetApprovalForAll(adapter, true),
    },
    {
      target: adapter,
      value: "0",
      data: encodeFunctionData({
        abi: REDEEM_POSITIONS_ABI,
        functionName: "redeemPositions",
        args: [PUSD_CONTRACT as `0x${string}`, ZERO_BYTES32 as `0x${string}`, conditionId as `0x${string}`, [1n, 2n]],
      }),
    },
  ];
}

export type DepositWalletCall = {
  target: string;
  value: string;
  data: string;
};

export type DepositWalletApprovalPrepare = {
  ok: true;
  owner: string;
  depositWallet: string;
  nonce: string;
  deadline: string;
  calls: DepositWalletCall[];
  typedData: {
    domain: {
      name: "DepositWallet";
      version: "1";
      chainId: number;
      verifyingContract: string;
    };
    types: {
      EIP712Domain: Array<{ name: string; type: string }>;
      Call: Array<{ name: string; type: string }>;
      Batch: Array<{ name: string; type: string }>;
    };
    primaryType: "Batch";
    message: {
      wallet: string;
      nonce: string;
      deadline: string;
      calls: DepositWalletCall[];
    };
  };
};

export async function prepareDepositWalletApproval(owner: string, depositWallet: string): Promise<DepositWalletApprovalPrepare> {
  const normalizedOwner = owner.toLowerCase();
  assertEvmAddress(normalizedOwner, "owner");
  assertEvmAddress(depositWallet, "deposit_wallet");

  const { relayClient } = depositWalletClient(normalizedOwner);
  const expectedDepositWallet = await relayClient.deriveDepositWalletAddress();
  if (expectedDepositWallet.toLowerCase() !== depositWallet.toLowerCase()) {
    throw new Error("deposit_wallet_owner_mismatch");
  }

  const deployed = await relayClient.getDeployed(expectedDepositWallet, "WALLET");
  if (!deployed) {
    throw new Error("deposit_wallet_not_deployed");
  }

  const noncePayload = await relayClient.getNonce(normalizedOwner, TransactionType.WALLET);
  const deadline = Math.floor(Date.now() / 1000 + APPROVAL_DEADLINE_SECONDS).toString();
  const calls = approvalCalls();

  return {
    ok: true,
    owner: normalizedOwner,
    depositWallet: expectedDepositWallet,
    nonce: noncePayload.nonce,
    deadline,
    calls,
    typedData: {
      domain: {
        name: "DepositWallet",
        version: "1",
        chainId: POLYGON_CHAIN_ID,
        verifyingContract: expectedDepositWallet,
      },
      types: {
        EIP712Domain: [
          { name: "name", type: "string" },
          { name: "version", type: "string" },
          { name: "chainId", type: "uint256" },
          { name: "verifyingContract", type: "address" },
        ],
        Call: [
          { name: "target", type: "address" },
          { name: "value", type: "uint256" },
          { name: "data", type: "bytes" },
        ],
        Batch: [
          { name: "wallet", type: "address" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
          { name: "calls", type: "Call[]" },
        ],
      },
      primaryType: "Batch",
      message: {
        wallet: expectedDepositWallet,
        nonce: noncePayload.nonce,
        deadline,
        calls,
      },
    },
  };
}

export type DepositWalletApprovalSubmitInput = {
  owner: string;
  depositWallet: string;
  nonce: string;
  deadline: string;
  calls: DepositWalletCall[];
  signature: string;
};

export async function submitDepositWalletApproval(input: DepositWalletApprovalSubmitInput) {
  const owner = input.owner.toLowerCase();
  assertEvmAddress(owner, "owner");
  assertEvmAddress(input.depositWallet, "deposit_wallet");
  if (!/^0x[a-fA-F0-9]+$/.test(input.signature)) throw new Error("invalid_signature");

  const { relayClient } = depositWalletClient(owner);
  const expectedDepositWallet = await relayClient.deriveDepositWalletAddress();
  if (expectedDepositWallet.toLowerCase() !== input.depositWallet.toLowerCase()) {
    throw new Error("deposit_wallet_owner_mismatch");
  }

  const deployed = await relayClient.getDeployed(expectedDepositWallet, "WALLET");
  if (!deployed) {
    throw new Error("deposit_wallet_not_deployed");
  }

  const currentNonce = await relayClient.getNonce(owner, TransactionType.WALLET);
  if (currentNonce.nonce !== input.nonce) {
    throw new Error("stale_deposit_wallet_batch");
  }

  const now = Math.floor(Date.now() / 1000);
  const deadline = Number(input.deadline);
  if (!Number.isSafeInteger(deadline) || deadline <= now) {
    throw new Error("expired_deposit_wallet_batch");
  }
  if (deadline > now + MAX_APPROVAL_DEADLINE_SECONDS) {
    throw new Error("invalid_deposit_wallet_deadline");
  }

  if (JSON.stringify(approvalCalls()) !== JSON.stringify(input.calls)) {
    throw new Error("deposit_wallet_batch_mismatch");
  }

  const recovered = await recoverTypedDataAddress({
    domain: {
      name: "DepositWallet",
      version: "1",
      chainId: POLYGON_CHAIN_ID,
      verifyingContract: expectedDepositWallet as `0x${string}`,
    },
    types: {
      Call: [
        { name: "target", type: "address" },
        { name: "value", type: "uint256" },
        { name: "data", type: "bytes" },
      ],
      Batch: [
        { name: "wallet", type: "address" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
        { name: "calls", type: "Call[]" },
      ],
    },
    primaryType: "Batch",
    message: {
      wallet: expectedDepositWallet as `0x${string}`,
      nonce: BigInt(input.nonce),
      deadline: BigInt(input.deadline),
      calls: input.calls.map((call) => ({
        target: call.target as `0x${string}`,
        value: BigInt(call.value),
        data: call.data as `0x${string}`,
      })),
    },
    signature: input.signature as `0x${string}`,
  });
  if (recovered.toLowerCase() !== owner) {
    const error = new Error("deposit_wallet_signature_owner_mismatch") as Error & { recovered?: string };
    error.recovered = recovered;
    throw error;
  }

  const body = JSON.stringify({
    type: TransactionType.WALLET,
    from: owner,
    to: DEPOSIT_WALLET_FACTORY,
    nonce: input.nonce,
    signature: input.signature,
    depositWalletParams: {
      depositWallet: expectedDepositWallet,
      deadline: input.deadline,
      calls: input.calls,
    },
  });
  const headers = await requireBuilderConfig().generateBuilderHeaders("POST", "/submit", body);
  if (!headers) throw new Error("builder_relayer_not_configured");

  const response = await fetch(`${config.polymarket.relayerUrl}/submit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const relayerError = typeof payload?.error === "string" ? payload.error.toLowerCase() : "";
    const message = relayerError.includes("deadline too soon")
      ? "deposit_wallet_deadline_too_soon"
      : "deposit_wallet_approval_submit_failed";
    const error = new Error(message) as Error & { payload?: unknown; status?: number };
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return { ok: true, ...payload };
}

export type DepositWalletWithdrawPrepare = {
  ok: true;
  owner: string;
  depositWallet: string;
  withdrawalAddress: string;
  amountBaseUnit: string;
  nonce: string;
  deadline: string;
  calls: DepositWalletCall[];
  typedData: DepositWalletApprovalPrepare["typedData"];
};

export async function prepareDepositWalletWithdraw(
  owner: string,
  depositWallet: string,
  withdrawalAddress: string,
  amountBaseUnit: string
): Promise<DepositWalletWithdrawPrepare> {
  const normalizedOwner = owner.toLowerCase();
  assertEvmAddress(normalizedOwner, "owner");
  assertEvmAddress(depositWallet, "deposit_wallet");
  assertEvmAddress(withdrawalAddress, "withdrawal_address");
  if (!/^\d+$/.test(amountBaseUnit) || BigInt(amountBaseUnit) <= 0n) throw new Error("invalid_withdraw_amount");

  const { relayClient } = depositWalletClient(normalizedOwner);
  const expectedDepositWallet = await relayClient.deriveDepositWalletAddress();
  if (expectedDepositWallet.toLowerCase() !== depositWallet.toLowerCase()) {
    throw new Error("deposit_wallet_owner_mismatch");
  }

  const deployed = await relayClient.getDeployed(expectedDepositWallet, "WALLET");
  if (!deployed) {
    throw new Error("deposit_wallet_not_deployed");
  }

  const noncePayload = await relayClient.getNonce(normalizedOwner, TransactionType.WALLET);
  const deadline = Math.floor(Date.now() / 1000 + WITHDRAW_DEADLINE_SECONDS).toString();
  const calls = withdrawCalls(withdrawalAddress, amountBaseUnit);

  return {
    ok: true,
    owner: normalizedOwner,
    depositWallet: expectedDepositWallet,
    withdrawalAddress,
    amountBaseUnit,
    nonce: noncePayload.nonce,
    deadline,
    calls,
    typedData: {
      domain: {
        name: "DepositWallet",
        version: "1",
        chainId: POLYGON_CHAIN_ID,
        verifyingContract: expectedDepositWallet,
      },
      types: {
        EIP712Domain: [
          { name: "name", type: "string" },
          { name: "version", type: "string" },
          { name: "chainId", type: "uint256" },
          { name: "verifyingContract", type: "address" },
        ],
        Call: [
          { name: "target", type: "address" },
          { name: "value", type: "uint256" },
          { name: "data", type: "bytes" },
        ],
        Batch: [
          { name: "wallet", type: "address" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
          { name: "calls", type: "Call[]" },
        ],
      },
      primaryType: "Batch",
      message: {
        wallet: expectedDepositWallet,
        nonce: noncePayload.nonce,
        deadline,
        calls,
      },
    },
  };
}

export type DepositWalletWithdrawSubmitInput = {
  owner: string;
  depositWallet: string;
  withdrawalAddress: string;
  amountBaseUnit: string;
  nonce: string;
  deadline: string;
  calls: DepositWalletCall[];
  signature: string;
};

export type DepositWalletClaimPrepare = {
  ok: true;
  owner: string;
  depositWallet: string;
  conditionId: string;
  negRisk: boolean;
  nonce: string;
  deadline: string;
  calls: DepositWalletCall[];
  typedData: DepositWalletApprovalPrepare["typedData"];
};

export async function prepareDepositWalletClaim(
  owner: string,
  depositWallet: string,
  conditionId: string,
  negRisk = false
): Promise<DepositWalletClaimPrepare> {
  const normalizedOwner = owner.toLowerCase();
  assertEvmAddress(normalizedOwner, "owner");
  assertEvmAddress(depositWallet, "deposit_wallet");
  assertBytes32(conditionId, "condition_id");

  const { relayClient } = depositWalletClient(normalizedOwner);
  const expectedDepositWallet = await relayClient.deriveDepositWalletAddress();
  if (expectedDepositWallet.toLowerCase() !== depositWallet.toLowerCase()) {
    throw new Error("deposit_wallet_owner_mismatch");
  }

  const deployed = await relayClient.getDeployed(expectedDepositWallet, "WALLET");
  if (!deployed) {
    throw new Error("deposit_wallet_not_deployed");
  }

  const noncePayload = await relayClient.getNonce(normalizedOwner, TransactionType.WALLET);
  const deadline = Math.floor(Date.now() / 1000 + CLAIM_DEADLINE_SECONDS).toString();
  const calls = claimCalls(conditionId, negRisk);

  return {
    ok: true,
    owner: normalizedOwner,
    depositWallet: expectedDepositWallet,
    conditionId,
    negRisk,
    nonce: noncePayload.nonce,
    deadline,
    calls,
    typedData: {
      domain: {
        name: "DepositWallet",
        version: "1",
        chainId: POLYGON_CHAIN_ID,
        verifyingContract: expectedDepositWallet,
      },
      types: {
        EIP712Domain: [
          { name: "name", type: "string" },
          { name: "version", type: "string" },
          { name: "chainId", type: "uint256" },
          { name: "verifyingContract", type: "address" },
        ],
        Call: [
          { name: "target", type: "address" },
          { name: "value", type: "uint256" },
          { name: "data", type: "bytes" },
        ],
        Batch: [
          { name: "wallet", type: "address" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
          { name: "calls", type: "Call[]" },
        ],
      },
      primaryType: "Batch",
      message: {
        wallet: expectedDepositWallet,
        nonce: noncePayload.nonce,
        deadline,
        calls,
      },
    },
  };
}

export type DepositWalletClaimSubmitInput = {
  owner: string;
  depositWallet: string;
  conditionId: string;
  negRisk?: boolean;
  nonce: string;
  deadline: string;
  calls: DepositWalletCall[];
  signature: string;
};

export async function submitDepositWalletClaim(input: DepositWalletClaimSubmitInput) {
  const owner = input.owner.toLowerCase();
  const negRisk = Boolean(input.negRisk);
  assertEvmAddress(owner, "owner");
  assertEvmAddress(input.depositWallet, "deposit_wallet");
  assertBytes32(input.conditionId, "condition_id");
  if (!/^0x[a-fA-F0-9]+$/.test(input.signature)) throw new Error("invalid_signature");

  const { relayClient } = depositWalletClient(owner);
  const expectedDepositWallet = await relayClient.deriveDepositWalletAddress();
  if (expectedDepositWallet.toLowerCase() !== input.depositWallet.toLowerCase()) {
    throw new Error("deposit_wallet_owner_mismatch");
  }

  const deployed = await relayClient.getDeployed(expectedDepositWallet, "WALLET");
  if (!deployed) {
    throw new Error("deposit_wallet_not_deployed");
  }

  const currentNonce = await relayClient.getNonce(owner, TransactionType.WALLET);
  if (currentNonce.nonce !== input.nonce) {
    throw new Error("stale_deposit_wallet_batch");
  }

  const now = Math.floor(Date.now() / 1000);
  const deadline = Number(input.deadline);
  if (!Number.isSafeInteger(deadline) || deadline <= now) {
    throw new Error("expired_deposit_wallet_batch");
  }
  if (deadline > now + MAX_CLAIM_DEADLINE_SECONDS) {
    throw new Error("invalid_deposit_wallet_deadline");
  }

  if (JSON.stringify(claimCalls(input.conditionId, negRisk)) !== JSON.stringify(input.calls)) {
    throw new Error("deposit_wallet_batch_mismatch");
  }

  const recovered = await recoverTypedDataAddress({
    domain: {
      name: "DepositWallet",
      version: "1",
      chainId: POLYGON_CHAIN_ID,
      verifyingContract: expectedDepositWallet as `0x${string}`,
    },
    types: {
      Call: [
        { name: "target", type: "address" },
        { name: "value", type: "uint256" },
        { name: "data", type: "bytes" },
      ],
      Batch: [
        { name: "wallet", type: "address" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
        { name: "calls", type: "Call[]" },
      ],
    },
    primaryType: "Batch",
    message: {
      wallet: expectedDepositWallet as `0x${string}`,
      nonce: BigInt(input.nonce),
      deadline: BigInt(input.deadline),
      calls: input.calls.map((call) => ({
        target: call.target as `0x${string}`,
        value: BigInt(call.value),
        data: call.data as `0x${string}`,
      })),
    },
    signature: input.signature as `0x${string}`,
  });
  if (recovered.toLowerCase() !== owner) {
    const error = new Error("deposit_wallet_signature_owner_mismatch") as Error & { recovered?: string };
    error.recovered = recovered;
    throw error;
  }

  const body = JSON.stringify({
    type: TransactionType.WALLET,
    from: owner,
    to: DEPOSIT_WALLET_FACTORY,
    nonce: input.nonce,
    signature: input.signature,
    depositWalletParams: {
      depositWallet: expectedDepositWallet,
      deadline: input.deadline,
      calls: input.calls,
    },
  });
  const headers = await requireBuilderConfig().generateBuilderHeaders("POST", "/submit", body);
  if (!headers) throw new Error("builder_relayer_not_configured");

  const response = await fetch(`${config.polymarket.relayerUrl}/submit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const relayerError = typeof payload?.error === "string" ? payload.error.toLowerCase() : "";
    const message = relayerError.includes("deadline too soon")
      ? "deposit_wallet_deadline_too_soon"
      : "deposit_wallet_claim_submit_failed";
    const error = new Error(message) as Error & { payload?: unknown; status?: number };
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return { ok: true, ...payload };
}

export async function submitDepositWalletWithdraw(input: DepositWalletWithdrawSubmitInput) {
  const owner = input.owner.toLowerCase();
  assertEvmAddress(owner, "owner");
  assertEvmAddress(input.depositWallet, "deposit_wallet");
  assertEvmAddress(input.withdrawalAddress, "withdrawal_address");
  if (!/^\d+$/.test(input.amountBaseUnit) || BigInt(input.amountBaseUnit) <= 0n) throw new Error("invalid_withdraw_amount");
  if (!/^0x[a-fA-F0-9]+$/.test(input.signature)) throw new Error("invalid_signature");

  const { relayClient } = depositWalletClient(owner);
  const expectedDepositWallet = await relayClient.deriveDepositWalletAddress();
  if (expectedDepositWallet.toLowerCase() !== input.depositWallet.toLowerCase()) {
    throw new Error("deposit_wallet_owner_mismatch");
  }

  const deployed = await relayClient.getDeployed(expectedDepositWallet, "WALLET");
  if (!deployed) {
    throw new Error("deposit_wallet_not_deployed");
  }

  const currentNonce = await relayClient.getNonce(owner, TransactionType.WALLET);
  if (currentNonce.nonce !== input.nonce) {
    throw new Error("stale_deposit_wallet_batch");
  }

  const now = Math.floor(Date.now() / 1000);
  const deadline = Number(input.deadline);
  if (!Number.isSafeInteger(deadline) || deadline <= now) {
    throw new Error("expired_deposit_wallet_batch");
  }
  if (deadline > now + MAX_WITHDRAW_DEADLINE_SECONDS) {
    throw new Error("invalid_deposit_wallet_deadline");
  }

  if (JSON.stringify(withdrawCalls(input.withdrawalAddress, input.amountBaseUnit)) !== JSON.stringify(input.calls)) {
    throw new Error("deposit_wallet_batch_mismatch");
  }

  const recovered = await recoverTypedDataAddress({
    domain: {
      name: "DepositWallet",
      version: "1",
      chainId: POLYGON_CHAIN_ID,
      verifyingContract: expectedDepositWallet as `0x${string}`,
    },
    types: {
      Call: [
        { name: "target", type: "address" },
        { name: "value", type: "uint256" },
        { name: "data", type: "bytes" },
      ],
      Batch: [
        { name: "wallet", type: "address" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
        { name: "calls", type: "Call[]" },
      ],
    },
    primaryType: "Batch",
    message: {
      wallet: expectedDepositWallet as `0x${string}`,
      nonce: BigInt(input.nonce),
      deadline: BigInt(input.deadline),
      calls: input.calls.map((call) => ({
        target: call.target as `0x${string}`,
        value: BigInt(call.value),
        data: call.data as `0x${string}`,
      })),
    },
    signature: input.signature as `0x${string}`,
  });
  if (recovered.toLowerCase() !== owner) {
    const error = new Error("deposit_wallet_signature_owner_mismatch") as Error & { recovered?: string };
    error.recovered = recovered;
    throw error;
  }

  const body = JSON.stringify({
    type: TransactionType.WALLET,
    from: owner,
    to: DEPOSIT_WALLET_FACTORY,
    nonce: input.nonce,
    signature: input.signature,
    depositWalletParams: {
      depositWallet: expectedDepositWallet,
      deadline: input.deadline,
      calls: input.calls,
    },
  });
  const headers = await requireBuilderConfig().generateBuilderHeaders("POST", "/submit", body);
  if (!headers) throw new Error("builder_relayer_not_configured");

  const response = await fetch(`${config.polymarket.relayerUrl}/submit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const relayerError = typeof payload?.error === "string" ? payload.error.toLowerCase() : "";
    const message = relayerError.includes("deadline too soon")
      ? "deposit_wallet_deadline_too_soon"
      : "deposit_wallet_withdraw_submit_failed";
    const error = new Error(message) as Error & { payload?: unknown; status?: number };
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return { ok: true, ...payload };
}
