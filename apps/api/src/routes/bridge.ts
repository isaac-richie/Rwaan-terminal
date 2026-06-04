import { FastifyInstance } from "fastify";
import { z } from "zod";
import { getSupportedAssets, getStatus, postDeposit, postQuote, postWithdraw } from "../services/polymarket.js";

const evmAddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Expected an EVM address");
const positiveBaseUnitSchema = z.string().regex(/^\d+$/).refine((value) => BigInt(value) > 0n, {
  message: "Expected a positive base-unit amount",
});

const quoteSchema = z.object({
  fromAmountBaseUnit: positiveBaseUnitSchema,
  fromChainId: z.string().min(1),
  fromTokenAddress: z.string().min(1),
  recipientAddress: evmAddressSchema,
  toChainId: z.string().min(1),
  toTokenAddress: z.string().min(1)
});

const depositSchema = z.object({
  address: evmAddressSchema
});

const withdrawSchema = z.object({
  address: evmAddressSchema,
  toChainId: z.string().min(1),
  toTokenAddress: z.string().min(1),
  recipientAddr: evmAddressSchema,   // must be a valid EVM address — malformed address = unrecoverable tx
});

export async function bridgeRoutes(app: FastifyInstance): Promise<void> {
  app.get("/bridge/supported-assets", async () => getSupportedAssets());

  app.post("/bridge/quote", async (req, reply) => {
    const body = quoteSchema.safeParse(req.body ?? null);
    if (!body.success) {
      reply.status(400);
      return { error: "invalid_quote_payload", issues: body.error.issues };
    }
    return postQuote(body.data);
  });

  app.post("/bridge/deposit", async (req, reply) => {
    const body = depositSchema.safeParse(req.body ?? null);
    if (!body.success) {
      reply.status(400);
      return { error: "invalid_deposit_payload", issues: body.error.issues };
    }
    return postDeposit(body.data);
  });

  app.post("/bridge/withdraw", async (req, reply) => {
    const body = withdrawSchema.safeParse(req.body ?? null);
    if (!body.success) {
      reply.status(400);
      return { error: "invalid_withdraw_payload", issues: body.error.issues };
    }
    return postWithdraw(body.data);
  });

  app.get<{ Params: { address: string } }>("/bridge/status/:address", async (req, reply) => {
    try {
      return await getStatus(req.params.address);
    } catch (err) {
      req.log.warn({ err }, "bridge status upstream error");
      reply.status(503);
      return { ok: false, error: "upstream_unavailable" };
    }
  });
}
