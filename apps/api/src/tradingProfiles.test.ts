import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildServer } from "./server.js";
import { closeTradingProfileDbForTests } from "./services/db.js";

const walletA = "0x0000000000000000000000000000000000000001";
const walletB = "0x0000000000000000000000000000000000000002";
const walletC = "0x0000000000000000000000000000000000000003";

async function withProfileStore<T>(fn: () => Promise<T>): Promise<T> {
  const originalStore = process.env.TRADING_PROFILE_STORE_PATH;
  const originalDb = process.env.TRADING_PROFILE_DB_PATH;
  const originalSupabaseDb = process.env.SUPABASE_DB_URL;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const dir = await mkdtemp(join(tmpdir(), "rawli-profile-guard-test-"));

  closeTradingProfileDbForTests();
  process.env.TRADING_PROFILE_STORE_PATH = join(dir, "profiles.json");
  process.env.TRADING_PROFILE_DB_PATH = join(dir, "profiles.sqlite");
  delete process.env.SUPABASE_DB_URL;
  delete process.env.DATABASE_URL;

  try {
    return await fn();
  } finally {
    closeTradingProfileDbForTests();
    if (originalStore === undefined) {
      delete process.env.TRADING_PROFILE_STORE_PATH;
    } else {
      process.env.TRADING_PROFILE_STORE_PATH = originalStore;
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

describe("trading profile mutation guard", () => {
  it("creates a new profile with an explicit trading wallet", async () => {
    await withProfileStore(async () => {
      const app = buildServer();
      const res = await app.inject({
        method: "POST",
        url: "/trading-profile/resolve",
        payload: {
          connectedWalletAddress: walletA,
          tradingWalletAddress: walletB,
          tradingWalletKind: "deposit",
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().profile).toMatchObject({
        connectedWalletAddress: walletA,
        tradingWalletAddress: walletB,
        tradingWalletKind: "deposit",
        status: "wallet_linked",
      });
    });
  });

  it("does not let public resolve overwrite an existing trading wallet", async () => {
    await withProfileStore(async () => {
      const app = buildServer();
      const created = await app.inject({
        method: "POST",
        url: "/trading-profile/resolve",
        payload: {
          connectedWalletAddress: walletA,
          tradingWalletAddress: walletB,
          tradingWalletKind: "deposit",
        },
      });
      expect(created.statusCode).toBe(200);

      const attemptedMutation = await app.inject({
        method: "POST",
        url: "/trading-profile/resolve",
        payload: {
          connectedWalletAddress: walletA,
          tradingWalletAddress: walletC,
          tradingWalletKind: "safe",
        },
      });

      expect(attemptedMutation.statusCode).toBe(200);
      expect(attemptedMutation.json()).toMatchObject({
        unchanged: true,
        reason: "profile_mutation_blocked",
        profile: {
          connectedWalletAddress: walletA,
          tradingWalletAddress: walletB,
          tradingWalletKind: "deposit",
        },
      });

      const persisted = await app.inject({ method: "GET", url: `/trading-profile/${walletA}` });
      expect(persisted.statusCode).toBe(200);
      expect(persisted.json().profile).toMatchObject({
        connectedWalletAddress: walletA,
        tradingWalletAddress: walletB,
        tradingWalletKind: "deposit",
      });
    });
  });
});
