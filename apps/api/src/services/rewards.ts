import { recordRewardEvent, getTotalTradeCount, getReferrerForReferee, markReferralRewarded, getRewardEventsSince } from "./db.js";
import type { RewardEventRow } from "./db.js";

const PREMIUM_UNLOCK_POINTS = 150;
const PREMIUM_UNLOCK_CASHBACK_CENTS = 5;
const TRADE_CASHBACK_BPS = 25;
const MAX_TRADE_CASHBACK_CENTS = 100;
const REFERRAL_POINTS = 500;
const DAILY_QUEST_POINTS: Record<string, number> = {
  daily_crypto_trade: 25,
  daily_quick_settle: 30,
  daily_two_trades: 50,
  daily_unlock_report: 25,
};

/**
 * Season 1 has not launched. Set this to the actual launch timestamp (ISO string)
 * when Season 1 goes live. All trades before this date are early-adopter trades.
 * null = Season 1 not launched yet → every trade is currently pre-season.
 */
const SEASON_1_LAUNCH_DATE: string | null = null;

export type TradeRewardInput = {
  wallet: string;
  orderId: string;
  marketId: string;
  amountUsd: number;
  quickSettle?: boolean;
  crypto?: boolean;
  premium?: boolean;
};

function isEarlyAdopter(): boolean {
  if (!SEASON_1_LAUNCH_DATE) return true; // Season 1 not launched yet — all trades are pre-season
  return new Date().toISOString() < SEASON_1_LAUNCH_DATE;
}

export function tradeReward(input: TradeRewardInput) {
  const amountUsd = Math.max(0, Number(input.amountUsd) || 0);
  const basePoints = Math.floor(amountUsd);
  const quickBonus = input.quickSettle ? 15 : 0;
  const cryptoBonus = input.crypto ? Math.ceil(basePoints * 0.25) : 0;
  const premiumBonus = input.premium ? 10 : 0;
  const earlyAdopter = isEarlyAdopter();
  // Early adopter 2× applies to base points only (not the flat bonuses)
  const multipliedBase = earlyAdopter ? basePoints * 2 : basePoints;
  const points = Math.max(1, multipliedBase + quickBonus + cryptoBonus + premiumBonus);
  const cashbackCents = Math.min(
    MAX_TRADE_CASHBACK_CENTS,
    Math.floor((amountUsd * 100 * TRADE_CASHBACK_BPS) / 10_000),
  );

  return { points, cashbackCents, amountUsd, earlyAdopter };
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
      earlyAdopter: reward.earlyAdopter,
    },
  });

  await recordCompletedDailyQuestRewards(input.wallet);

  // After recording, check if this was the wallet's very first trade.
  // If it was, and if they were referred, fire the referral reward for their referrer.
  void triggerReferralRewardIfFirstTrade(input.wallet);
}

/**
 * Called after every trade reward is recorded.
 * If the wallet has exactly 1 trade event (the one just recorded) and was referred,
 * award REFERRAL_POINTS to the referrer and mark the referral as rewarded.
 * Fire-and-forget — never throws.
 */
async function triggerReferralRewardIfFirstTrade(wallet: string): Promise<void> {
  try {
    const tradeCount = await getTotalTradeCount(wallet);
    if (tradeCount !== 1) return; // Not the first trade

    const referrer = await getReferrerForReferee(wallet);
    if (!referrer) return; // Not referred

    await markReferralRewarded(wallet);
    await recordRewardEvent({
      wallet: referrer,
      eventType: "referral_reward",
      idempotencyKey: `referral:${wallet}`,
      points: REFERRAL_POINTS,
      cashbackCents: 0,
      amountUsd: 0,
      marketId: null,
      metadata: { referee: wallet, source: "first_trade", earlyAdopter: isEarlyAdopter() },
    });
  } catch {
    // Referral rewards are non-critical — never let them affect trade flow
  }
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
  await recordCompletedDailyQuestRewards(input.wallet);
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
      reward: "+25 pts auto",
      progress: cryptoTrades.length,
      target: 1,
    },
    {
      id: "daily_quick_settle",
      title: "Trade 1 Quick Settle",
      detail: "Place a trade on a market resolving within 24 hours.",
      reward: "+30 pts auto",
      progress: quickSettleTrades.length,
      target: 1,
    },
    {
      id: "daily_two_trades",
      title: "Place 2 trades today",
      detail: "Build a small daily rhythm across any eligible Rawli-routed markets.",
      reward: "+50 pts auto",
      progress: trades.length,
      target: 2,
    },
    {
      id: "daily_unlock_report",
      title: "Unlock 1 intelligence report",
      detail: "Use premium analysis before entering a market.",
      reward: "+25 pts auto",
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

function dailyQuestWindow(date = new Date()) {
  const start = new Date(date);
  start.setUTCHours(0, 0, 0, 0);
  return {
    dateKey: start.toISOString().slice(0, 10),
    startIso: start.toISOString(),
  };
}

async function recordCompletedDailyQuestRewards(wallet: string): Promise<void> {
  try {
    const { dateKey, startIso } = dailyQuestWindow();
    const events = await getRewardEventsSince(wallet, startIso);
    const quests = buildDailyQuests(events);
    await Promise.all(
      quests
        .filter((quest) => quest.completed && DAILY_QUEST_POINTS[quest.id] > 0)
        .map((quest) =>
          recordRewardEvent({
            wallet,
            eventType: "daily_quest_completed",
            idempotencyKey: `daily_quest:${wallet.toLowerCase()}:${quest.id}:${dateKey}`,
            points: DAILY_QUEST_POINTS[quest.id],
            cashbackCents: 0,
            amountUsd: 0,
            marketId: null,
            metadata: {
              questId: quest.id,
              questTitle: quest.title,
              date: dateKey,
              source: "automatic",
            },
          }),
        ),
    );
  } catch {
    // Quest bonuses should never block the underlying trade or premium unlock.
  }
}
