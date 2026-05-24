/**
 * Trading profile service — SQLite-backed via services/db.ts.
 *
 * The old JSON flat-file store is kept for reference only; its path is passed
 * to migrateFromJsonStore() at server startup so any existing profiles carry over.
 */

import { resolve } from "node:path";
import type { BridgeDepositResponse, TradingProfile, TradingWalletKind } from "@smartmarket/types";
import { getProfile, upsertProfile, attachDeposit, migrateFromJsonStore } from "./db.js";

export const LEGACY_JSON_STORE_PATH = process.env.TRADING_PROFILE_STORE_PATH
  ? resolve(process.env.TRADING_PROFILE_STORE_PATH)
  : resolve(process.cwd(), "../../.data/trading-profiles.json");

export async function getTradingProfile(connectedWalletAddress: string): Promise<TradingProfile | null> {
  return getProfile(connectedWalletAddress);
}

export async function resolveTradingProfile(input: {
  connectedWalletAddress: string;
  tradingWalletAddress?: string;
  tradingWalletKind?: TradingWalletKind;
}): Promise<TradingProfile> {
  return upsertProfile(input);
}

export async function attachDepositAddress(
  connectedWalletAddress: string,
  deposit: BridgeDepositResponse
): Promise<TradingProfile> {
  return attachDeposit(connectedWalletAddress, deposit.address ?? {});
}

/** Run once at server boot to carry over any data from the legacy JSON store. */
export async function runLegacyMigration(log?: (msg: string) => void): Promise<void> {
  try {
    const count = await migrateFromJsonStore(LEGACY_JSON_STORE_PATH);
    if (count > 0) log?.(`Migrated ${count} trading profile(s) from JSON store to SQLite.`);
  } catch (err) {
    log?.(`Legacy profile migration skipped: ${String(err)}`);
  }
}
