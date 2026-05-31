import { describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

vi.mock("./services/polymarket.js", async () => {
  const actual = await vi.importActual<typeof import("./services/polymarket.js")>("./services/polymarket.js");
  return {
    ...actual,
    getClobAuthenticated: vi.fn(),
  };
});

const { buildServer } = await import("./server.js");
const { closeTradingProfileDbForTests } = await import("./services/db.js");
const { getClobAuthenticated } = await import("./services/polymarket.js");
const { recordPremiumUnlockReward } = await import("./services/rewards.js");

const walletA = "0x0000000000000000000000000000000000000001";
const walletB = "0x0000000000000000000000000000000000000002";
const tokenId = "123456789";

const clobHeaders = {
  POLY_ADDRESS: walletA,
  POLY_SIGNATURE: "signature",
  POLY_TIMESTAMP: "123",
  POLY_API_KEY: "key",
  POLY_PASSPHRASE: "passphrase",
};

async function withRewardStore<T>(fn: () => Promise<T>): Promise<T> {
  const originalDb = process.env.TRADING_PROFILE_DB_PATH;
  const originalSupabaseDb = process.env.SUPABASE_DB_URL;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const dir = await mkdtemp(join(tmpdir(), "rawli-points-test-"));
  closeTradingProfileDbForTests();
  process.env.TRADING_PROFILE_DB_PATH = join(dir, "points.sqlite");
  delete process.env.SUPABASE_DB_URL;
  delete process.env.DATABASE_URL;

  try {
    return await fn();
  } finally {
    closeTradingProfileDbForTests();
    if (originalDb === undefined) {
      delete process.env.TRADING_PROFILE_DB_PATH;
    } else {
      process.env.TRADING_PROFILE_DB_PATH = originalDb;
    }
    if (originalSupabaseDb === undefined) {
      delete process.env.SUPABASE_DB_URL;
    } else {
      process.env.SUPABASE_DB_URL = originalSupabaseDb;
    }
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
    await rm(dir, { recursive: true, force: true });
    vi.mocked(getClobAuthenticated).mockReset();
  }
}

function tradePayload(orderId: string) {
  return {
    wallet: walletA,
    tradingWalletAddress: walletA,
    orderId,
    marketId: "market-1",
    tokenId,
    amountUsd: 999,
    quickSettle: true,
    crypto: false,
    premium: false,
  };
}

describe("points routes", () => {
  it("rejects browser trade rewards without CLOB order proof", async () => {
    await withRewardStore(async () => {
      const app = buildServer();
      const res = await app.inject({
        method: "POST",
        url: "/points/events/trade",
        payload: tradePayload("order-no-proof"),
      });

      expect(res.statusCode).toBe(401);
      expect(res.json().error).toBe("missing_clob_order_proof");
    });
  });

  it("awards points only for verified matched CLOB volume", async () => {
    await withRewardStore(async () => {
      vi.mocked(getClobAuthenticated).mockResolvedValueOnce({
        owner: walletA,
        maker_address: walletA,
        asset_id: tokenId,
        price: "0.5",
        original_size: "20",
        size_matched: "10",
      });

      const app = buildServer();
      const rewardRes = await app.inject({
        method: "POST",
        url: "/points/events/trade",
        headers: clobHeaders,
        payload: tradePayload("order-matched"),
      });
      expect(rewardRes.statusCode).toBe(200);
      expect(rewardRes.json()).toMatchObject({ ok: true, rewarded: true, amountUsd: 5 });

      const summaryRes = await app.inject({ method: "GET", url: `/points/summary/${walletA}` });
      expect(summaryRes.statusCode).toBe(200);
      expect(summaryRes.json().summary.volumeUsd).toBe(5);
      expect(summaryRes.json().summary.trades).toBe(1);
      expect(summaryRes.json().summary.totalPoints).toBe(55);
      expect(summaryRes.json().summary.events.map((event: any) => event.eventType)).toContain("daily_quest_completed");
    });
  });

  it("does not award points for an unfilled order", async () => {
    await withRewardStore(async () => {
      vi.mocked(getClobAuthenticated).mockResolvedValueOnce({
        owner: walletA,
        asset_id: tokenId,
        price: "0.5",
        original_size: "20",
        size_matched: "0",
      });

      const app = buildServer();
      const rewardRes = await app.inject({
        method: "POST",
        url: "/points/events/trade",
        headers: clobHeaders,
        payload: tradePayload("order-resting"),
      });
      expect(rewardRes.statusCode).toBe(200);
      expect(rewardRes.json()).toMatchObject({ ok: true, rewarded: false, reason: "order_not_filled" });

      const summaryRes = await app.inject({ method: "GET", url: `/points/summary/${walletA}` });
      expect(summaryRes.json().summary.trades).toBe(0);
    });
  });

  it("rejects a verified order owned by a different wallet", async () => {
    await withRewardStore(async () => {
      vi.mocked(getClobAuthenticated).mockResolvedValueOnce({
        owner: walletB,
        asset_id: tokenId,
        price: "0.5",
        original_size: "20",
        size_matched: "10",
      });

      const app = buildServer();
      const res = await app.inject({
        method: "POST",
        url: "/points/events/trade",
        headers: clobHeaders,
        payload: tradePayload("order-foreign"),
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe("order_owner_mismatch");
    });
  });

  it("credits paid premium analysis unlocks with the higher reward", async () => {
    await withRewardStore(async () => {
      const app = buildServer();
      await recordPremiumUnlockReward({
        wallet: walletA,
        txHash: "0xabc123",
        marketId: "market-premium",
        amountRaw: "1000000000000000000",
      });

      const summaryRes = await app.inject({ method: "GET", url: `/points/summary/${walletA}` });
      const summary = summaryRes.json().summary;

      expect(summaryRes.statusCode).toBe(200);
      expect(summary.totalPoints).toBe(175);
      expect(summary.premiumUnlocks).toBe(1);
      expect(summary.cashbackCents).toBe(5);
      expect(summary.events.map((event: any) => event.eventType)).toEqual(
        expect.arrayContaining(["premium_unlock", "daily_quest_completed"]),
      );
    });
  });

  it("tracks referral codes and credits the referrer after the referee's first trade", async () => {
    await withRewardStore(async () => {
      const app = buildServer();

      const codeRes = await app.inject({ method: "GET", url: `/referral/code/${walletB}` });
      expect(codeRes.statusCode).toBe(200);
      const referralCode = codeRes.json().code as string;
      expect(referralCode).toMatch(/^RW[A-Z0-9]{8,}$/);

      const trackRes = await app.inject({
        method: "POST",
        url: "/referral/track",
        payload: { referrer: referralCode, referee: walletA },
      });
      expect(trackRes.statusCode).toBe(200);
      expect(trackRes.json()).toMatchObject({
        ok: true,
        recorded: true,
        referrer: walletB,
        refereePoints: 50,
        referrerRewardPoints: 500,
      });

      const duplicateTrackRes = await app.inject({
        method: "POST",
        url: "/referral/track",
        payload: { referrer: referralCode, referee: walletA },
      });
      expect(duplicateTrackRes.statusCode).toBe(200);
      expect(duplicateTrackRes.json()).toMatchObject({
        ok: true,
        recorded: false,
        alreadyReferred: true,
        refereePoints: 0,
      });

      const refereeSummaryBeforeTradeRes = await app.inject({ method: "GET", url: `/points/summary/${walletA}` });
      expect(refereeSummaryBeforeTradeRes.statusCode).toBe(200);
      expect(refereeSummaryBeforeTradeRes.json().summary.totalPoints).toBe(50);
      expect(refereeSummaryBeforeTradeRes.json().summary.events.map((event: any) => event.eventType)).toContain("referral_join_bonus");

      vi.mocked(getClobAuthenticated).mockResolvedValueOnce({
        owner: walletA,
        maker_address: walletA,
        asset_id: tokenId,
        price: "0.5",
        original_size: "20",
        size_matched: "10",
      });

      const rewardRes = await app.inject({
        method: "POST",
        url: "/points/events/trade",
        headers: clobHeaders,
        payload: tradePayload("order-referred-first-trade"),
      });
      expect(rewardRes.statusCode).toBe(200);

      const statsRes = await app.inject({ method: "GET", url: `/referral/stats/${walletB}` });
      expect(statsRes.statusCode).toBe(200);
      expect(statsRes.json()).toMatchObject({
        totalReferrals: 1,
        rewardedReferrals: 1,
        pendingReferrals: 0,
        rewardPoints: 500,
      });

      const referrerSummaryRes = await app.inject({ method: "GET", url: `/points/summary/${walletB}` });
      expect(referrerSummaryRes.statusCode).toBe(200);
      expect(referrerSummaryRes.json().summary.totalPoints).toBe(500);
      expect(referrerSummaryRes.json().summary.events.map((event: any) => event.eventType)).toContain("referral_reward");
    });
  });
});
