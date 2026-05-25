import { FastifyInstance } from "fastify";
import { z } from "zod";
import { recordReferral, getReferralStats, markReferralRewarded, getReferrerForReferee, recordRewardEvent } from "../services/db.js";

const EVM_RE = /^0x[a-fA-F0-9]{40}$/;

const trackSchema = z.object({
  referrer: z.string().regex(EVM_RE, "invalid referrer address"),
  referee: z.string().regex(EVM_RE, "invalid referee address"),
});

/** Points awarded to a referrer when their referee completes their first trade */
const REFERRAL_POINTS = 500;

export async function referralRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /referral/track
   * Called when a new user connects their wallet via a referral link.
   * Body: { referrer: "0x...", referee: "0x..." }
   */
  app.post(
    "/referral/track",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const parsed = trackSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ ok: false, error: parsed.error.issues[0]?.message ?? "invalid_input" });
      }

      const { referrer, referee } = parsed.data;

      try {
        const result = await recordReferral({ referrer, referee });
        return reply.send({ ok: true, ...result });
      } catch (err) {
        req.log.error({ err }, "referral track error");
        return reply.status(500).send({ ok: false, error: "internal_error" });
      }
    },
  );

  /**
   * GET /referral/stats/:wallet
   * Returns referral count and reward status for a referrer wallet.
   */
  app.get(
    "/referral/stats/:wallet",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const { wallet } = req.params as { wallet: string };
      if (!EVM_RE.test(wallet)) {
        return reply.status(400).send({ ok: false, error: "invalid_wallet" });
      }

      try {
        const stats = await getReferralStats(wallet);
        return reply.send({ ok: true, ...stats });
      } catch (err) {
        req.log.error({ err }, "referral stats error");
        return reply.status(500).send({ ok: false, error: "internal_error" });
      }
    },
  );

  /**
   * POST /referral/reward
   * Internal hook — called after a referred user's first trade clears.
   * Awards REFERRAL_POINTS to the referrer and marks the referral rewarded.
   * Body: { referee: "0x..." }
   *
   * Protected by a shared secret so only the API itself can call it.
   */
  app.post(
    "/referral/reward",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const secret = process.env.REFERRAL_REWARD_SECRET;
      if (secret) {
        const authHeader = req.headers["x-referral-secret"];
        if (authHeader !== secret) {
          return reply.status(403).send({ ok: false, error: "forbidden" });
        }
      }

      const { referee } = req.body as { referee?: string };
      if (!referee || !EVM_RE.test(referee)) {
        return reply.status(400).send({ ok: false, error: "invalid_referee" });
      }

      try {
        const referrer = await getReferrerForReferee(referee);
        if (!referrer) {
          return reply.send({ ok: true, rewarded: false, reason: "no_referral_found" });
        }

        await markReferralRewarded(referee);
        await recordRewardEvent({
          wallet: referrer,
          eventType: "referral_reward",
          idempotencyKey: `referral:${referee}`,
          points: REFERRAL_POINTS,
          cashbackCents: 0,
          amountUsd: 0,
          marketId: null,
          metadata: { referee, source: "first_trade" },
        });

        return reply.send({ ok: true, rewarded: true, referrer, points: REFERRAL_POINTS });
      } catch (err) {
        req.log.error({ err }, "referral reward error");
        return reply.status(500).send({ ok: false, error: "internal_error" });
      }
    },
  );
}
