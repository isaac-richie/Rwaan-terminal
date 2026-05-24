import { recordRewardEvent } from "./db.js";
import type { RewardEventRow } from "./db.js";

const PREMIUM_UNLOCK_POINTS = 25;
const PREMIUM_UNLOCK_CASHBACK_CENTS = 5;
const TRADE_CASHBACK_BPS = 25;
const MAX_TRADE_CASHBACK_CENTS = 100;

export type TradeRewardInput = {
  wallet: string;
  orderId: string;
  marketId: string;
  amountUsd: number;
  quickSettle?: boolean;
  crypto?: boolean;
  premium?: boolean;
};

export function tradeReward(input: TradeRewardInput) {
  const amountUsd = Math.max(0, Number(input.amountUsd) || 0);
  const basePoints = Math.floor(amountUsd);
  const quickBonus = input.quickSettle ? 15 : 0;
  const cryptoBonus = input.crypto ? Math.ceil(basePoints * 0.25) : 0;
  const premiumBonus = input.premium ? 10 : 0;
  const points = Math.max(1, basePoints + quickBonus + cryptoBonus + premiumBonus);
  const cashbackCents = Math.min(
    MAX_TRADE_CASHBACK_CENTS,
    Math.floor((amountUsd * 100 * TRADE_CASHBACK_BPS) / 10_000),
  );

  return { points, cashbackCents, amountUsd };
}

export async function recordTradeReward(input: TradeRewardInput): Promise<void> {
  const reward = tradeReward(input);
  await recordRewardEvent({
    wallet: input.wallet,
    eventType: "trade_submitted",
    idempotencyKey: `trade:${input.orderId}`,
    points: reward.points,
    cashbackCents: reward.cashbackCents,
    amountUsd: reward.amountUsd,
    marketId: input.marketId,
    metadata: {
      orderId: input.orderId,
      quickSettle: Boolean(input.quickSettle),
      crypto: Boolean(input.crypto),
      premium: Boolean(input.premium),
    },
  });
}

export async function recordPremiumUnlockReward(input: {
  wallet: string;
  txHash: string;
  marketId: string;
  amountRaw: string;
}): Promise<void> {
  await recordRewardEvent({
    wallet: input.wallet,
    eventType: "premium_unlock",
    idempotencyKey: `premium:${input.txHash.toLowerCase()}`,
    points: PREMIUM_UNLOCK_POINTS,
    cashbackCents: PREMIUM_UNLOCK_CASHBACK_CENTS,
    amountUsd: 1,
    marketId: input.marketId,
    metadata: {
      txHash: input.txHash.toLowerCase(),
      amountRaw: input.amountRaw,
    },
  });
}

export type QuestSnapshot = {
  id: string;
  title: string;
  detail: string;
  reward: string;
  progress: number;
  target: number;
  completed: boolean;
};

function parseMetadata(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function buildDailyQuests(events: RewardEventRow[]): QuestSnapshot[] {
  const trades = events.filter((event) => event.event_type === "trade_submitted");
  const premiumUnlocks = events.filter((event) => event.event_type === "premium_unlock");
  const cryptoTrades = trades.filter((event) => parseMetadata(event.metadata).crypto === true);
  const quickSettleTrades = trades.filter((event) => parseMetadata(event.metadata).quickSettle === true);
  const cashbackCents = events.reduce((sum, event) => sum + (Number(event.cashback_cents) || 0), 0);

  const quests: Array<Omit<QuestSnapshot, "completed">> = [
    {
      id: "daily_crypto_trade",
      title: "Trade 1 crypto market",
      detail: "Use the Smart Feed crypto lane and place one routed trade today.",
      reward: "+25 pts boost",
      progress: cryptoTrades.length,
      target: 1,
    },
    {
      id: "daily_quick_settle",
      title: "Trade 1 Quick Settle",
      detail: "Place a trade on a market resolving within 24 hours.",
      reward: "+30 pts boost",
      progress: quickSettleTrades.length,
      target: 1,
    },
    {
      id: "daily_two_trades",
      title: "Place 2 trades today",
      detail: "Build a small daily rhythm across any eligible Rawali-routed markets.",
      reward: "+50 pts streak seed",
      progress: trades.length,
      target: 2,
    },
    {
      id: "daily_unlock_report",
      title: "Unlock 1 intelligence report",
      detail: "Use premium analysis before entering a market.",
      reward: "+25 pts + cashback",
      progress: premiumUnlocks.length,
      target: 1,
    },
    {
      id: "daily_cashback",
      title: "Earn cashback credits",
      detail: "Complete any eligible paid action or routed trade that generates credits.",
      reward: "Cashback tracker",
      progress: cashbackCents > 0 ? 1 : 0,
      target: 1,
    },
  ];

  return quests.map((quest) => ({
    ...quest,
    progress: Math.min(quest.progress, quest.target),
    completed: quest.progress >= quest.target,
  }));
}
