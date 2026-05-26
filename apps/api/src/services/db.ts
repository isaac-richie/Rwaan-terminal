/**
 * Persistence service.
 *
 * Production uses Supabase/Postgres when SUPABASE_DB_URL or DATABASE_URL is set.
 * Local development and tests fall back to SQLite so the app remains easy to run.
 */

import Database, { type Database as SqliteDb } from "better-sqlite3";
import { Pool, type PoolConfig } from "pg";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { TradingProfile, TradingWalletKind, TradingProfileStatus } from "@smartmarket/types";

const EVM_RE = /^0x[a-fA-F0-9]{40}$/;

function assertEvmAddress(address: string, label: string) {
  if (!EVM_RE.test(address)) throw new Error(`invalid_${label}`);
}

function dbPath(): string {
  return process.env.TRADING_PROFILE_DB_PATH
    ? resolve(process.env.TRADING_PROFILE_DB_PATH)
    : resolve(process.cwd(), "../../.data/rawli.db");
}

function postgresUrl(): string {
  return process.env.SUPABASE_DB_URL?.trim() || process.env.DATABASE_URL?.trim() || "";
}

function usePostgres(): boolean {
  return Boolean(postgresUrl());
}

function postgresSsl(url: string): PoolConfig["ssl"] {
  if (process.env.SUPABASE_DB_SSL === "false") return undefined;
  if (/localhost|127\.0\.0\.1/i.test(url)) return undefined;
  return { rejectUnauthorized: false };
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const sqliteSchema = `
  CREATE TABLE IF NOT EXISTS trading_profiles (
    connected_wallet    TEXT PRIMARY KEY,
    trading_wallet      TEXT NOT NULL,
    trading_wallet_kind TEXT NOT NULL DEFAULT 'eoa',
    status              TEXT NOT NULL DEFAULT 'wallet_linked',
    funding_chain_id    TEXT NOT NULL DEFAULT '56',
    deposit_evm         TEXT,
    deposit_svm         TEXT,
    deposit_btc         TEXT,
    deposit_tvm         TEXT,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS verified_payments (
    tx_hash     TEXT PRIMARY KEY,
    payer       TEXT NOT NULL,
    market_id   TEXT NOT NULL,
    amount      TEXT NOT NULL,
    verified_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS gas_assists (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet     TEXT NOT NULL,
    amount_wei TEXT NOT NULL,
    tx_hash    TEXT,
    reason     TEXT,
    status     TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_gas_assists_wallet_created
    ON gas_assists(wallet, created_at);

  CREATE TABLE IF NOT EXISTS reward_events (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet         TEXT NOT NULL,
    event_type     TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    points         INTEGER NOT NULL,
    cashback_cents INTEGER NOT NULL DEFAULT 0,
    amount_usd     REAL NOT NULL DEFAULT 0,
    market_id      TEXT,
    metadata       TEXT NOT NULL DEFAULT '{}',
    created_at     TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_reward_events_wallet_created
    ON reward_events(wallet, created_at);

  CREATE TABLE IF NOT EXISTS referrals (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    referrer     TEXT NOT NULL,
    referee      TEXT NOT NULL UNIQUE,
    rewarded     INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_referrals_referrer
    ON referrals(referrer);
`;

const postgresSchema = `
  CREATE TABLE IF NOT EXISTS trading_profiles (
    connected_wallet    TEXT PRIMARY KEY,
    trading_wallet      TEXT NOT NULL,
    trading_wallet_kind TEXT NOT NULL DEFAULT 'eoa',
    status              TEXT NOT NULL DEFAULT 'wallet_linked',
    funding_chain_id    TEXT NOT NULL DEFAULT '56',
    deposit_evm         TEXT,
    deposit_svm         TEXT,
    deposit_btc         TEXT,
    deposit_tvm         TEXT,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS verified_payments (
    tx_hash     TEXT PRIMARY KEY,
    payer       TEXT NOT NULL,
    market_id   TEXT NOT NULL,
    amount      TEXT NOT NULL,
    verified_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS gas_assists (
    id         BIGSERIAL PRIMARY KEY,
    wallet     TEXT NOT NULL,
    amount_wei TEXT NOT NULL,
    tx_hash    TEXT,
    reason     TEXT,
    status     TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_gas_assists_wallet_created
    ON gas_assists(wallet, created_at);

  CREATE TABLE IF NOT EXISTS reward_events (
    id              BIGSERIAL PRIMARY KEY,
    wallet          TEXT NOT NULL,
    event_type      TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    points          INTEGER NOT NULL,
    cashback_cents  INTEGER NOT NULL DEFAULT 0,
    amount_usd      DOUBLE PRECISION NOT NULL DEFAULT 0,
    market_id       TEXT,
    metadata        TEXT NOT NULL DEFAULT '{}',
    created_at      TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_reward_events_wallet_created
    ON reward_events(wallet, created_at);

  CREATE TABLE IF NOT EXISTS referrals (
    id         BIGSERIAL PRIMARY KEY,
    referrer   TEXT NOT NULL,
    referee    TEXT NOT NULL UNIQUE,
    rewarded   BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_referrals_referrer
    ON referrals(referrer);
`;

// ---------------------------------------------------------------------------
// Connection singletons
// ---------------------------------------------------------------------------

let _sqlite: SqliteDb | null = null;
let _pg: Pool | null = null;
let _pgReady: Promise<Pool> | null = null;

export async function getDb(): Promise<SqliteDb> {
  if (usePostgres()) {
    throw new Error("sqlite_db_unavailable_when_postgres_enabled");
  }

  if (_sqlite) return _sqlite;

  const file = dbPath();
  await mkdir(dirname(file), { recursive: true });

  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("synchronous = NORMAL");
  db.exec(sqliteSchema);

  _sqlite = db;
  return db;
}

async function getPgPool(): Promise<Pool> {
  if (_pg) return _pg;
  if (_pgReady) return _pgReady;

  _pgReady = (async () => {
    const url = postgresUrl();
    if (!url) throw new Error("postgres_url_missing");

    const pool = new Pool({
      connectionString: url,
      ssl: postgresSsl(url),
      max: Number(process.env.SUPABASE_DB_POOL_MAX ?? 10),
    });

    await pool.query(postgresSchema);
    _pg = pool;
    return pool;
  })();

  try {
    return await _pgReady;
  } finally {
    _pgReady = null;
  }
}

export function closeTradingProfileDbForTests(): void {
  _sqlite?.close();
  _sqlite = null;
  void _pg?.end();
  _pg = null;
  _pgReady = null;
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

type ProfileRow = {
  connected_wallet: string;
  trading_wallet: string;
  trading_wallet_kind: string;
  status: string;
  funding_chain_id: string;
  deposit_evm: string | null;
  deposit_svm: string | null;
  deposit_btc: string | null;
  deposit_tvm: string | null;
  created_at: string;
  updated_at: string;
};

function rowToProfile(row: ProfileRow): TradingProfile {
  const hasDeposit = Boolean(row.deposit_evm || row.deposit_svm || row.deposit_btc || row.deposit_tvm);
  return {
    connectedWalletAddress: row.connected_wallet,
    tradingWalletAddress: row.trading_wallet,
    tradingWalletKind: row.trading_wallet_kind as TradingWalletKind,
    status: row.status as TradingProfileStatus,
    fundingChainId: "56",
    depositAddress: hasDeposit
      ? {
          evm: row.deposit_evm ?? undefined,
          svm: row.deposit_svm ?? undefined,
          btc: row.deposit_btc ?? undefined,
          tvm: row.deposit_tvm ?? undefined,
        }
      : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Trading profiles
// ---------------------------------------------------------------------------

export async function getProfile(connectedWallet: string): Promise<TradingProfile | null> {
  assertEvmAddress(connectedWallet, "connected_wallet");
  const key = connectedWallet.toLowerCase();

  if (usePostgres()) {
    const pool = await getPgPool();
    const { rows } = await pool.query<ProfileRow>(
      "SELECT * FROM trading_profiles WHERE connected_wallet = $1",
      [key],
    );
    return rows[0] ? rowToProfile(rows[0]) : null;
  }

  const db = await getDb();
  const row = db.prepare("SELECT * FROM trading_profiles WHERE connected_wallet = ?").get(key) as ProfileRow | undefined;
  return row ? rowToProfile(row) : null;
}

export async function upsertProfile(input: {
  connectedWalletAddress: string;
  tradingWalletAddress?: string;
  tradingWalletKind?: TradingWalletKind;
}): Promise<TradingProfile> {
  assertEvmAddress(input.connectedWalletAddress, "connected_wallet");
  if (input.tradingWalletAddress) assertEvmAddress(input.tradingWalletAddress, "trading_wallet");

  const key = input.connectedWalletAddress.toLowerCase();
  const now = new Date().toISOString();
  const existing = await getProfile(key);
  const tradingWallet = (input.tradingWalletAddress ?? existing?.tradingWalletAddress ?? key).toLowerCase();
  const kind = input.tradingWalletKind ?? existing?.tradingWalletKind ?? "eoa";
  const walletChanged = Boolean(existing && existing.tradingWalletAddress.toLowerCase() !== tradingWallet);
  const status: TradingProfileStatus = !walletChanged && existing?.depositAddress?.evm
    ? "deposit_ready"
    : walletChanged
    ? "wallet_linked"
    : existing?.status ?? "wallet_linked";
  const createdAt = existing?.createdAt ?? now;

  if (usePostgres()) {
    const pool = await getPgPool();
    const { rows } = await pool.query<ProfileRow>(
      `
        INSERT INTO trading_profiles
          (connected_wallet, trading_wallet, trading_wallet_kind, status,
           funding_chain_id, deposit_evm, deposit_svm, deposit_btc, deposit_tvm,
           created_at, updated_at)
        VALUES ($1, $2, $3, $4, '56', $5, $6, $7, $8, $9, $10)
        ON CONFLICT (connected_wallet) DO UPDATE SET
          trading_wallet      = EXCLUDED.trading_wallet,
          trading_wallet_kind = EXCLUDED.trading_wallet_kind,
          status              = EXCLUDED.status,
          deposit_evm         = EXCLUDED.deposit_evm,
          deposit_svm         = EXCLUDED.deposit_svm,
          deposit_btc         = EXCLUDED.deposit_btc,
          deposit_tvm         = EXCLUDED.deposit_tvm,
          updated_at          = EXCLUDED.updated_at
        RETURNING *
      `,
      [
        key,
        tradingWallet,
        kind,
        status,
        walletChanged ? null : existing?.depositAddress?.evm ?? null,
        walletChanged ? null : existing?.depositAddress?.svm ?? null,
        walletChanged ? null : existing?.depositAddress?.btc ?? null,
        walletChanged ? null : existing?.depositAddress?.tvm ?? null,
        createdAt,
        now,
      ],
    );
    return rowToProfile(rows[0]!);
  }

  const db = await getDb();
  db.prepare(`
    INSERT INTO trading_profiles
      (connected_wallet, trading_wallet, trading_wallet_kind, status,
       funding_chain_id, deposit_evm, deposit_svm, deposit_btc, deposit_tvm,
       created_at, updated_at)
    VALUES (?, ?, ?, ?, '56', ?, ?, ?, ?, ?, ?)
    ON CONFLICT(connected_wallet) DO UPDATE SET
      trading_wallet      = excluded.trading_wallet,
      trading_wallet_kind = excluded.trading_wallet_kind,
      status              = excluded.status,
      deposit_evm         = excluded.deposit_evm,
      deposit_svm         = excluded.deposit_svm,
      deposit_btc         = excluded.deposit_btc,
      deposit_tvm         = excluded.deposit_tvm,
      updated_at          = excluded.updated_at
  `).run(
    key,
    tradingWallet,
    kind,
    status,
    walletChanged ? null : existing?.depositAddress?.evm ?? null,
    walletChanged ? null : existing?.depositAddress?.svm ?? null,
    walletChanged ? null : existing?.depositAddress?.btc ?? null,
    walletChanged ? null : existing?.depositAddress?.tvm ?? null,
    createdAt,
    now,
  );

  const row = db.prepare("SELECT * FROM trading_profiles WHERE connected_wallet = ?").get(key) as ProfileRow;
  return rowToProfile(row);
}

export async function attachDeposit(
  connectedWallet: string,
  deposit: { evm?: string; svm?: string; btc?: string; tvm?: string },
): Promise<TradingProfile> {
  assertEvmAddress(connectedWallet, "connected_wallet");
  const key = connectedWallet.toLowerCase();
  const existing = await getProfile(key);
  if (!existing) throw new Error("profile_not_found");

  const now = new Date().toISOString();
  const newStatus: TradingProfileStatus = deposit.evm ? "deposit_ready" : existing.status;
  const nextDeposit = {
    evm: deposit.evm ?? existing.depositAddress?.evm ?? null,
    svm: deposit.svm ?? existing.depositAddress?.svm ?? null,
    btc: deposit.btc ?? existing.depositAddress?.btc ?? null,
    tvm: deposit.tvm ?? existing.depositAddress?.tvm ?? null,
  };

  if (usePostgres()) {
    const pool = await getPgPool();
    const { rows } = await pool.query<ProfileRow>(
      `
        UPDATE trading_profiles
        SET deposit_evm = $1,
            deposit_svm = $2,
            deposit_btc = $3,
            deposit_tvm = $4,
            status      = $5,
            updated_at  = $6
        WHERE connected_wallet = $7
        RETURNING *
      `,
      [nextDeposit.evm, nextDeposit.svm, nextDeposit.btc, nextDeposit.tvm, newStatus, now, key],
    );
    return rowToProfile(rows[0]!);
  }

  const db = await getDb();
  db.prepare(`
    UPDATE trading_profiles
    SET deposit_evm = ?,
        deposit_svm = ?,
        deposit_btc = ?,
        deposit_tvm = ?,
        status      = ?,
        updated_at  = ?
    WHERE connected_wallet = ?
  `).run(nextDeposit.evm, nextDeposit.svm, nextDeposit.btc, nextDeposit.tvm, newStatus, now, key);

  const row = db.prepare("SELECT * FROM trading_profiles WHERE connected_wallet = ?").get(key) as ProfileRow;
  return rowToProfile(row);
}

export async function migrateFromJsonStore(jsonPath: string): Promise<number> {
  const { readFile } = await import("node:fs/promises");
  let raw: string;
  try {
    raw = await readFile(jsonPath, "utf8");
  } catch {
    return 0;
  }

  let store: Record<string, unknown>;
  try {
    store = JSON.parse(raw);
  } catch {
    return 0;
  }

  let migrated = 0;
  for (const [key, value] of Object.entries(store)) {
    const p = value as Record<string, unknown>;
    try {
      const connectedWallet = key.toLowerCase();
      assertEvmAddress(connectedWallet, "connected_wallet");
      const tradingWallet = String(p.tradingWalletAddress ?? key).toLowerCase();
      assertEvmAddress(tradingWallet, "trading_wallet");
      const deposit = p.depositAddress as { evm?: string; svm?: string; btc?: string; tvm?: string } | undefined;
      const createdAt = String(p.createdAt ?? new Date().toISOString());
      const updatedAt = String(p.updatedAt ?? new Date().toISOString());

      if (usePostgres()) {
        const pool = await getPgPool();
        const result = await pool.query(
          `
            INSERT INTO trading_profiles
              (connected_wallet, trading_wallet, trading_wallet_kind, status,
               funding_chain_id, deposit_evm, deposit_svm, deposit_btc, deposit_tvm,
               created_at, updated_at)
            VALUES ($1, $2, $3, $4, '56', $5, $6, $7, $8, $9, $10)
            ON CONFLICT (connected_wallet) DO NOTHING
          `,
          [
            connectedWallet,
            tradingWallet,
            String(p.tradingWalletKind ?? "eoa"),
            String(p.status ?? "wallet_linked"),
            deposit?.evm ?? null,
            deposit?.svm ?? null,
            deposit?.btc ?? null,
            deposit?.tvm ?? null,
            createdAt,
            updatedAt,
          ],
        );
        migrated += result.rowCount ?? 0;
      } else {
        const db = await getDb();
        const result = db.prepare(`
          INSERT OR IGNORE INTO trading_profiles
            (connected_wallet, trading_wallet, trading_wallet_kind, status,
             funding_chain_id, deposit_evm, deposit_svm, deposit_btc, deposit_tvm,
             created_at, updated_at)
          VALUES (?, ?, ?, ?, '56', ?, ?, ?, ?, ?, ?)
        `).run(
          connectedWallet,
          tradingWallet,
          String(p.tradingWalletKind ?? "eoa"),
          String(p.status ?? "wallet_linked"),
          deposit?.evm ?? null,
          deposit?.svm ?? null,
          deposit?.btc ?? null,
          deposit?.tvm ?? null,
          createdAt,
          updatedAt,
        );
        migrated += result.changes;
      }
    } catch {
      // Skip malformed legacy entries.
    }
  }

  return migrated;
}

// ---------------------------------------------------------------------------
// Verified payments
// ---------------------------------------------------------------------------

export async function isVerifiedPaymentUsed(txHash: string): Promise<boolean> {
  const key = txHash.toLowerCase();

  if (usePostgres()) {
    const pool = await getPgPool();
    const result = await pool.query("SELECT 1 FROM verified_payments WHERE tx_hash = $1 LIMIT 1", [key]);
    return Boolean(result.rowCount);
  }

  const db = await getDb();
  const row = db.prepare("SELECT 1 FROM verified_payments WHERE tx_hash = ?").get(key);
  return Boolean(row);
}

export async function recordVerifiedPayment(input: {
  txHash: string;
  payer: string;
  marketId: string;
  amount: string;
}): Promise<void> {
  const txHash = input.txHash.toLowerCase();
  const payer = input.payer.toLowerCase();
  const verifiedAt = new Date().toISOString();

  if (usePostgres()) {
    const pool = await getPgPool();
    await pool.query(
      `
        INSERT INTO verified_payments (tx_hash, payer, market_id, amount, verified_at)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (tx_hash) DO NOTHING
      `,
      [txHash, payer, input.marketId, input.amount, verifiedAt],
    );
    return;
  }

  const db = await getDb();
  db.prepare(
    "INSERT OR IGNORE INTO verified_payments (tx_hash, payer, market_id, amount, verified_at) VALUES (?, ?, ?, ?, ?)",
  ).run(txHash, payer, input.marketId, input.amount, verifiedAt);
}

// ---------------------------------------------------------------------------
// Rewards
// ---------------------------------------------------------------------------

export type RewardEventInput = {
  wallet: string;
  eventType: string;
  idempotencyKey: string;
  points: number;
  cashbackCents?: number;
  amountUsd?: number;
  marketId?: string | null;
  metadata?: Record<string, unknown>;
};

export type RewardEventRow = {
  id: number;
  wallet: string;
  event_type: string;
  idempotency_key: string;
  points: number;
  cashback_cents: number;
  amount_usd: number;
  market_id: string | null;
  metadata: string;
  created_at: string;
};

export type RewardSummary = {
  wallet: string;
  totalPoints: number;
  cashbackCents: number;
  volumeUsd: number;
  trades: number;
  premiumUnlocks: number;
  events: Array<{
    id: number;
    eventType: string;
    points: number;
    cashbackCents: number;
    amountUsd: number;
    marketId: string | null;
    metadata: Record<string, unknown>;
    createdAt: string;
  }>;
};

export async function recordRewardEvent(input: RewardEventInput): Promise<void> {
  assertEvmAddress(input.wallet, "wallet");
  const wallet = input.wallet.toLowerCase();
  const idempotencyKey = input.idempotencyKey.trim();
  if (!idempotencyKey) throw new Error("invalid_reward_idempotency_key");

  const points = Math.max(0, Math.floor(input.points));
  const cashbackCents = Math.max(0, Math.floor(input.cashbackCents ?? 0));
  const amountUsd = Math.max(0, Number(input.amountUsd ?? 0));
  const metadata = JSON.stringify(input.metadata ?? {});
  const createdAt = new Date().toISOString();

  if (usePostgres()) {
    const pool = await getPgPool();
    await pool.query(
      `
        INSERT INTO reward_events
          (wallet, event_type, idempotency_key, points, cashback_cents, amount_usd, market_id, metadata, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (idempotency_key) DO NOTHING
      `,
      [wallet, input.eventType, idempotencyKey, points, cashbackCents, amountUsd, input.marketId ?? null, metadata, createdAt],
    );
    return;
  }

  const db = await getDb();
  db.prepare(
    `
      INSERT OR IGNORE INTO reward_events
        (wallet, event_type, idempotency_key, points, cashback_cents, amount_usd, market_id, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(wallet, input.eventType, idempotencyKey, points, cashbackCents, amountUsd, input.marketId ?? null, metadata, createdAt);
}

export async function getRewardSummary(walletInput: string): Promise<RewardSummary> {
  assertEvmAddress(walletInput, "wallet");
  const wallet = walletInput.toLowerCase();

  const parseMetadata = (raw: string): Record<string, unknown> => {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  };

  let rows: RewardEventRow[];
  let totals: {
    total_points: number | string | null;
    cashback_cents: number | string | null;
    volume_usd: number | string | null;
    trades: number | string | null;
    premium_unlocks: number | string | null;
  };
  if (usePostgres()) {
    const pool = await getPgPool();
    const [totalResult, eventResult] = await Promise.all([
      pool.query<{
        total_points: string | null;
        cashback_cents: string | null;
        volume_usd: string | null;
        trades: string | null;
        premium_unlocks: string | null;
      }>(
        `
          SELECT
            COALESCE(SUM(points), 0) AS total_points,
            COALESCE(SUM(cashback_cents), 0) AS cashback_cents,
            COALESCE(SUM(amount_usd), 0) AS volume_usd,
            COUNT(*) FILTER (WHERE event_type = 'trade_submitted') AS trades,
            COUNT(*) FILTER (WHERE event_type = 'premium_unlock') AS premium_unlocks
          FROM reward_events
          WHERE wallet = $1
        `,
        [wallet],
      ),
      pool.query<RewardEventRow>(
        `
        SELECT * FROM reward_events
        WHERE wallet = $1
        ORDER BY created_at DESC
        LIMIT 50
      `,
        [wallet],
      ),
    ]);
    totals = totalResult.rows[0] ?? {
      total_points: 0,
      cashback_cents: 0,
      volume_usd: 0,
      trades: 0,
      premium_unlocks: 0,
    };
    rows = eventResult.rows;
  } else {
    const db = await getDb();
    totals = db.prepare(
      `
        SELECT
          COALESCE(SUM(points), 0) AS total_points,
          COALESCE(SUM(cashback_cents), 0) AS cashback_cents,
          COALESCE(SUM(amount_usd), 0) AS volume_usd,
          SUM(CASE WHEN event_type = 'trade_submitted' THEN 1 ELSE 0 END) AS trades,
          SUM(CASE WHEN event_type = 'premium_unlock' THEN 1 ELSE 0 END) AS premium_unlocks
        FROM reward_events
        WHERE wallet = ?
      `,
    ).get(wallet) as typeof totals;
    rows = db.prepare(
      `
        SELECT * FROM reward_events
        WHERE wallet = ?
        ORDER BY created_at DESC
        LIMIT 50
      `,
    ).all(wallet) as RewardEventRow[];
  }

  return rows.reduce<RewardSummary>(
    (summary, row) => {
      summary.events.push({
        id: row.id,
        eventType: row.event_type,
        points: Number(row.points) || 0,
        cashbackCents: Number(row.cashback_cents) || 0,
        amountUsd: Number(row.amount_usd) || 0,
        marketId: row.market_id,
        metadata: parseMetadata(row.metadata),
        createdAt: row.created_at,
      });
      return summary;
    },
    {
      wallet,
      totalPoints: Number(totals.total_points) || 0,
      cashbackCents: Number(totals.cashback_cents) || 0,
      volumeUsd: Number(totals.volume_usd) || 0,
      trades: Number(totals.trades) || 0,
      premiumUnlocks: Number(totals.premium_unlocks) || 0,
      events: [],
    },
  );
}

/**
 * Returns the total number of trade_submitted events for a wallet across all time.
 * Used to detect a wallet's first-ever trade so the referral reward can be triggered.
 */
export async function getTotalTradeCount(walletInput: string): Promise<number> {
  assertEvmAddress(walletInput, "wallet");
  const wallet = walletInput.toLowerCase();

  if (usePostgres()) {
    const pool = await getPgPool();
    const { rows } = await pool.query<{ count: string }>(
      "SELECT COUNT(*) as count FROM reward_events WHERE wallet = $1 AND event_type = 'trade_submitted'",
      [wallet],
    );
    return Number(rows[0]?.count ?? 0);
  }

  const db = await getDb();
  const row = db
    .prepare("SELECT COUNT(*) as count FROM reward_events WHERE wallet = ? AND event_type = 'trade_submitted'")
    .get(wallet) as { count: number } | undefined;
  return Number(row?.count ?? 0);
}

export type LeaderboardRow = {
  rank: number;
  wallet: string;
  totalPoints: number;
  trades: number;
  tier: string;
};

/**
 * Returns the top N wallets by total points for the leaderboard.
 */
export async function getLeaderboard(limit = 50): Promise<LeaderboardRow[]> {
  if (usePostgres()) {
    const pool = await getPgPool();
    const { rows } = await pool.query<{ wallet: string; total_points: string; trades: string }>(
      `
        SELECT
          wallet,
          SUM(points)                                                             AS total_points,
          COUNT(*) FILTER (WHERE event_type = 'trade_submitted')                 AS trades
        FROM reward_events
        GROUP BY wallet
        ORDER BY total_points DESC
        LIMIT $1
      `,
      [limit],
    );
    return rows.map((row, i) => ({
      rank: i + 1,
      wallet: row.wallet,
      totalPoints: Number(row.total_points) || 0,
      trades: Number(row.trades) || 0,
      tier: tierLabel(Number(row.total_points) || 0),
    }));
  }

  const db = await getDb();
  const rows = db
    .prepare(
      `
        SELECT
          wallet,
          SUM(points)                                                             AS total_points,
          SUM(CASE WHEN event_type = 'trade_submitted' THEN 1 ELSE 0 END)        AS trades
        FROM reward_events
        GROUP BY wallet
        ORDER BY total_points DESC
        LIMIT ?
      `,
    )
    .all(limit) as { wallet: string; total_points: number; trades: number }[];

  return rows.map((row, i) => ({
    rank: i + 1,
    wallet: row.wallet,
    totalPoints: Number(row.total_points) || 0,
    trades: Number(row.trades) || 0,
    tier: tierLabel(Number(row.total_points) || 0),
  }));
}

function tierLabel(points: number): string {
  if (points >= 7500) return "Oracle";
  if (points >= 2000) return "Strategist";
  if (points >= 500) return "Analyst";
  return "Observer";
}

export async function getRewardEventsSince(walletInput: string, sinceIso: string): Promise<RewardEventRow[]> {
  assertEvmAddress(walletInput, "wallet");
  const wallet = walletInput.toLowerCase();

  if (usePostgres()) {
    const pool = await getPgPool();
    const result = await pool.query<RewardEventRow>(
      `
        SELECT * FROM reward_events
        WHERE wallet = $1 AND created_at >= $2
        ORDER BY created_at DESC
      `,
      [wallet, sinceIso],
    );
    return result.rows;
  }

  const db = await getDb();
  return db.prepare(
    `
      SELECT * FROM reward_events
      WHERE wallet = ? AND created_at >= ?
      ORDER BY created_at DESC
    `,
  ).all(wallet, sinceIso) as RewardEventRow[];
}

// ---------------------------------------------------------------------------
// Gas assists
// ---------------------------------------------------------------------------

export type GasAssistRow = {
  id: number;
  wallet: string;
  amount_wei: string;
  tx_hash: string | null;
  reason: string | null;
  status: string;
  created_at: string;
};

export async function getRecentGasAssist(wallet: string, sinceIso: string): Promise<GasAssistRow | null> {
  assertEvmAddress(wallet, "wallet");
  const key = wallet.toLowerCase();

  if (usePostgres()) {
    const pool = await getPgPool();
    const { rows } = await pool.query<GasAssistRow>(
      `
        SELECT * FROM gas_assists
        WHERE wallet = $1 AND created_at >= $2 AND status = 'sent'
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [key, sinceIso],
    );
    return rows[0] ?? null;
  }

  const db = await getDb();
  const row = db
    .prepare(`
      SELECT * FROM gas_assists
      WHERE wallet = ? AND created_at >= ? AND status = 'sent'
      ORDER BY created_at DESC
      LIMIT 1
    `)
    .get(key, sinceIso) as GasAssistRow | undefined;
  return row ?? null;
}

export async function recordGasAssist(input: {
  wallet: string;
  amountWei: string;
  txHash?: string;
  reason?: string;
  status: "sent" | "failed";
}): Promise<void> {
  assertEvmAddress(input.wallet, "wallet");
  const key = input.wallet.toLowerCase();
  const createdAt = new Date().toISOString();

  if (usePostgres()) {
    const pool = await getPgPool();
    await pool.query(
      `
        INSERT INTO gas_assists (wallet, amount_wei, tx_hash, reason, status, created_at)
        VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [key, input.amountWei, input.txHash ?? null, input.reason ?? null, input.status, createdAt],
    );
    return;
  }

  const db = await getDb();
  db.prepare(`
    INSERT INTO gas_assists (wallet, amount_wei, tx_hash, reason, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(key, input.amountWei, input.txHash ?? null, input.reason ?? null, input.status, createdAt);
}

// ---------------------------------------------------------------------------
// Referrals
// ---------------------------------------------------------------------------

export type ReferralStats = {
  referrer: string;
  totalReferrals: number;
  rewardedReferrals: number;
  pendingReferrals: number;
};

/**
 * Record a new referee linking to a referrer.
 * Returns false if the referee already has a referrer (idempotent).
 */
export async function recordReferral(input: {
  referrer: string;
  referee: string;
}): Promise<{ recorded: boolean; alreadyReferred: boolean }> {
  assertEvmAddress(input.referrer, "referrer");
  assertEvmAddress(input.referee, "referee");
  if (input.referrer.toLowerCase() === input.referee.toLowerCase()) {
    return { recorded: false, alreadyReferred: false };
  }

  const referrer = input.referrer.toLowerCase();
  const referee = input.referee.toLowerCase();
  const createdAt = new Date().toISOString();

  if (usePostgres()) {
    const pool = await getPgPool();
    const result = await pool.query(
      `
        INSERT INTO referrals (referrer, referee, rewarded, created_at)
        VALUES ($1, $2, FALSE, $3)
        ON CONFLICT (referee) DO NOTHING
      `,
      [referrer, referee, createdAt],
    );
    const inserted = (result.rowCount ?? 0) > 0;
    return { recorded: inserted, alreadyReferred: !inserted };
  }

  const db = await getDb();
  const result = db
    .prepare("INSERT OR IGNORE INTO referrals (referrer, referee, rewarded, created_at) VALUES (?, ?, 0, ?)")
    .run(referrer, referee, createdAt);
  const inserted = result.changes > 0;
  return { recorded: inserted, alreadyReferred: !inserted };
}

export async function getReferralStats(walletInput: string): Promise<ReferralStats> {
  assertEvmAddress(walletInput, "wallet");
  const referrer = walletInput.toLowerCase();

  if (usePostgres()) {
    const pool = await getPgPool();
    const { rows } = await pool.query<{ total: string; rewarded: string }>(
      `
        SELECT
          COUNT(*)                                     AS total,
          COUNT(*) FILTER (WHERE rewarded = TRUE)      AS rewarded
        FROM referrals
        WHERE referrer = $1
      `,
      [referrer],
    );
    const total = Number(rows[0]?.total ?? 0);
    const rewardedCount = Number(rows[0]?.rewarded ?? 0);
    return {
      referrer,
      totalReferrals: total,
      rewardedReferrals: rewardedCount,
      pendingReferrals: total - rewardedCount,
    };
  }

  const db = await getDb();
  const row = db
    .prepare("SELECT COUNT(*) as total, SUM(rewarded) as rewarded FROM referrals WHERE referrer = ?")
    .get(referrer) as { total: number; rewarded: number | null };
  const total = Number(row?.total ?? 0);
  const rewardedCount = Number(row?.rewarded ?? 0);
  return {
    referrer,
    totalReferrals: total,
    rewardedReferrals: rewardedCount,
    pendingReferrals: total - rewardedCount,
  };
}

export async function markReferralRewarded(referee: string): Promise<void> {
  const key = referee.toLowerCase();

  if (usePostgres()) {
    const pool = await getPgPool();
    await pool.query("UPDATE referrals SET rewarded = TRUE WHERE referee = $1", [key]);
    return;
  }

  const db = await getDb();
  db.prepare("UPDATE referrals SET rewarded = 1 WHERE referee = ?").run(key);
}

/**
 * Look up who referred a given wallet. Returns null if not referred.
 */
export async function getReferrerForReferee(referee: string): Promise<string | null> {
  const key = referee.toLowerCase();

  if (usePostgres()) {
    const pool = await getPgPool();
    const { rows } = await pool.query<{ referrer: string }>(
      "SELECT referrer FROM referrals WHERE referee = $1 AND rewarded = FALSE LIMIT 1",
      [key],
    );
    return rows[0]?.referrer ?? null;
  }

  const db = await getDb();
  const row = db
    .prepare("SELECT referrer FROM referrals WHERE referee = ? AND rewarded = 0 LIMIT 1")
    .get(key) as { referrer: string } | undefined;
  return row?.referrer ?? null;
}
