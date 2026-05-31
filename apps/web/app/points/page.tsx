"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Award, BarChart3, CheckCircle2, ChevronRight, Copy,
  Crown, Link2, Loader2, Lock, Sparkles, Star, Target,
  TrendingUp, Trophy, Users, Wallet, Zap,
} from "lucide-react";
import { toast } from "sonner";
import { Footer } from "@/components/footer";
import { BnbFundingModal } from "@/components/funding/bnb-funding-modal";
import { Navbar } from "@/components/navbar";
import { useActivePrivyWallet } from "@/hooks/use-active-privy-wallet";
import { usePolymarketDepositWallet } from "@/hooks/use-polymarket-deposit-wallet";
import { useReferral } from "@/hooks/use-referral";
import { useTradeReadiness } from "@/hooks/use-trade-readiness";
import { useTradingProfile } from "@/hooks/use-trading-profile";
import { cn } from "@/lib/utils";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
const PREMIUM_ANALYSIS_FEE_ENABLED =
  process.env.NEXT_PUBLIC_PREMIUM_ANALYSIS_FEE_ENABLED === "true";

const TIERS = [
  {
    name: "Observer",
    color: "oklch(0.55_0.02_255)",
    bg: "oklch(0.55_0.02_255/0.08)",
    border: "oklch(0.55_0.02_255/0.25)",
    min: 0,
    max: 499,
    icon: Star,
    perks: ["Market access", "Public leaderboard rank"],
  },
  {
    name: "Analyst",
    color: "oklch(0.68_0.18_155)",
    bg: "oklch(0.68_0.18_155/0.08)",
    border: "oklch(0.68_0.18_155/0.25)",
    min: 500,
    max: 1999,
    icon: BarChart3,
    perks: ["Early market signals", "Discounted analysis", "Analyst badge"],
  },
  {
    name: "Strategist",
    color: "oklch(0.78_0.16_82)",
    bg: "oklch(0.78_0.16_82/0.08)",
    border: "oklch(0.78_0.16_82/0.25)",
    min: 2000,
    max: 7499,
    icon: TrendingUp,
    perks: ["Priority order routing", "Exclusive intelligence", "Season rewards multiplier"],
  },
  {
    name: "Oracle",
    color: "oklch(0.72_0.22_45)",
    bg: "oklch(0.72_0.22_45/0.08)",
    border: "oklch(0.72_0.22_45/0.25)",
    min: 7500,
    max: Infinity,
    icon: Crown,
    perks: ["Revenue share access", "Builder rewards", "Oracle badge + early features"],
  },
];

const EARNING_METHODS = [
  {
    icon: BarChart3,
    title: "Trade markets",
    detail: "Earn on matched CLOB volume with daily quest bonuses.",
    pts: "Auto-credit",
    color: "oklch(0.68_0.18_155)",
  },
  {
    icon: Sparkles,
    title: "Unlock intelligence",
    detail: PREMIUM_ANALYSIS_FEE_ENABLED
      ? "Each paid analysis earns a premium points reward."
      : "Free during testing; premium rewards resume when paid unlocks return.",
    pts: PREMIUM_ANALYSIS_FEE_ENABLED ? "+150 pts" : "Testing",
    color: "oklch(0.78_0.16_82)",
  },
  {
    icon: Users,
    title: "Refer traders",
    detail: "Referred wallet executes its first trade through Rawli.",
    pts: "+500 pts",
    color: "oklch(0.72_0.22_45)",
  },
  {
    icon: Zap,
    title: "Early adopter",
    detail: "Founding traders receive a multiplier before Season 1 launch.",
    pts: "2× boost",
    color: "oklch(0.60_0.18_25)",
  },
];

type LeaderboardRow = { rank: number; wallet: string; points: number; tier: string };
type PointsSummary = { wallet: string; totalPoints: number; cashbackCents: number; volumeUsd: number; trades: number; premiumUnlocks: number };
type QuestSnapshot = { id: string; title: string; detail: string; reward: string; progress: number; target: number; completed: boolean };

