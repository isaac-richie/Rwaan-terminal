import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { TradeReadinessCheck } from "@smartmarket/types";
import { buildServer } from "./server.js";
import { closeTradingProfileDbForTests } from "./services/db.js";
import { normalizeFundingStatus } from "./services/fundingStatus.js";
import { buildBuyPreview, parseBookLevels, parseStringArray } from "./services/tradePreview.js";
import { buildTradeReadiness } from "./services/tradeReadiness.js";

const ok = (status: number) => status >= 200 && status < 300;
const walletA = "0x0000000000000000000000000000000000000001";
const walletB = "0x0000000000000000000000000000000000000002";
const UPSTREAM_TEST_TIMEOUT_MS = 15000;

async function withProfileStore<T>(fn: () => Promise<T>): Promise<T> {
  const original = process.env.TRADING_PROFILE_STORE_PATH;
  const originalDb = process.env.TRADING_PROFILE_DB_PATH;
  const originalSupabaseDb = process.env.SUPABASE_DB_URL;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const dir = await mkdtemp(join(tmpdir(), "rawli-profile-test-"));
  closeTradingProfileDbForTests();
  process.env.TRADING_PROFILE_STORE_PATH = join(dir, "profiles.json");
  process.env.TRADING_PROFILE_DB_PATH = join(dir, "profiles.sqlite");
  delete process.env.SUPABASE_DB_URL;
  delete process.env.DATABASE_URL;
  try {
    return await fn();
  } finally {
    closeTradingProfileDbForTests();
    if (original === undefined) {
      delete process.env.TRADING_PROFILE_STORE_PATH;
    } else {
      process.env.TRADING_PROFILE_STORE_PATH = original;
    }
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
  }
}

