import { FastifyInstance } from "fastify";
import { z } from "zod";
import { Contract, JsonRpcProvider } from "ethers";
import type { BalanceAllowanceSnapshot, TradingWalletKind } from "@smartmarket/types";
import { config } from "../config.js";
import { getClobAuthenticated } from "../services/polymarket.js";
import { buildTradeReadiness } from "../services/tradeReadiness.js";

const evmAddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
const PUSD_CONTRACT = "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB";
const COLLATERAL_SPENDERS = [
  "0xE111180000d2663C0091e4f400237545B87B996B",
  "0xe2222d279d744050d28e00520010520000310F59",
  "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296"
];
const ERC20_COLLATERAL_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)"
];

const readinessSchema = z.object({
  connectedWalletAddress: evmAddressSchema.optional(),
  tradingWalletAddress: evmAddressSchema.optional(),
  tradingWalletKind: z.enum(["eoa", "safe", "proxy", "deposit"]).optional(),
  depositAddress: evmAddressSchema.optional(),
  marketId: z.string().min(1).optional(),
  tokenId: z.string().min(1).optional(),
  amountUsd: z.number().positive().optional()
});

type ClobSessionHeaders = {
  POLY_ADDRESS: string;
  POLY_SIGNATURE: string;
  POLY_TIMESTAMP: string;
  POLY_API_KEY: string;
  POLY_PASSPHRASE: string;
};

type UnknownRecord = Record<string, unknown>;

function extractClobSessionHeaders(headers: Record<string, string | string[] | undefined>): ClobSessionHeaders | null {
  const pick = (key: string) => {
    const lower = key.toLowerCase();
    const value = headers[key] ?? headers[lower];
    if (!value) return undefined;
    return Array.isArray(value) ? value[0] : value;
  };

  const polyAddress = pick("POLY_ADDRESS");
  const polySignature = pick("POLY_SIGNATURE");
  const polyTimestamp = pick("POLY_TIMESTAMP");
  const polyApiKey = pick("POLY_API_KEY");
  const polyPassphrase = pick("POLY_PASSPHRASE");

  if (!polyAddress || !polySignature || !polyTimestamp || !polyApiKey || !polyPassphrase) {
    return null;
  }

  return {
    POLY_ADDRESS: polyAddress,
    POLY_SIGNATURE: polySignature,
    POLY_TIMESTAMP: polyTimestamp,
    POLY_API_KEY: polyApiKey,
    POLY_PASSPHRASE: polyPassphrase
  };
}

function signatureType(kind?: TradingWalletKind): number {
  if (kind === "deposit") return 3;
  if (kind === "safe") return 2;
  if (kind === "proxy") return 1;
  return 0;
}

function normalizeBalanceAllowance(raw: unknown): BalanceAllowanceSnapshot | null {
  const snapshot = raw && typeof raw === "object" ? (raw as UnknownRecord) : {};
  const allowanceValues = snapshot.allowances && typeof snapshot.allowances === "object"
    ? Object.values(snapshot.allowances as Record<string, unknown>)
    : [];
  const minAllowance = allowanceValues
    .map((allowance) => {
      try {
        return BigInt(String(allowance));
      } catch {
        return null;
      }
    })
    .filter((allowance): allowance is bigint => allowance !== null)
    .reduce<bigint | null>((min, allowance) => min === null || allowance < min ? allowance : min, null);
  const allowance =
    snapshot.allowance ??
    (minAllowance !== null ? minAllowance.toString() : undefined);
  if (snapshot.balance === undefined || allowance === undefined) return null;
  return {
    balance: String(snapshot.balance),
    allowance: String(allowance),
    assetType: "COLLATERAL"
  };
}

function isZeroOrMissingAllowance(snapshot?: BalanceAllowanceSnapshot): boolean {
  if (!snapshot?.allowance) return true;
  try {
    return BigInt(snapshot.allowance) === 0n;
  } catch {
    return Number(snapshot.allowance) === 0;
  }
}

async function readOnChainCollateral(wallet: string): Promise<BalanceAllowanceSnapshot> {
  const rpc = new JsonRpcProvider(config.gasAssist.polygonRpcUrl);
  const collateral = new Contract(PUSD_CONTRACT, ERC20_COLLATERAL_ABI, rpc);
  const [balance, ...allowances] = await Promise.all([
    collateral.balanceOf(wallet) as Promise<bigint>,
    ...COLLATERAL_SPENDERS.map((spender) => collateral.allowance(wallet, spender) as Promise<bigint>)
  ]);
  const minAllowance = allowances.reduce((min, allowance) => allowance < min ? allowance : min);
  return {
    balance: balance.toString(),
    allowance: minAllowance.toString(),
    assetType: "COLLATERAL"
  };
}

export async function tradeReadinessRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/trade/readiness",
    {
      config: {
        rateLimit: {
          groupId: "trade-readiness",
          max: 360,
          timeWindow: "1 minute"
        }
      }
    },
    async (req, reply) => {
      const parsed = readinessSchema.safeParse(req.body ?? null);
      if (!parsed.success) {
        reply.status(400);
        return { ok: false, error: "invalid_readiness_payload", issues: parsed.error.issues };
      }

      const body = parsed.data;
      const clobSessionHeaders = extractClobSessionHeaders(req.headers as Record<string, string | string[] | undefined>);
      let collateral: BalanceAllowanceSnapshot | undefined;

      if (clobSessionHeaders) {
        try {
          const rawCollateral = await getClobAuthenticated(
            "/balance-allowance",
            {
              asset_type: "COLLATERAL",
              signature_type: signatureType(body.tradingWalletKind)
            },
            clobSessionHeaders
          );
          collateral = normalizeBalanceAllowance(rawCollateral) ?? undefined;
        } catch (err) {
          req.log.warn({ err }, "Authenticated CLOB balance/allowance check failed");
        }
      }

      if (body.tradingWalletAddress && (!collateral || isZeroOrMissingAllowance(collateral))) {
        try {
          collateral = await readOnChainCollateral(body.tradingWalletAddress);
        } catch (err) {
          req.log.warn({ err, tradingWalletAddress: body.tradingWalletAddress }, "On-chain pUSD balance/allowance check failed");
        }
      }

      return buildTradeReadiness({
        connectedWalletAddress: body.connectedWalletAddress,
        tradingWalletAddress: body.tradingWalletAddress,
        tradingWalletKind: body.tradingWalletKind,
        depositAddress: body.depositAddress,
        amountUsd: body.amountUsd,
        clobSessionHeaders,
        collateral
      });
    }
  );
}