const DEFAULT_QUESTS: QuestSnapshot[] = [
  { id: "daily_crypto_trade",  title: "Trade 1 crypto market",   detail: "Place one routed trade on a crypto market.", reward: "+25 pts",  progress: 0, target: 1, completed: false },
  { id: "daily_quick_settle",  title: "Trade 1 Quick Settle",    detail: "Trade a market resolving within 24 hours.",  reward: "+30 pts",  progress: 0, target: 1, completed: false },
  { id: "daily_two_trades",    title: "Place 2 trades today",    detail: "Two trades across any Rawli-routed markets.", reward: "+50 pts",  progress: 0, target: 2, completed: false },
  {
    id: "daily_unlock_report",
    title: PREMIUM_ANALYSIS_FEE_ENABLED ? "Unlock 1 intel report" : "Generate 1 intel report",
    detail: PREMIUM_ANALYSIS_FEE_ENABLED
      ? "Use premium analysis before entering a market."
      : "Report rewards are paused while analysis is free during testing.",
    reward: PREMIUM_ANALYSIS_FEE_ENABLED ? "+25 pts" : "Testing",
    progress: 0,
    target: 1,
    completed: false,
  },
  { id: "daily_cashback",      title: "Earn cashback credits",   detail: "Any eligible routed trade.",  reward: "Cashback", progress: 0, target: 1, completed: false },
];

function tierForPoints(points: number) {
  return TIERS.reduce((cur, t) => (points >= t.min ? t : cur), TIERS[0]);
}
function nextTierForPoints(points: number) {
  return TIERS.find((t) => points < t.min) ?? null;
}
function formatCashback(cents: number) {
  return `$${(Math.max(0, cents) / 100).toFixed(2)}`;
}

