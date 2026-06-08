import type {
  BalanceAllowanceSnapshot,
  TradeReadinessCheck,
  TradeReadinessResponse,
  TradingWalletKind
} from "@smartmarket/types";

type ClobSessionHeaders = {
  POLY_ADDRESS: string;
  POLY_SIGNATURE: string;
  POLY_TIMESTAMP: string;
  POLY_API_KEY: string;
  POLY_PASSPHRASE: string;
};

type ReadinessInput = {
  connectedWalletAddress?: string;
  tradingWalletAddress?: string;
  tradingWalletKind?: TradingWalletKind;
  depositAddress?: string;
  amountUsd?: number;
  clobSessionHeaders?: ClobSessionHeaders | null;
  collateral?: BalanceAllowanceSnapshot;
};

const DEFAULT_LOCK_REASON = "Real execution is locked until the CLOB session, pUSD balance, allowance, and order signing are verified.";
const PUSD_DECIMALS = 6;

function collateralAmount(raw?: string | null): number {
  if (!raw) return 0;
  const trimmed = String(raw).trim();
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return 0;
  const isIntegerLike = /^-?\d+(?:\.0+)?$/.test(trimmed);
  return isIntegerLike && Math.abs(value) >= 1_000 ? value / 10 ** PUSD_DECIMALS : value;
}

export function hasClobSessionHeaders(headers?: ClobSessionHeaders | null): headers is ClobSessionHeaders {
  return Boolean(
    headers?.POLY_ADDRESS &&
      headers.POLY_SIGNATURE &&
      headers.POLY_TIMESTAMP &&
      headers.POLY_API_KEY &&
      headers.POLY_PASSPHRASE
  );
}

export function buildTradeReadiness(input: ReadinessInput): TradeReadinessResponse {
  const clobSessionReady = hasClobSessionHeaders(input.clobSessionHeaders);
  const walletLinked = Boolean(input.connectedWalletAddress);
  const profileReady = Boolean(input.tradingWalletAddress);
  const depositReady = Boolean(input.depositAddress);
  const collateralReady = Boolean(input.collateral);

  const checks: TradeReadinessCheck[] = [
    {
      code: "wallet_linked",
      label: "Wallet linked",
      status: walletLinked ? "ready" : "pending",
      message: walletLinked ? "Connected wallet detected." : "Connect a wallet before trading."
    },
    {
      code: "trading_profile",
      label: "Trading wallet",
      status: profileReady ? "ready" : "pending",
      message: profileReady
        ? `Trading wallet resolved${input.tradingWalletKind ? ` as ${input.tradingWalletKind}` : ""}.`
        : "Trading wallet has not been resolved yet."
    },
    {
      code: "funding_deposit",
      label: "BNB funding",
      status: depositReady ? "ready" : "pending",
      message: depositReady
        ? "BNB bridge deposit address is ready."
        : "Create a BNB bridge deposit address before funding."
    },
    {
      code: "clob_session",
      label: "CLOB session",
      status: clobSessionReady ? "ready" : "auth_required",
      message: clobSessionReady
        ? "CLOB session headers are present for authenticated reads."
        : "A wallet signature can create or derive the user's CLOB session inside Rawli."
    },
    {
      code: "collateral_balance_allowance",
      label: "pUSD balance",
      status: !clobSessionReady ? "auth_required" : collateralReady ? balanceAllowanceStatus(input.collateral, input.amountUsd) : "unavailable",
      message: collateralReady
        ? balanceAllowanceMessage(input.collateral, input.amountUsd)
        : clobSessionReady
        ? "Authenticated balance check did not return a usable snapshot."
        : "Balance and allowance cannot be checked until a CLOB session is prepared."
    },
    {
      code: "order_signing",
      label: "Order signing",
      status: "pending",
      message: "Signed order creation is the next step after readiness checks."
    }
  ];

  const canPreview = walletLinked && profileReady;
  const canExecute =
    walletLinked &&
    profileReady &&
    clobSessionReady &&
    collateralReady &&
    balanceAllowanceStatus(input.collateral, input.amountUsd) === "ready";

  return {
    ok: true,
    canPreview,
    canExecute,
    executionLockedReason: canExecute ? "" : DEFAULT_LOCK_REASON,
    auth: {
      clobSessionPresent: clobSessionReady,
      clobSessionRequired: true
    },
    checks,
    collateral: input.collateral
  };
}

function balanceAllowanceStatus(snapshot?: BalanceAllowanceSnapshot, amountUsd?: number): "ready" | "blocked" {
  if (!snapshot) return "blocked";
  const balance = collateralAmount(snapshot.balance);
  const allowance = collateralAmount(snapshot.allowance);
  if (!Number.isFinite(balance) || !Number.isFinite(allowance)) return "blocked";
  const required = Number(amountUsd ?? 0);
  if (Number.isFinite(required) && required > 0 && (balance < required || allowance < required)) return "blocked";
  return "ready";
}

function balanceAllowanceMessage(snapshot?: BalanceAllowanceSnapshot, amountUsd?: number): string {
  if (!snapshot) return "Balance and allowance are unavailable.";
  const balance = collateralAmount(snapshot.balance);
  const allowance = collateralAmount(snapshot.allowance);

  if (!Number.isFinite(balance) || !Number.isFinite(allowance)) {
    return "Balance or allowance returned in an unsupported format.";
  }

  const required = Number(amountUsd ?? 0);
  if (Number.isFinite(required) && required > 0) {
    if (balance < required && allowance < required) return `pUSD balance and allowance are below the $${required.toFixed(2)} order amount.`;
    if (balance < required) return `pUSD balance is below the $${required.toFixed(2)} order amount.`;
    if (allowance < required) return `pUSD allowance is below the $${required.toFixed(2)} order amount.`;
  }

  return "pUSD balance and exchange allowances are sufficient.";
}
