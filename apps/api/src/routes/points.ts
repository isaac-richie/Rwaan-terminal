import { FastifyInstance } from "fastify";
import { z } from "zod";
import { getRewardEventsSince, getRewardSummary, getLeaderboard } from "../services/db.js";
import { buildDailyQuests, recordTradeReward } from "../services/rewards.js";
import { getClobAuthenticated } from "../services/polymarket.js";

const walletParamsSchema = z.object({
  wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});

const tradeRewardSchema = z.object({
  wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  tradingWalletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  orderId: z.string().min(6),
  marketId: z.string().min(1),
  tokenId: z.string().min(1),
  amountUsd: z.number().nonnegative(),
  quickSettle: z.boolean().optional(),
  crypto: z.boolean().optional(),
  premium: z.boolean().optional(),
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
    POLY_PASSPHRASE: polyPassphrase,
  };
}

function numericValue(...values: unknown[]) {
  for (const value of values) {
    if (value === undefined || value === null || value === "") continue;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return 0;
}

function normalizeAddress(value: unknown) {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value) ? value.toLowerCase() : null;
}

function verifyOrderForReward(order: unknown, input: z.infer<typeof tradeRewardSchema>) {
  const data = order && typeof order === "object" ? (order as UnknownRecord) : {};
  const owner = normalizeAddress(data.owner);
  const maker = normalizeAddress(data.maker_address ?? data.makerAddress);
  const tradingWallet = input.tradingWalletAddress.toLowerCase();
  const connectedWallet = input.wallet.toLowerCase();
  const allowedWallets = new Set([tradingWallet, connectedWallet]);
  const orderWallets = [owner, maker].filter((wallet): wallet is string => Boolean(wallet));

  if (orderWallets.length === 0) return { ok: false as const, error: "order_owner_missing" };
  if (!orderWallets.some((wallet) => allowedWallets.has(wallet))) {
    return { ok: false as const, error: "order_owner_mismatch" };
  }

  const assetId = String(data.asset_id ?? data.assetId ?? "");
  if (assetId !== input.tokenId) return { ok: false as const, error: "order_token_mismatch" };

  const price = numericValue(data.price);
  const matchedSize = numericValue(data.size_matched, data.sizeMatched);
  const originalSize = numericValue(data.original_size, data.originalSize, data.size);
  const rewardSize = matchedSize > 0 ? matchedSize : 0;
  const amountUsd = rewardSize * price;

  if (amountUsd <= 0) {
    return {
      ok: true as const,
      rewardable: false,
      amountUsd: 0,
      reason: originalSize > 0 ? "order_not_filled" : "order_size_missing",
    };
  }

  return { ok: true as const, rewardable: true, amountUsd };
}

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

  app.post(
    "/points/events/trade",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const parsed = tradeRewardSchema.safeParse(req.body ?? null);
      if (!parsed.success) {
        reply.status(400);
        return { ok: false, error: "invalid_trade_reward_payload", issues: parsed.error.issues };
      }

      const headers = extractClobSessionHeaders(req.headers as Record<string, string | string[] | undefined>);
      if (!headers) {
        reply.status(401);
        return { ok: false, error: "missing_clob_order_proof" };
      }

      const orderPath = `/data/order/${parsed.data.orderId}`;
      let order: unknown;
      try {
        order = await getClobAuthenticated(orderPath, {}, headers);
      } catch (err) {
        req.log.warn({ err, orderId: parsed.data.orderId }, "Unable to verify CLOB order before awarding points");
        reply.status(409);
        return { ok: false, error: "order_verification_failed" };
      }

      const verification = verifyOrderForReward(order, parsed.data);
      if (!verification.ok) {
        reply.status(403);
        return { ok: false, error: verification.error };
      }
      if (!verification.rewardable) {
        return { ok: true, rewarded: false, reason: verification.reason };
      }

      await recordTradeReward({
        ...parsed.data,
        amountUsd: verification.amountUsd,
      });
      return { ok: true, rewarded: true, amountUsd: verification.amountUsd };
    },
  );
}
