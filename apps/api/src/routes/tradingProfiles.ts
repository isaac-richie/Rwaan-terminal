import { FastifyInstance } from "fastify";
import { z } from "zod";
import type { BridgeDepositResponse } from "@smartmarket/types";
import { postDeposit } from "../services/polymarket.js";
import { attachDepositAddress, getTradingProfile, resolveTradingProfile } from "../services/tradingProfiles.js";

const evmAddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Expected an EVM address");

const resolveProfileSchema = z.object({
  connectedWalletAddress: evmAddressSchema,
  tradingWalletAddress: evmAddressSchema.optional(),
  tradingWalletKind: z.enum(["eoa", "safe", "proxy", "deposit"]).optional()
});

const paramsSchema = z.object({
  connectedWalletAddress: evmAddressSchema
});

export async function tradingProfileRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { connectedWalletAddress: string } }>("/trading-profile/:connectedWalletAddress", async (req, reply) => {
    const params = paramsSchema.safeParse(req.params ?? {});
    if (!params.success) {
      reply.status(400);
      return { error: "invalid_connected_wallet", issues: params.error.issues };
    }

    const profile = await getTradingProfile(params.data.connectedWalletAddress);
    if (!profile) {
      reply.status(404);
      return { error: "profile_not_found" };
    }

    return { profile };
  });

  app.post("/trading-profile/resolve", async (req, reply) => {
    const body = resolveProfileSchema.safeParse(req.body ?? null);
    if (!body.success) {
      reply.status(400);
      return { error: "invalid_trading_profile_payload", issues: body.error.issues };
    }

    const profile = await resolveTradingProfile(body.data);
    return { profile };
  });

  app.post<{ Params: { connectedWalletAddress: string } }>(
    "/trading-profile/:connectedWalletAddress/deposit-address",
    async (req, reply) => {
      const params = paramsSchema.safeParse(req.params ?? {});
      if (!params.success) {
        reply.status(400);
        return { error: "invalid_connected_wallet", issues: params.error.issues };
      }

      const profile = await getTradingProfile(params.data.connectedWalletAddress);
      if (!profile) {
        reply.status(404);
        return { error: "profile_not_found" };
      }

      if (profile.depositAddress?.evm) {
        return { profile, depositAddress: profile.depositAddress };
      }

      const deposit = await postDeposit({ address: profile.tradingWalletAddress }) as BridgeDepositResponse;
      const updated = await attachDepositAddress(params.data.connectedWalletAddress, deposit);
      return { profile: updated, depositAddress: updated.depositAddress };
    }
  );
}
