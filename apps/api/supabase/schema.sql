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
