import { FastifyInstance } from "fastify";
import { z } from "zod";
import { getStatus, getSupportedAssets, postDeposit, postQuote } from "../services/polymarket.js";
import { normalizeFundingStatus } from "../services/fundingStatus.js";

const BNB_CHAIN_ID = "56";
const evmAddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Expected an EVM address");

const bnbQuoteSchema = z.object({
  fromAmountBaseUnit: z.string().min(1),
  fromChainId: z.literal(BNB_CHAIN_ID),
  fromTokenAddress: z.string().min(1),
  recipientAddress: evmAddressSchema,
  toChainId: z.string().min(1),
  toTokenAddress: z.string().min(1)
});

const depositAddressSchema = z.object({
  tradingWalletAddress: evmAddressSchema
});

type SupportedAsset = {
  chainId?: string | number;
  chainName?: string;
  token?: {
    name?: string;
    symbol?: string;
    address?: string;
    decimals?: number;
  };
  minCheckoutUsd?: number;
};

function getSupportedAssetList(data: unknown): SupportedAsset[] {
  if (!data || typeof data !== "object") return [];
  const supportedAssets = (data as { supportedAssets?: unknown }).supportedAssets;
  return Array.isArray(supportedAssets) ? supportedAssets as SupportedAsset[] : [];
}

function isBnbAsset(asset: SupportedAsset): boolean {
  const chainId = asset.chainId === undefined ? "" : String(asset.chainId);
  const chainName = (asset.chainName ?? "").toLowerCase();
  return chainId === BNB_CHAIN_ID || chainName.includes("bnb");
}

export async function fundingRoutes(app: FastifyInstance): Promise<void> {
  app.get("/funding/bnb-assets", async () => {
    const data = await getSupportedAssets();
    const supportedAssets = getSupportedAssetList(data).filter(isBnbAsset);

    return {
      chainId: BNB_CHAIN_ID,
      chainName: "BNB Smart Chain",
      addressType: "evm",
      supportedAssets
    };
  });

  app.post("/funding/deposit-address", async (req, reply) => {
    const body = depositAddressSchema.safeParse(req.body ?? null);
    if (!body.success) {
      reply.status(400);
      return { error: "invalid_deposit_address_payload", issues: body.error.issues };
    }

    return postDeposit({ address: body.data.tradingWalletAddress });
  });

  app.post("/funding/quote", async (req, reply) => {
    const body = bnbQuoteSchema.safeParse(req.body ?? null);
    if (!body.success) {
      reply.status(400);
      return { error: "invalid_bnb_quote_payload", issues: body.error.issues };
    }

    return postQuote(body.data);
  });

  app.get<{ Params: { depositAddress: string } }>("/funding/status/:depositAddress", async (req, reply) => {
    const params = z.object({ depositAddress: evmAddressSchema }).safeParse(req.params ?? {});
    if (!params.success) {
      reply.status(400);
      return { error: "invalid_deposit_address", issues: params.error.issues };
    }

    const status = await getStatus(params.data.depositAddress);
    return normalizeFundingStatus(params.data.depositAddress, status);
  });
}