function TierCard({ tier, current = false }: { tier: (typeof TIERS)[0]; current?: boolean }) {
  const Icon = tier.icon;
  return (
    <div
      className={cn("relative overflow-hidden rounded-2xl border p-5 transition-all", current ? "ring-2 ring-offset-0" : "")}
      style={{ borderColor: tier.border, background: tier.bg, ...(current ? { ringColor: tier.color } : {}) }}
    >
      {current && (
        <div
          className="absolute right-3 top-3 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
          style={{ background: tier.bg, color: tier.color, border: `1px solid ${tier.border}` }}
        >
          Current
        </div>
      )}
      <div className="flex h-10 w-10 items-center justify-center rounded-full border" style={{ background: tier.bg, borderColor: tier.border }}>
        <Icon className="h-4 w-4" style={{ color: tier.color }} />
      </div>
      <div className="mt-4 text-base font-bold text-foreground">{tier.name}</div>
      <div className="mt-0.5 font-mono text-[11px] font-semibold" style={{ color: tier.color }}>
        {tier.max === Infinity ? `${tier.min.toLocaleString()}+` : `${tier.min.toLocaleString()} – ${tier.max.toLocaleString()}`} pts
      </div>
      <ul className="mt-4 space-y-2">
        {tier.perks.map((perk) => (
          <li key={perk} className="flex items-start gap-2 text-[11px] text-muted-foreground">
            <ChevronRight className="mt-0.5 h-3 w-3 shrink-0" style={{ color: tier.color }} />
            {perk}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function PointsPage() {
  const [showAll, setShowAll] = useState(false);
  const { walletAddress: connectedWalletAddress, wallet: connectedWallet } = useActivePrivyWallet();
  const polymarketDepositWallet = usePolymarketDepositWallet(connectedWallet);
  const profileConnectedWalletAddress = connectedWalletAddress ?? null;
  const tradingProfile = useTradingProfile(profileConnectedWalletAddress, polymarketDepositWallet.address, polymarketDepositWallet.address ? "deposit" : undefined);
  const readiness = useTradeReadiness({ connectedWalletAddress, profile: tradingProfile.profile });
  const collateral = readiness.readiness?.collateral ?? null;
  const depositAddress = tradingProfile.profile?.depositAddress?.evm ?? null;
  const { stats: referralStats, referralCode, referralLink, loading: referralLoading, tracking: referralTracking, applyReferralCode } = useReferral(connectedWalletAddress);
  const [summary, setSummary] = useState<PointsSummary | null>(null);
  const [quests, setQuests] = useState<QuestSnapshot[]>(DEFAULT_QUESTS);
  const [questResetAt, setQuestResetAt] = useState<string | null>(null);
  const [pointsLoading, setPointsLoading] = useState(false);
  const [fundingOpen, setFundingOpen] = useState(false);
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[] | null>(null);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [incomingReferralCode, setIncomingReferralCode] = useState("");

  useEffect(() => {
    if (!connectedWalletAddress) { setSummary(null); setQuests(DEFAULT_QUESTS); setQuestResetAt(null); return; }
    let alive = true;
    setPointsLoading(true);
    Promise.all([
      fetch(`${API_BASE}/points/summary/${connectedWalletAddress}`, { headers: { Accept: "application/json" } }).then((r) => r.ok ? r.json() : null),
      fetch(`${API_BASE}/points/quests/${connectedWalletAddress}`, { headers: { Accept: "application/json" } }).then((r) => r.ok ? r.json() : null),
    ])
      .then(([summaryData, questData]) => {
        if (!alive) return;
        setSummary(summaryData?.summary ?? null);
        setQuests(Array.isArray(questData?.quests) ? questData.quests : DEFAULT_QUESTS);
        setQuestResetAt(questData?.resetAt ?? null);
      })
      .catch(() => { if (alive) { setSummary(null); setQuests(DEFAULT_QUESTS); setQuestResetAt(null); } })
      .finally(() => { if (alive) setPointsLoading(false); });
    return () => { alive = false; };
  }, [connectedWalletAddress]);

  useEffect(() => {
    let alive = true;
    setLeaderboardLoading(true);
    fetch(`${API_BASE}/points/leaderboard`, { headers: { Accept: "application/json" } })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (!alive) return;
        if (Array.isArray(data?.leaderboard)) {
          setLeaderboard(data.leaderboard.map((row: any, i: number) => ({ rank: i + 1, wallet: row.wallet as string, points: Number(row.totalPoints ?? row.points ?? 0), tier: row.tier as string })));
        }
      })
      .catch(() => {})
      .finally(() => { if (alive) setLeaderboardLoading(false); });
    return () => { alive = false; };
  }, []);

  const totalPoints = summary?.totalPoints ?? 0;
  const currentTier = useMemo(() => tierForPoints(totalPoints), [totalPoints]);
  const nextTier = useMemo(() => nextTierForPoints(totalPoints), [totalPoints]);
  const progressMax = nextTier ? nextTier.min : currentTier.min;
  const progressPct = nextTier ? Math.max(0, Math.min(100, ((totalPoints - currentTier.min) / (nextTier.min - currentTier.min)) * 100)) : 100;
  const CurrentTierIcon = currentTier.icon;
  const completedQuests = quests.filter((q) => q.completed).length;
  const resetLabel = questResetAt ? new Date(questResetAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "--:--";
  const refreshPoints = useCallback(async () => {
    if (!connectedWalletAddress) return;
    try {
      const [summaryData, questData] = await Promise.all([
        fetch(`${API_BASE}/points/summary/${connectedWalletAddress}`, { headers: { Accept: "application/json" } }).then((r) => r.ok ? r.json() : null),
        fetch(`${API_BASE}/points/quests/${connectedWalletAddress}`, { headers: { Accept: "application/json" } }).then((r) => r.ok ? r.json() : null),
      ]);
      setSummary(summaryData?.summary ?? null);
      setQuests(Array.isArray(questData?.quests) ? questData.quests : DEFAULT_QUESTS);
      setQuestResetAt(questData?.resetAt ?? null);
    } catch {
      // Keep the existing points view if this non-critical refresh misses.
    }
  }, [connectedWalletAddress]);

  const handleApplyReferralCode = useCallback(async () => {
    if (!connectedWalletAddress) {
      toast.error("Connect your wallet before applying a code.");
      return;
    }

    const result = await applyReferralCode(incomingReferralCode);
    if (!result.ok) {
      const message =
        result.error === "invalid_code" ? "Enter a valid Rawli referral code." :
        result.error === "self_referral" ? "You cannot use your own referral code." :
        result.error === "referral_code_not_found" ? "That referral code was not found." :
        result.error === "connect_wallet" ? "Connect your wallet before applying a code." :
        "Could not apply that referral code. Try again.";
      toast.error(message);
      return;
    }

    if (result.recorded) {
      const points = result.refereePoints || referralStats?.refereeRewardPoints || 50;
      toast.success(`Referral applied. +${points} pts added.`);
      setIncomingReferralCode("");
      await refreshPoints();
      return;
    }

    toast("Referral already linked for this wallet.");
  }, [applyReferralCode, connectedWalletAddress, incomingReferralCode, referralStats?.refereeRewardPoints, refreshPoints]);

  return (
    <div className="terminal-grid-bg ambient-glow flex min-h-screen flex-col bg-background">
      <Navbar />
      <main className="relative z-10 mx-auto flex w-full max-w-7xl flex-1 flex-col px-4 rawli-page-bottom rawli-page-top sm:px-6 lg:px-8">

        {/* ── Hero ─────────────────────────────────────────── */}
        <section className="pt-4 sm:pt-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-[oklch(0.78_0.16_82/0.30)] bg-[oklch(0.78_0.16_82/0.08)] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.20em] text-[oklch(0.82_0.16_82)]">
            <Award className="h-3 w-3" />
            Season 1 — Pre-launch
          </div>
          <h1 className="mt-3 sm:mt-5 max-w-2xl text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-foreground">
            Edge compounds over time.
          </h1>
          <p className="mt-2 sm:mt-3 max-w-xl text-[13px] sm:text-sm leading-relaxed text-muted-foreground">
            Trade smart, unlock intelligence, refer traders — every action earns points toward governance-token rewards.
          </p>
        </section>

        {/* ── Points HUD ───────────────────────────────────── */}
        <section className="mt-6 sm:mt-10 grid gap-3 sm:gap-4 lg:grid-cols-12">

          {/* Left — your score */}
          <div className="surface-card overflow-hidden rounded-2xl p-4 sm:p-6 lg:col-span-4">
            <div className="flex items-center justify-between">
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Your points</div>
              <div
                className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] sm:text-[10px] font-bold uppercase tracking-wider"
                style={{ borderColor: currentTier.border, background: currentTier.bg, color: currentTier.color }}
              >
                <CurrentTierIcon className="h-2.5 w-2.5" /> {currentTier.name}
              </div>
            </div>
            <div className="mt-3 sm:mt-4 font-mono text-5xl sm:text-6xl font-bold tracking-tighter text-foreground">{totalPoints.toLocaleString()}</div>

            {/* Progress bar */}
            <div className="mt-4 sm:mt-6">
              <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.10em] text-muted-foreground">
                <span>{nextTier ? `→ ${nextTier.name}` : "Top tier"}</span>
                <span className="font-mono">{nextTier ? `${totalPoints.toLocaleString()} / ${progressMax.toLocaleString()}` : "Max"}</span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[oklch(0.18_0.014_255)]">
                <div className="h-full rounded-full transition-all duration-700" style={{ width: `${progressPct}%`, background: currentTier.color }} />
              </div>
            </div>

            {/* Cashback + Fund */}
            <div className="mt-4 flex items-center gap-2">
              {connectedWalletAddress && (
                <div className="flex-1 flex items-center justify-between rounded-xl border border-[oklch(0.22_0.015_255)] bg-[oklch(0.12_0.012_260/0.6)] px-3 py-2.5">
                  <span className="text-[10px] font-bold uppercase tracking-[0.10em] text-muted-foreground">Cashback</span>
                  <span className="font-mono text-sm font-bold text-[oklch(0.78_0.16_82)]">{formatCashback(summary?.cashbackCents ?? 0)}</span>
                </div>
              )}
              <button
                type="button"
                onClick={() => setFundingOpen(true)}
                disabled={!connectedWalletAddress || tradingProfile.loading || !tradingProfile.profile}
                className={cn(
                  "flex h-10 items-center justify-center gap-1.5 rounded-xl bg-[oklch(0.78_0.16_82)] text-[11px] font-bold text-[oklch(0.10_0.012_260)] transition-all hover:bg-[oklch(0.83_0.16_82)] disabled:opacity-40 active:scale-95",
                  connectedWalletAddress ? "px-4 shrink-0" : "w-full px-4"
                )}
              >
                <Wallet className="h-3.5 w-3.5" />
                {connectedWalletAddress ? "Fund" : "Connect to trade"}
              </button>
            </div>
          </div>

          {/* Right — season + stats */}
          <div className="flex flex-col gap-3 sm:gap-4 lg:col-span-8">
            <div className="surface-card rounded-2xl p-4 sm:p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Season 1 countdown</div>
                  <div className="mt-2 sm:mt-3 flex items-end gap-3 sm:gap-4">
                    {["--", "--", "--"].map((val, i) => (
                      <div key={i} className="text-center">
                        <div className="font-mono text-3xl sm:text-4xl font-bold text-foreground">{val}</div>
                        <div className="mt-0.5 sm:mt-1 text-[9px] sm:text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{["Days", "Hrs", "Min"][i]}</div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-xl sm:rounded-2xl border border-[oklch(0.78_0.16_82/0.25)] bg-[oklch(0.78_0.16_82/0.08)]">
                  <Trophy className="h-4 w-4 text-[oklch(0.78_0.16_82)]" />
                </div>
              </div>
              <p className="mt-3 sm:mt-4 text-[11px] text-muted-foreground">
                Pre-season is live. All trades and unlocks are tracked for the retroactive snapshot.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              {[
                { label: "Trades", value: summary?.trades?.toLocaleString() ?? "—", icon: Users },
                { label: "Volume", value: summary ? `$${summary.volumeUsd.toFixed(0)}` : "—", icon: BarChart3 },
                { label: "Unlocks", value: summary?.premiumUnlocks?.toLocaleString() ?? "—", icon: Sparkles },
              ].map(({ label, value, icon: Icon }) => (
                <div key={label} className="surface-card rounded-xl sm:rounded-2xl p-3 sm:p-4">
                  <Icon className="h-3.5 sm:h-4 w-3.5 sm:w-4 text-[oklch(0.78_0.16_82)]" />
                  <div className="mt-2 sm:mt-3 font-mono text-xl sm:text-2xl font-bold text-foreground">{value}</div>
                  <div className="mt-0.5 sm:mt-1 text-[9px] sm:text-[10px] uppercase tracking-[0.10em] text-muted-foreground">{label}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Daily Quests ─────────────────────────────────── */}
        <section className="mt-8 sm:mt-12">
          <div className="mb-4 sm:mb-5 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg sm:text-2xl font-bold text-foreground">Daily Quests</h2>
              {pointsLoading && <Loader2 className="mt-1 h-3 w-3 animate-spin text-muted-foreground" />}
            </div>
            <div className="inline-flex items-center gap-1.5 rounded-full border border-[oklch(0.22_0.015_255)] bg-[oklch(0.13_0.012_260)] px-2.5 py-1.5 text-[10px] sm:text-[11px] font-semibold text-muted-foreground shrink-0">
              <Target className="h-3 w-3 text-[oklch(0.78_0.16_82)]" />
              {completedQuests}/{quests.length}
            </div>
          </div>

          <div className="grid gap-3 sm:gap-4 md:grid-cols-3">
            {quests.slice(0, 6).map((quest) => {
              const pct = Math.max(0, Math.min(100, (quest.progress / Math.max(quest.target, 1)) * 100));
              return (
                <div
                  key={quest.id}
                  className={cn(
                    "surface-card rounded-2xl border p-5 transition-all",
                    quest.completed
                      ? "border-[oklch(0.68_0.18_155/0.35)] bg-[oklch(0.68_0.18_155/0.06)]"
                      : "border-[oklch(0.22_0.015_255)]"
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className={cn(
                      "flex h-9 w-9 items-center justify-center rounded-full border",
                      quest.completed
                        ? "border-[oklch(0.68_0.18_155/0.35)] bg-[oklch(0.68_0.18_155/0.10)]"
                        : "border-[oklch(0.78_0.16_82/0.25)] bg-[oklch(0.78_0.16_82/0.08)]"
                    )}>
                      {quest.completed
                        ? <CheckCircle2 className="h-4 w-4 text-[oklch(0.68_0.18_155)]" />
                        : <Target className="h-4 w-4 text-[oklch(0.78_0.16_82)]" />
                      }
                    </div>
                    <span className="rounded-full border border-[oklch(0.78_0.16_82/0.20)] bg-[oklch(0.78_0.16_82/0.08)] px-2.5 py-0.5 font-mono text-[10px] font-bold text-[oklch(0.82_0.16_82)]">
                      {quest.reward}
                    </span>
                  </div>
                  <div className="mt-4 text-sm font-bold text-foreground">{quest.title}</div>
                  <p className="mt-1.5 text-[11px] leading-5 text-muted-foreground">{quest.detail}</p>
                  <div className="mt-4">
                    <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      <span>{quest.completed ? "Done" : "Progress"}</span>
                      <span className="font-mono">{Math.min(quest.progress, quest.target)} / {quest.target}</span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[oklch(0.18_0.014_255)]">
                      <div
                        className={cn("h-full rounded-full transition-all", quest.completed ? "bg-[oklch(0.68_0.18_155)]" : "bg-[oklch(0.78_0.16_82)]")}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── Tier System ──────────────────────────────────── */}
        <section className="mt-12">
          <div className="mb-6">
            <div className="text-[10px] font-bold uppercase tracking-[0.20em] text-muted-foreground">Tier system</div>
            <h2 className="mt-1 text-2xl font-bold text-foreground">Four levels of edge.</h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {TIERS.map((tier) => (
              <TierCard key={tier.name} tier={tier} current={tier.name === currentTier.name} />
            ))}
          </div>
        </section>

        {/* ── How to Earn ──────────────────────────────────── */}
        <section className="mt-12">
          <div className="mb-6">
            <div className="text-[10px] font-bold uppercase tracking-[0.20em] text-muted-foreground">How to earn</div>
            <h2 className="mt-1 text-2xl font-bold text-foreground">Every action compounds.</h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {EARNING_METHODS.map((method) => {
              const Icon = method.icon;
              const colorBase = method.color;
              return (
                <div key={method.title} className="surface-card rounded-2xl p-5">
                  <div
                    className="flex h-10 w-10 items-center justify-center rounded-full border"
                    style={{ background: `${colorBase.replace(")", "/0.08)").replace("oklch(", "oklch(")}`, borderColor: `${colorBase.replace(")", "/0.25)").replace("oklch(", "oklch(")}` }}
                  >
                    <Icon className="h-4 w-4" style={{ color: colorBase }} />
                  </div>
                  <div className="mt-4 text-sm font-semibold text-foreground">{method.title}</div>
                  <p className="mt-1.5 text-[11px] leading-5 text-muted-foreground">{method.detail}</p>
                  <div className="mt-4 font-mono text-sm font-bold" style={{ color: colorBase }}>{method.pts}</div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── Leaderboard ──────────────────────────────────── */}
        <section className="mt-12">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.20em] text-muted-foreground">Leaderboard</div>
              <h2 className="mt-1 text-2xl font-bold text-foreground">Top traders.</h2>
            </div>
            <button
              onClick={() => setShowAll((v) => !v)}
              className="flex items-center gap-1.5 rounded-full border border-[oklch(0.22_0.015_255)] bg-[oklch(0.14_0.012_255)] px-4 py-2 text-[11px] font-semibold text-muted-foreground transition-colors hover:border-[oklch(0.78_0.16_82/0.4)] hover:text-foreground"
            >
              {showAll ? "Show less" : "View all"}
              <ChevronRight className="h-3 w-3" />
            </button>
          </div>

          <div className="surface-card overflow-hidden rounded-2xl">
            <div className="grid grid-cols-[1.5rem_1fr_auto_auto] sm:grid-cols-[2rem_1fr_auto_auto] items-center gap-2 sm:gap-4 border-b border-[oklch(0.18_0.014_255)] px-4 sm:px-5 py-3 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
              <span>#</span><span>Trader</span><span>Tier</span><span>Points</span>
            </div>

            {leaderboardLoading && (
              <div className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
              </div>
            )}

            {!leaderboardLoading && leaderboard && leaderboard.length > 0 && (showAll ? leaderboard : leaderboard.slice(0, 3)).map((row) => {
              const tierData = TIERS.find((t) => t.name === row.tier) ?? TIERS[0];
              const TierBadge = tierData.icon;
              const shortWallet = `${row.wallet.slice(0, 6)}…${row.wallet.slice(-4)}`;
              return (
                <div key={row.rank} className="grid grid-cols-[1.5rem_1fr_auto_auto] sm:grid-cols-[2rem_1fr_auto_auto] items-center gap-2 sm:gap-4 border-b border-[oklch(0.14_0.012_260)] px-4 sm:px-5 py-4 last:border-0 hover:bg-[oklch(0.14_0.012_260/0.60)] transition-colors">
                  <span className={cn("font-mono text-sm font-bold", row.rank === 1 && "text-[oklch(0.72_0.22_45)]", row.rank === 2 && "text-[oklch(0.70_0.04_255)]", row.rank === 3 && "text-[oklch(0.62_0.10_50)]", row.rank > 3 && "text-muted-foreground")}>
                    {row.rank}
                  </span>
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[oklch(0.24_0.016_255)] bg-[oklch(0.15_0.014_255)]">
                      <TierBadge className="h-3 w-3" style={{ color: tierData.color }} />
                    </div>
                    <span className="font-mono text-sm text-foreground truncate">{shortWallet}</span>
                  </div>
                  <span className="rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider" style={{ borderColor: tierData.border, background: tierData.bg, color: tierData.color }}>
                    {row.tier}
                  </span>
                  <span className="font-mono text-sm font-bold text-foreground tabular-nums">{row.points.toLocaleString()}</span>
                </div>
              );
            })}

            {!leaderboardLoading && (!leaderboard || leaderboard.length === 0) && (
              <div className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
                <Trophy className="h-3.5 w-3.5" /> No traders yet — be the first.
              </div>
            )}

            <div className="flex items-center justify-center gap-2 border-t border-[oklch(0.18_0.014_255)] py-3 text-[11px] text-muted-foreground">
              <Lock className="h-3 w-3" />
              Rankings inform future governance-token rewards
            </div>
          </div>
        </section>

        {/* ── Referral ─────────────────────────────────────── */}
        <section className="mt-10">
          <div className="mb-5">
            <div className="text-[10px] font-bold uppercase tracking-[0.20em] text-muted-foreground">Referrals</div>
            <h2 className="mt-1 text-2xl font-bold text-foreground">Invite traders. Earn points automatically.</h2>
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            {/* Invite code */}
            <div className="surface-card rounded-2xl p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                  <Users className="h-3.5 w-3.5 text-[oklch(0.72_0.22_45)]" />
                  Your referral code
                </div>
                <span className="rounded-full border border-[oklch(0.78_0.16_82/0.20)] bg-[oklch(0.78_0.16_82/0.08)] px-2.5 py-1 font-mono text-[10px] font-bold text-[oklch(0.82_0.16_82)]">
                  +{referralStats?.rewardPoints ?? 500} pts
                </span>
              </div>

              {connectedWalletAddress ? (
                <div className="space-y-3">
                  <div className="flex items-stretch gap-2">
                    <div className="flex min-h-14 flex-1 min-w-0 items-center rounded-2xl border border-[oklch(0.78_0.16_82/0.25)] bg-[oklch(0.78_0.16_82/0.07)] px-4">
                      <span className="font-mono text-xl font-bold tracking-[0.10em] text-foreground sm:text-2xl">
                        {referralCode || "LOADING"}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        if (!referralCode) return;
                        void navigator.clipboard.writeText(referralCode);
                        toast.success("Referral code copied");
                      }}
                      disabled={!referralCode}
                      className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-[oklch(0.22_0.015_255)] bg-[oklch(0.15_0.013_255)] transition-colors hover:border-[oklch(0.78_0.16_82/0.4)] disabled:opacity-40"
                      aria-label="Copy referral code"
                    >
                      <Copy className="h-4 w-4 text-muted-foreground" />
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      if (!referralLink) return;
                      void navigator.clipboard.writeText(referralLink);
                      toast.success("Invite link copied");
                    }}
                    disabled={!referralLink}
                    className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-[oklch(0.22_0.015_255)] bg-[oklch(0.13_0.013_255)] px-4 text-[12px] font-bold text-foreground transition-colors hover:border-[oklch(0.78_0.16_82/0.4)] disabled:opacity-40"
                  >
                    <Link2 className="h-3.5 w-3.5 text-[oklch(0.78_0.16_82)]" />
                    Copy invite link
                  </button>

                  <p className="font-mono text-[10px] text-muted-foreground truncate">{referralLink || "Generating invite link..."}</p>
                </div>
              ) : (
                <p className="text-[12px] leading-5 text-muted-foreground">Connect wallet to generate your referral code and invite link.</p>
              )}
              <p className="mt-3 text-[11px] text-muted-foreground leading-5">
                A referred wallet connects through your code and completes its first Rawli-routed trade. Your points credit automatically.
              </p>
            </div>

            {/* Apply code */}
            <div className="surface-card rounded-2xl p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                  <Sparkles className="h-3.5 w-3.5 text-[oklch(0.78_0.16_82)]" />
                  Have a code?
                </div>
                <span className="rounded-full border border-[oklch(0.68_0.18_155/0.22)] bg-[oklch(0.68_0.18_155/0.08)] px-2.5 py-1 font-mono text-[10px] font-bold text-[oklch(0.76_0.17_155)]">
                  +{referralStats?.refereeRewardPoints ?? 50} pts
                </span>
              </div>

              <form
                className="space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleApplyReferralCode();
                }}
              >
                <input
                  value={incomingReferralCode}
                  onChange={(event) => {
                    const value = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);
                    setIncomingReferralCode(value);
                  }}
                  disabled={!connectedWalletAddress}
                  inputMode="text"
                  autoCapitalize="characters"
                  spellCheck={false}
                  placeholder="RWABC12345"
                  className="h-14 w-full rounded-2xl border border-[oklch(0.22_0.015_255)] bg-[oklch(0.12_0.013_255)] px-4 font-mono text-lg font-bold tracking-[0.08em] text-foreground outline-none transition-colors placeholder:text-muted-foreground/45 focus:border-[oklch(0.78_0.16_82/0.55)] disabled:opacity-45"
                />

                <button
                  type="submit"
                  disabled={!connectedWalletAddress || !incomingReferralCode.trim() || referralTracking}
                  className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-[oklch(0.78_0.16_82)] px-4 text-[12px] font-black uppercase tracking-[0.12em] text-black transition-transform hover:brightness-105 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {referralTracking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  {connectedWalletAddress ? "Apply code" : "Connect wallet"}
                </button>
              </form>

              <p className="mt-3 text-[11px] leading-5 text-muted-foreground">
                New wallets get +50 points once. Your referrer earns +500 after your first eligible trade.
              </p>
            </div>

            {/* Stats */}
            <div className="surface-card rounded-2xl p-5">
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground mb-4">
                <Trophy className="h-3.5 w-3.5 text-[oklch(0.78_0.16_82)]" />
                Your referrals
                {(referralLoading || referralTracking) && <Loader2 className="h-3 w-3 animate-spin" />}
              </div>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: "Referred", value: referralStats?.totalReferrals ?? "—" },
                  { label: "Rewarded", value: referralStats?.rewardedReferrals ?? "—" },
                  { label: "Pending", value: referralStats?.pendingReferrals ?? "—" },
                ].map((stat) => (
                  <div key={stat.label} className="rounded-2xl border border-[oklch(0.20_0.014_255)] bg-[oklch(0.13_0.013_255)] p-3 text-center">
                    <div className="font-mono text-2xl font-bold text-foreground">{stat.value}</div>
                    <div className="mt-1 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{stat.label}</div>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[11px] text-muted-foreground leading-5">
                Pending invites become rewarded when the new trader completes their first eligible trade.
              </p>
            </div>
          </div>
        </section>

        {/* ── CTA ──────────────────────────────────────────── */}
        <section className="mt-10 rounded-2xl border border-[oklch(0.78_0.16_82/0.20)] bg-[oklch(0.78_0.16_82/0.05)] p-6 sm:p-8">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.20em] text-[oklch(0.82_0.16_82)]">Start earning</div>
              <h2 className="mt-2 text-xl font-bold text-foreground">Pre-season trades count retroactively.</h2>
              <p className="mt-1.5 text-[12px] text-muted-foreground">Every trade before Season 1 launches counts toward founding points and the governance-token snapshot.</p>
            </div>
            <a
              href="/"
              className="inline-flex h-11 shrink-0 items-center gap-2 rounded-2xl bg-[oklch(0.78_0.16_82)] px-6 text-sm font-bold text-[oklch(0.10_0.012_260)] transition-all hover:bg-[oklch(0.83_0.16_82)] hover:shadow-[0_4px_16px_oklch(0.78_0.16_82/0.30)]"
            >
              <Zap className="h-4 w-4" />
              Start trading
            </a>
          </div>
        </section>

      </main>

      <BnbFundingModal
        open={fundingOpen}
        onOpenChange={setFundingOpen}
        initialTab="deposit"
        profile={tradingProfile.profile}
        depositAddress={depositAddress}
        loadingDeposit={tradingProfile.depositLoading}
        onCreateDepositAddress={tradingProfile.createDepositAddress}
        wallet={connectedWallet}
        collateralBalance={collateral?.balance ?? null}
        collateralAllowance={collateral?.allowance ?? null}
        collateralSessionReady={Boolean(collateral)}
        onRefreshCollateralBalance={readiness.refresh}
        onFundingSent={() => { void tradingProfile.refresh(); void readiness.refresh(); }}
      />
      <Footer />
    </div>
  );
}
