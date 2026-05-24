import { FastifyInstance } from "fastify";
import { z } from "zod";
import { getRewardEventsSince, getRewardSummary } from "../services/db.js";
import { buildDailyQuests, recordTradeReward } from "../services/rewards.js";

const walletParamsSchema = z.object({
  wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});

const tradeRewardSchema = z.object({
  wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  orderId: z.string().min(6),
  marketId: z.string().min(1),
  amountUsd: z.number().nonnegative(),
  quickSettle: z.boolean().optional(),
  crypto: z.boolean().optional(),
  premium: z.boolean().optional(),
});

export async function pointsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/points/summary/:wallet", async (req, reply) => {
    const parsed = walletParamsSchema.safeParse(req.params ?? {});
    if (!parsed.success) {
      reply.status(400);
      return { ok: false, error: "invalid_wallet" };
    }

    const summary = await getRewardSummary(parsed.data.wallet);
    return { ok: true, summary };
  });

  app.get("/points/quests/:wallet", async (req, reply) => {
    const parsed = walletParamsSchema.safeParse(req.params ?? {});
    if (!parsed.success) {
      reply.status(400);
      return { ok: false, error: "invalid_wallet" };
    }

    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    const events = await getRewardEventsSince(parsed.data.wallet, start.toISOString());
    return {
      ok: true,
      resetAt: new Date(start.getTime() + 24 * 60 * 60 * 1000).toISOString(),
      quests: buildDailyQuests(events),
    };
  });

  app.post("/points/events/trade", async (req, reply) => {
    const parsed = tradeRewardSchema.safeParse(req.body ?? null);
    if (!parsed.success) {
      reply.status(400);
      return { ok: false, error: "invalid_trade_reward_payload", issues: parsed.error.issues };
    }

    await recordTradeReward(parsed.data);
    return { ok: true };
  });
}
