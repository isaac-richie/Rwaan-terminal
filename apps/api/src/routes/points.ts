import { FastifyInstance } from "fastify";
import { z } from "zod";
import { getRewardEventsSince, getRewardSummary, getLeaderboard } from "../services/db.js";
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

  /**
   * GET /points/leaderboard
   * Returns the top 50 wallets by total points.
   * Cached 5 min — computing this for every request is expensive.
   */
  let leaderboardCache: { data: unknown; expiresAt: number } | null = null;

  app.get(
    "/points/leaderboard",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (_req, _reply) => {
      const now = Date.now();
      if (leaderboardCache && now < leaderboardCache.expiresAt) {
        return { ok: true, leaderboard: leaderboardCache.data, cached: true };
      }

      try {
        const leaderboard = await getLeaderboard(50);
        leaderboardCache = { data: leaderboard, expiresAt: now + 5 * 60 * 1000 };
        return { ok: true, leaderboard, cached: false };
      } catch (err) {
        return { ok: false, error: "leaderboard_unavailable" };
      }
    },
  );

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
