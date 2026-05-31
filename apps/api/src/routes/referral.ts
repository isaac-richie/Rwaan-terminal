import { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  getOrCreateReferralCode,
  getReferralStats,
  getReferrerForReferee,
  markReferralRewarded,
  recordReferral,
  recordRewardEvent,
  resolveReferralCode,
} from "../services/db.js";
import { REFERRAL_POINTS } from "../services/rewards.js";

const EVM_RE = /^0x[a-fA-F0-9]{40}$/;

const trackSchema = z.object({
  referrer: z.string().min(3).optional(),
  code: z.string().min(3).optional(),
  referee: z.string().regex(EVM_RE, "invalid referee address"),
}).refine((data) => Boolean(data.referrer || data.code), {
  message: "missing_referrer",
});

async function resolveReferrer(referrerOrCode: string): Promise<{ referrer: string; referralCode?: string } | null> {
  if (EVM_RE.test(referrerOrCode)) {
    const code = await getOrCreateReferralCode(referrerOrCode);
    return { referrer: referrerOrCode.toLowerCase(), referralCode: code.code };
  }

  const referrer = await resolveReferralCode(referrerOrCode);
  return referrer ? { referrer, referralCode: referrerOrCode.trim().toUpperCase() } : null;
}

export async function referralRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /referral/code/:wallet
   * Returns the wallet's short referral code.
   */
  app.get(
    "/referral/code/:wallet",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const { wallet } = req.params as { wallet: string };
      if (!EVM_RE.test(wallet)) {
        return reply.status(400).send({ ok: false, error: "invalid_wallet" });
      }

      try {
        const referral = await getOrCreateReferralCode(wallet);
        return reply.send({ ok: true, ...referral, rewardPoints: REFERRAL_POINTS });
      } catch (err) {
        req.log.error({ err }, "referral code error");
        return reply.status(500).send({ ok: false, error: "internal_error" });
      }
    },
  );

  /**
   * POST /referral/track
   * Called when a new user connects their wallet via a referral link.
   * Body: { referrer: "0x... or CODE", referee: "0x..." }
   */
  app.post(
    "/referral/track",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const parsed = trackSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ ok: false, error: parsed.error.issues[0]?.message ?? "invalid_input" });
      }

      const { referee } = parsed.data;
      const referrerInput = parsed.data.referrer ?? parsed.data.code ?? "";

      try {
        const resolved = await resolveReferrer(referrerInput);
        if (!resolved) {
          return reply.status(404).send({ ok: false, error: "referral_code_not_found" });
        }

        const result = await recordReferral({ referrer: resolved.referrer, referee });
        return reply.send({ ok: true, ...result, referrer: resolved.referrer, referralCode: resolved.referralCode, rewardPoints: REFERRAL_POINTS });
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
        return reply.send({ ok: true, ...stats, rewardPoints: REFERRAL_POINTS });
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
        await markReferralRewarded(referee);

        return reply.send({ ok: true, rewarded: true, referrer, points: REFERRAL_POINTS });
      } catch (err) {
        req.log.error({ err }, "referral reward error");
        return reply.status(500).send({ ok: false, error: "internal_error" });
      }
    },
  );
}