describe("api routes", () => {
  it("health responds", async () => {
    const app = buildServer();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("records backend errors behind the ops endpoint", async () => {
    const originalToken = process.env.OPS_TOKEN;
    process.env.OPS_TOKEN = "test-ops-token";
    try {
      const app = buildServer();
      app.get("/test/error-logger", async () => {
        throw new Error("synthetic backend failure");
      });

      const failed = await app.inject({ method: "GET", url: "/test/error-logger" });
      expect(failed.statusCode).toBe(500);
      expect(failed.json().error).toBe("internal_error");
      expect(failed.json().errorId).toBeTruthy();

      const unauthorized = await app.inject({ method: "GET", url: "/ops/errors/recent" });
      expect(unauthorized.statusCode).toBe(404);

      const recent = await app.inject({
        method: "GET",
        url: "/ops/errors/recent?limit=5",
        headers: { authorization: "Bearer test-ops-token" },
      });
      expect(recent.statusCode).toBe(200);
      expect(recent.json().errors[0]).toMatchObject({
        message: "synthetic backend failure",
        statusCode: 500,
        method: "GET",
        url: "/test/error-logger",
      });
    } finally {
      if (originalToken === undefined) {
        delete process.env.OPS_TOKEN;
      } else {
        process.env.OPS_TOKEN = originalToken;
      }
    }
  });

  it("geoblock route returns json", async () => {
    const app = buildServer();
    const res = await app.inject({ method: "GET", url: "/geoblock" });
    expect(ok(res.statusCode)).toBe(true);
    expect(() => res.json()).not.toThrow();
  }, UPSTREAM_TEST_TIMEOUT_MS);

  it("bridge supported-assets returns json", async () => {
    const app = buildServer();
    const res = await app.inject({ method: "GET", url: "/bridge/supported-assets" });
    expect(ok(res.statusCode)).toBe(true);
    expect(() => res.json()).not.toThrow();
  }, UPSTREAM_TEST_TIMEOUT_MS);

  it("bridge quote rejects stale payload shape", async () => {
    const app = buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/bridge/quote",
      payload: {
        fromChainId: 56,
        fromTokenAddress: "0x0000000000000000000000000000000000000000",
        toChainId: 137,
        toTokenAddress: "0x0000000000000000000000000000000000000000",
        amount: "1000000"
      }
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_quote_payload");
  });

  it("funding quote is restricted to BNB Smart Chain", async () => {
    const app = buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/funding/quote",
      payload: {
        fromAmountBaseUnit: "1000000",
        fromChainId: "137",
        fromTokenAddress: "0x0000000000000000000000000000000000000000",
        recipientAddress: "0x0000000000000000000000000000000000000001",
        toChainId: "137",
        toTokenAddress: "0x0000000000000000000000000000000000000000"
      }
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_bnb_quote_payload");
  });

  it("funding deposit address requires a trading wallet address", async () => {
    const app = buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/funding/deposit-address",
      payload: { tradingWalletAddress: "not-an-address" }
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_deposit_address_payload");
  });

  it("normalizes funding status into a bridge phase", () => {
    const status = normalizeFundingStatus(walletA, {
      transactions: [
        { status: "DEPOSIT_DETECTED", txHash: "0xabc", createdTimeMs: 10 },
        { status: "COMPLETED", txHash: "0xdef", createdTimeMs: 20 }
      ]
    }, new Date("2026-05-04T00:00:00.000Z"));

    expect(status.phase).toBe("completed");
    expect(status.latest?.txHash).toBe("0xdef");
    expect(status.transactions?.[0]?.status).toBe("COMPLETED");
    expect(status.updatedAt).toBe("2026-05-04T00:00:00.000Z");
  });

  it("resolves a new EOA trading profile", async () => {
    await withProfileStore(async () => {
      const app = buildServer();
      const res = await app.inject({
        method: "POST",
        url: "/trading-profile/resolve",
        payload: { connectedWalletAddress: walletA }
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.profile.connectedWalletAddress).toBe(walletA);
      expect(body.profile.tradingWalletAddress).toBe(walletA);
      expect(body.profile.tradingWalletKind).toBe("eoa");
      expect(body.profile.status).toBe("wallet_linked");
      expect(body.profile.fundingChainId).toBe("56");
    });
  });

  it("can resolve a profile with a separate trading wallet", async () => {
    await withProfileStore(async () => {
      const app = buildServer();
      const res = await app.inject({
        method: "POST",
        url: "/trading-profile/resolve",
        payload: {
          connectedWalletAddress: walletA,
          tradingWalletAddress: walletB,
          tradingWalletKind: "safe"
        }
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.profile.connectedWalletAddress).toBe(walletA);
      expect(body.profile.tradingWalletAddress).toBe(walletB);
      expect(body.profile.tradingWalletKind).toBe("safe");
    });
  });

  it("returns 404 for unknown trading profiles", async () => {
    await withProfileStore(async () => {
      const app = buildServer();
      const res = await app.inject({ method: "GET", url: `/trading-profile/${walletA}` });
      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("profile_not_found");
    });
  });

  it("gamma markets returns json", async () => {
    const app = buildServer();
    const res = await app.inject({ method: "GET", url: "/gamma/markets?limit=1" });
    expect(ok(res.statusCode)).toBe(true);
    expect(() => res.json()).not.toThrow();
  }, UPSTREAM_TEST_TIMEOUT_MS);

  it("clob markets returns json", async () => {
    const app = buildServer();
    const res = await app.inject({ method: "GET", url: "/clob/markets" });
    expect(ok(res.statusCode)).toBe(true);
    expect(() => res.json()).not.toThrow();
  }, UPSTREAM_TEST_TIMEOUT_MS);

  it("analysis unlock returns analysis", async () => {
    const app = buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/analysis/unlock",
      payload: {
        market: {
          id: "m1",
          question: "Will BTC close above $100k this year?",
          outcomes: [{ name: "Yes", price: 54 }, { name: "No", price: 46 }]
        }
      }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(res.json().analysis.eventBrief).toBeTruthy();
  }, 35000);

  it("analysis quote advertises direct analysis", async () => {
    const app = buildServer();
    const res = await app.inject({ method: "GET", url: "/analysis/quote" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.rail).toBe("direct");
  });

  it("trade preview rejects invalid payloads", async () => {
    const app = buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/trade/preview",
      payload: { marketId: "540816", side: "BUY", amountUsd: 25 }
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_preview_payload");
  });

  it("parses Gamma token ids from JSON strings", () => {
    expect(parseStringArray('["111","222"]')).toEqual(["111", "222"]);
    expect(parseStringArray(["333", 444])).toEqual(["333", "444"]);
    expect(parseStringArray("not-json")).toEqual([]);
  });

  it("parses object-shaped CLOB asks and builds a buy preview", () => {
    const asks = parseBookLevels(
      {
        asks: [
          { price: "0.55", size: "20" },
          { price: "0.5", size: "10" }
        ]
      },
      "asks"
    );
    const preview = buildBuyPreview({ amountUsd: 13.25, asks, minOrderSize: 1, tickSize: 0.01 });
    expect(asks).toEqual([
      { price: 0.5, size: 10 },
      { price: 0.55, size: 20 }
    ]);
    expect(preview.filledAmountUsd).toBe(13.25);
    expect(preview.unfilledAmountUsd).toBe(0);
    expect(preview.estimatedShares).toBe(25);
    expect(preview.avgPrice).toBe(0.53);
    expect(preview.maxPrice).toBe(0.55);
  });

  it("checks buy minimum order size against estimated shares, not dollars", () => {
    const preview = buildBuyPreview({
      amountUsd: 3,
      asks: [{ price: 0.17, size: 100 }],
      minOrderSize: 5
    });

    expect(preview.estimatedShares).toBe(17.6471);
    expect(preview.warnings.some((warning) => warning.code === "amount_below_min_order_size")).toBe(false);
  });

  it("trade preview reports insufficient visible liquidity", () => {
    const preview = buildBuyPreview({
      amountUsd: 20,
      asks: [{ price: 0.5, size: 10 }],
      minOrderSize: 1
    });
    expect(preview.filledAmountUsd).toBe(5);
    expect(preview.unfilledAmountUsd).toBe(15);
    expect(preview.warnings.some((warning) => warning.code === "insufficient_visible_liquidity")).toBe(true);
  });

  it("trade readiness returns auth-required before a CLOB session exists", async () => {
    const app = buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/trade/readiness",
      payload: {
        connectedWalletAddress: walletA,
        tradingWalletAddress: walletA,
        tradingWalletKind: "eoa",
        amountUsd: 25
      }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.canPreview).toBe(true);
    expect(body.canExecute).toBe(false);
    expect(body.auth.clobSessionPresent).toBe(false);
    expect(body.checks.find((check: any) => check.code === "clob_session")?.status).toBe("auth_required");
    expect(body.checks.find((check: any) => check.code === "collateral_balance_allowance")?.status).toBe("auth_required");
  });

  it("trade readiness can include a collateral snapshot", () => {
    const readiness = buildTradeReadiness({
      connectedWalletAddress: walletA,
      tradingWalletAddress: walletA,
      depositAddress: walletB,
      clobSessionHeaders: {
        POLY_ADDRESS: walletA,
        POLY_SIGNATURE: "signature",
        POLY_TIMESTAMP: "123",
        POLY_API_KEY: "key",
        POLY_PASSPHRASE: "passphrase"
      },
      collateral: {
        balance: "100",
        allowance: "100",
        assetType: "COLLATERAL"
      },
      amountUsd: 25
    });
    expect(readiness.auth.clobSessionPresent).toBe(true);
    expect(readiness.checks.find((check: TradeReadinessCheck) => check.code === "collateral_balance_allowance")?.status).toBe("ready");
    expect(readiness.canExecute).toBe(true);
    expect(readiness.executionLockedReason).toBe("");
  });

  it("trade readiness blocks execution when collateral is below order amount", () => {
    const readiness = buildTradeReadiness({
      connectedWalletAddress: walletA,
      tradingWalletAddress: walletA,
      depositAddress: walletB,
      clobSessionHeaders: {
        POLY_ADDRESS: walletA,
        POLY_SIGNATURE: "signature",
        POLY_TIMESTAMP: "123",
        POLY_API_KEY: "key",
        POLY_PASSPHRASE: "passphrase"
      },
      collateral: {
        balance: "10",
        allowance: "100",
        assetType: "COLLATERAL"
      },
      amountUsd: 25
    });
    const collateral = readiness.checks.find((check: TradeReadinessCheck) => check.code === "collateral_balance_allowance");
    expect(collateral?.status).toBe("blocked");
    expect(collateral?.message).toContain("balance is below");
    expect(readiness.canExecute).toBe(false);
  });
});
