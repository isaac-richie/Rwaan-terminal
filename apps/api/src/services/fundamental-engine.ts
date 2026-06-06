import type { PremiumNewsArticle } from "./news.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type MarketCategory =
  | "politics"
  | "economics"
  | "stocks"
  | "ipos"
  | "sports"
  | "science_tech"
  | "legal"
  | "general";

export type FundamentalSignal = {
  name: string;
  direction: "YES" | "NO" | "neutral";
  weight: number;    // 0-1
  conviction: number; // 0-1
  reason: string;
};

export type FundamentalVerdict = {
  direction: "YES" | "NO";
  confidence: number;         // 0-100
  yesScore: number;
  noScore: number;
  netScore: number;           // yesScore - noScore
  signals: FundamentalSignal[];
  verdictRationale: string;
  impliedProbability: number; // market's YES price, 0-100
  priceEfficiency: "efficient" | "potentially_mispriced" | "thin_market";
  daysToResolution: number | null;
  category: MarketCategory;
};

// ─── Category detection ───────────────────────────────────────────────────────

export function detectMarketCategory(
  question: string,
  category?: string
): MarketCategory {
  const text = `${category ?? ""} ${question}`.toLowerCase();

  if (
    /(^|[^a-z0-9])(ipo|ipos)([^a-z0-9]|$)|initial public offering|go public|goes public|public listing|direct listing|s-1|registration statement|ipo day|closing market cap|market cap.*ipo|pre-market/.test(
      text
    )
  )
    return "ipos";

  if (
    /stock|stocks|equity|equities|shares|etf|earnings|guidance|revenue|eps|valuation|free cash flow|buyback|dividend|sector rotation|wall street|nasdaq|nyse/.test(
      text
    )
  )
    return "stocks";

  if (
    /politi|elect|president|senator|congress|vote|ballot|democrat|republican|prime minister|parliament|govern/.test(
      text
    )
  )
    return "politics";

  if (
    /fed|fomc|rate cut|rate hike|inflation|cpi|gdp|recession|central bank|treasury|dollar|employment|jobs report|nfp|pmi|ecb|boe/.test(
      text
    )
  )
    return "economics";

  if (
    /nba|nfl|nhl|mlb|soccer|football|basketball|baseball|champion|championship|cup|league|match|game|season|playoff|tournament|super bowl|world cup/.test(
      text
    )
  )
    return "sports";

  if (
    /ai|artificial intelligence|fda|drug approval|clinical trial|launch|release|milestone|discovery|spacex|nasa|quantum|gpt|model|technology|patent|approval/.test(
      text
    )
  )
    return "science_tech";

  if (
    /court|legal|lawsuit|trial|ruling|verdict|regulat|ban|sanction|criminal|civil|appeal|judge|justice|law|legislation|bill|congress/.test(
      text
    )
  )
    return "legal";

  return "general";
}

// ─── Historical base rates by category ───────────────────────────────────────
// These reflect empirical resolution rates for YES outcomes in each domain.
// Used as a Bayesian prior before adjusting for market + news signals.
const BASE_RATES: Record<MarketCategory, number> = {
  politics: 50,      // elections are definitionally uncertain for favorites
  economics: 58,     // analyst consensus is correct more often than not
  stocks: 52,        // equity direction has a slight upward drift, but single-name dispersion is high
  ipos: 45,           // IPO timing and valuation markets often resolve below optimistic narrative
  sports: 50,        // high variance, home favorite bias small
  science_tech: 42,  // ambitious milestones typically run late/fail
  legal: 38,         // regulatory/legal challenges frequently rejected
  general: 50,
};

// ─── News sentiment scoring ───────────────────────────────────────────────────

const YES_SIGNALS = [
  "confirms", "confirmed", "approved", "passes", "wins", "victory", "success",
  "expected to", "likely to", "on track", "poised to", "ahead of", "beats",
  "exceeded", "surpassed", "record high", "bullish", "optimistic", "positive",
  "deals", "agreement", "signed", "granted", "clears", "green light",
  "filed for ipo", "confidential ipo filing", "s-1", "registration statement",
  "roadshow", "underwriter", "underwriters", "plans ipo", "preparing ipo",
  "expects to list", "public listing", "nasdaq listing", "nyse listing",
  "raises guidance", "raised guidance", "beats earnings", "earnings beat",
  "upgrade", "upgraded", "price target raised", "buy rating", "outperform",
  "margin expansion", "record revenue", "revenue growth", "strong demand",
  "buyback", "dividend increase", "free cash flow", "cost cuts",
];

const NO_SIGNALS = [
  "fails", "rejected", "denied", "blocked", "loses", "defeat", "unlikely",
  "withdrawn", "cancelled", "delayed", "missed", "below expectations", "bearish",
  "pessimistic", "negative", "opposition", "vetoed", "suspended", "banned",
  "crisis", "downgrade", "warning", "concern", "risk", "doubt",
  "delays ipo", "delayed ipo", "postpones ipo", "postponed ipo", "shelves ipo",
  "shelved ipo", "staying private", "remain private", "market volatility",
  "regulatory scrutiny", "sec investigation", "valuation cut", "down round",
  "cuts guidance", "cut guidance", "misses earnings", "earnings miss",
  "downgraded", "downgrade", "price target cut", "sell rating", "underperform",
  "margin pressure", "revenue decline", "weak demand", "layoffs", "debt concern",
];

function scoreNewsSentiment(
  articles: PremiumNewsArticle[],
  _question: string
): { yesScore: number; noScore: number; sampleCount: number } {
  if (articles.length === 0) return { yesScore: 0, noScore: 0, sampleCount: 0 };

  let yesHits = 0;
  let noHits = 0;

  for (const article of articles) {
    const titleLower = article.title.toLowerCase();
    const bodyLower = article.bodyText.toLowerCase().slice(0, 1500);

    // Title carries 3x weight vs body
    for (const kw of YES_SIGNALS) {
      if (titleLower.includes(kw)) yesHits += 3;
      const bodyCount = (bodyLower.match(new RegExp(kw, "g")) ?? []).length;
      yesHits += bodyCount;
    }
    for (const kw of NO_SIGNALS) {
      if (titleLower.includes(kw)) noHits += 3;
      const bodyCount = (bodyLower.match(new RegExp(kw, "g")) ?? []).length;
      noHits += bodyCount;
    }
  }

  const total = yesHits + noHits || 1;
  return {
    yesScore: (yesHits / total) * 100,
    noScore: (noHits / total) * 100,
    sampleCount: articles.length,
  };
}

function isNegativeIpoQuestion(question: string): boolean {
  return /not\s+(ipo|go public|list)|won't\s+(ipo|go public|list)|will\s+.+\s+not\s+(ipo|go public|list)|no\s+ipo/.test(
    question.toLowerCase()
  );
}

function scoreIpoReadiness(
  question: string,
  articles: PremiumNewsArticle[]
): FundamentalSignal {
  const positiveNeedles = [
    "filed for ipo",
    "confidential ipo filing",
    "s-1",
    "registration statement",
    "roadshow",
    "underwriter",
    "underwriters",
    "plans ipo",
    "preparing ipo",
    "expects to list",
    "public listing",
    "nasdaq listing",
    "nyse listing",
    "valuation",
    "secondary sale",
  ];
  const negativeNeedles = [
    "delays ipo",
    "delayed ipo",
    "postpones ipo",
    "postponed ipo",
    "shelves ipo",
    "shelved ipo",
    "staying private",
    "remain private",
    "market volatility",
    "regulatory scrutiny",
    "sec investigation",
    "valuation cut",
    "down round",
  ];

  const corpus = articles
    .map((article) => `${article.title} ${article.bodyText.slice(0, 2000)}`)
    .join(" ")
    .toLowerCase();

  if (!corpus.trim()) {
    return {
      name: "IPO Readiness",
      direction: "neutral",
      weight: 0.18,
      conviction: 0.10,
      reason: "No recent IPO-specific news available — filing and listing readiness signal absent",
    };
  }

  const positiveHits = positiveNeedles.reduce((sum, needle) => sum + (corpus.includes(needle) ? 1 : 0), 0);
  const negativeHits = negativeNeedles.reduce((sum, needle) => sum + (corpus.includes(needle) ? 1 : 0), 0);
  const net = positiveHits - negativeHits;

  if (net === 0) {
    return {
      name: "IPO Readiness",
      direction: "neutral",
      weight: 0.18,
      conviction: 0.22,
      reason: "Recent coverage does not clearly confirm filing momentum or listing delay risk",
    };
  }

  const inverseQuestion = isNegativeIpoQuestion(question);
  const readinessSupportsIpo = net > 0;
  const direction: "YES" | "NO" =
    readinessSupportsIpo
      ? inverseQuestion ? "NO" : "YES"
      : inverseQuestion ? "YES" : "NO";
  const conviction = Math.min(0.72, 0.34 + Math.abs(net) * 0.08);

  return {
    name: "IPO Readiness",
    direction,
    weight: 0.18,
    conviction,
    reason: readinessSupportsIpo
      ? `IPO readiness indicators are present (${positiveHits} positive vs ${negativeHits} delay signals): filing/listing momentum supports ${inverseQuestion ? "NO on a no-IPO question" : "YES on an IPO question"}`
      : `IPO delay indicators dominate (${negativeHits} delay vs ${positiveHits} readiness signals): timing risk supports ${inverseQuestion ? "YES on a no-IPO question" : "NO on an IPO question"}`,
  };
}

// ─── Main verdict computation ─────────────────────────────────────────────────

export function computeFundamentalVerdict(
  market: {
    question: string;
    category?: string;
    outcomes?: { name: string; price: number }[];
    volume?: string;
    liquidity?: string;
    endDate?: string;
  },
  articles: PremiumNewsArticle[]
): FundamentalVerdict {
  const category = detectMarketCategory(market.question, market.category);
  const signals: FundamentalSignal[] = [];

  // ── 1. Market Consensus Signal (w: 0.30) ──────────────────────────────────
  // The crowd's implied probability is a strong prior — prediction markets
  // are generally efficient when volume is high.
  const yesOutcome = market.outcomes?.find(
    (o) => o.name.toLowerCase() === "yes" || o.name.toLowerCase() === "yes "
  ) ?? market.outcomes?.[0];
  const impliedProbability = yesOutcome?.price ?? 50;

  let consensusDirection: "YES" | "NO" | "neutral";
  let consensusConviction: number;
  let consensusReason: string;

  if (impliedProbability >= 75) {
    consensusDirection = "YES";
    consensusConviction = 0.85;
    consensusReason = `Market prices YES at ${impliedProbability}% — strong crowd consensus favoring resolution`;
  } else if (impliedProbability >= 60) {
    consensusDirection = "YES";
    consensusConviction = 0.60;
    consensusReason = `Market prices YES at ${impliedProbability}% — moderate crowd lean toward YES resolution`;
  } else if (impliedProbability <= 25) {
    consensusDirection = "NO";
    consensusConviction = 0.85;
    consensusReason = `Market prices YES at only ${impliedProbability}% — crowd strongly expects NO resolution`;
  } else if (impliedProbability <= 40) {
    consensusDirection = "NO";
    consensusConviction = 0.60;
    consensusReason = `Market prices YES at ${impliedProbability}% — mild crowd lean toward NO resolution`;
  } else {
    consensusDirection = "neutral";
    consensusConviction = 0.20;
    consensusReason = `Market near 50/50 at ${impliedProbability}% — no strong crowd consensus`;
  }

  signals.push({
    name: "Market Consensus",
    direction: consensusDirection,
    weight: 0.30,
    conviction: consensusConviction,
    reason: consensusReason,
  });

  // ── 2. Category Base Rate Signal (w: 0.15) ────────────────────────────────
  const baseRate = BASE_RATES[category];
  const baseRateGap = impliedProbability - baseRate;
  let baseRateDirection: "YES" | "NO" | "neutral";
  let baseRateConviction: number;
  let baseRateReason: string;

  if (baseRateGap > 20) {
    // Market is pricing YES well above historical base rate → potential overpricing
    baseRateDirection = "NO";
    baseRateConviction = 0.50;
    baseRateReason = `${category} base rate ~${baseRate}% but market prices YES at ${impliedProbability}% — historically elevated vs base rate`;
  } else if (baseRateGap < -20) {
    // Market is pricing YES well below historical base rate → potential underpricing
    baseRateDirection = "YES";
    baseRateConviction = 0.50;
    baseRateReason = `${category} base rate ~${baseRate}% but market prices YES at only ${impliedProbability}% — historically cheap`;
  } else if (baseRate >= 55 && impliedProbability >= 50) {
    baseRateDirection = "YES";
    baseRateConviction = 0.40;
    baseRateReason = `${category} events resolve YES ~${baseRate}% historically — market pricing consistent with base rate`;
  } else if (baseRate <= 45 && impliedProbability <= 50) {
    baseRateDirection = "NO";
    baseRateConviction = 0.40;
    baseRateReason = `${category} events resolve YES only ~${baseRate}% historically — market consistent with structural skepticism`;
  } else {
    baseRateDirection = "neutral";
    baseRateConviction = 0.25;
    baseRateReason = `${category} base rate ~${baseRate}% — market pricing near historical norm, no systematic edge`;
  }

  signals.push({
    name: `${category.replace("_", " ")} Base Rate`,
    direction: baseRateDirection,
    weight: 0.15,
    conviction: baseRateConviction,
    reason: baseRateReason,
  });

  // ── 3. News Sentiment Signal (w: 0.28) ────────────────────────────────────
  const sentiment = scoreNewsSentiment(articles, market.question);
  let sentimentDirection: "YES" | "NO" | "neutral";
  let sentimentConviction: number;
  let sentimentReason: string;

  if (sentiment.sampleCount === 0) {
    sentimentDirection = "neutral";
    sentimentConviction = 0.10;
    sentimentReason = "No news articles available — sentiment signal absent";
  } else {
    const sentimentLean = sentiment.yesScore - sentiment.noScore;
    if (sentimentLean > 25) {
      sentimentDirection = "YES";
      sentimentConviction = Math.min(0.85, 0.40 + sentimentLean / 100);
      sentimentReason = `${sentiment.sampleCount} articles show strongly positive sentiment — YES-aligned headlines and reporting`;
    } else if (sentimentLean > 8) {
      sentimentDirection = "YES";
      sentimentConviction = 0.50;
      sentimentReason = `${sentiment.sampleCount} articles lean YES-positive — moderate supportive tone in recent coverage`;
    } else if (sentimentLean < -25) {
      sentimentDirection = "NO";
      sentimentConviction = Math.min(0.85, 0.40 + Math.abs(sentimentLean) / 100);
      sentimentReason = `${sentiment.sampleCount} articles show strongly negative sentiment — NO-aligned headlines dominating`;
    } else if (sentimentLean < -8) {
      sentimentDirection = "NO";
      sentimentConviction = 0.50;
      sentimentReason = `${sentiment.sampleCount} articles lean negative — moderate headwind in recent coverage`;
    } else {
      sentimentDirection = "neutral";
      sentimentConviction = 0.25;
      sentimentReason = `${sentiment.sampleCount} articles show mixed sentiment — no clear directional news bias`;
    }
  }

  signals.push({
    name: "News Sentiment",
    direction: sentimentDirection,
    weight: 0.28,
    conviction: sentimentConviction,
    reason: sentimentReason,
  });

  if (category === "ipos") {
    signals.push(scoreIpoReadiness(market.question, articles));
  }

  // ── 4. Time Decay Signal (w: 0.12) ────────────────────────────────────────
  let daysToResolution: number | null = null;
  let timeDecayDirection: "YES" | "NO" | "neutral" = "neutral";
  let timeDecayConviction = 0.20;
  let timeDecayReason = "No resolution date available";

  if (market.endDate) {
    const endTs = Date.parse(market.endDate);
    if (!isNaN(endTs)) {
      daysToResolution = Math.max(0, Math.round((endTs - Date.now()) / 86_400_000));

      if (daysToResolution <= 7 && impliedProbability >= 60) {
        // Very close to resolution with high YES price → YES confirmed likely
        timeDecayDirection = "YES";
        timeDecayConviction = 0.70;
        timeDecayReason = `Only ${daysToResolution} days to resolution with YES at ${impliedProbability}% — late-stage high-conviction market`;
      } else if (daysToResolution <= 7 && impliedProbability <= 40) {
        timeDecayDirection = "NO";
        timeDecayConviction = 0.70;
        timeDecayReason = `Only ${daysToResolution} days to resolution with YES at ${impliedProbability}% — near-term NO outcome increasingly priced in`;
      } else if (daysToResolution > 90) {
        timeDecayDirection = "neutral";
        timeDecayConviction = 0.15;
        timeDecayReason = `${daysToResolution} days to resolution — long horizon reduces signal reliability, high uncertainty`;
      } else {
        timeDecayDirection = "neutral";
        timeDecayConviction = 0.30;
        timeDecayReason = `${daysToResolution} days to resolution — mid-horizon, time pressure not yet a factor`;
      }
    }
  }

  signals.push({
    name: "Time Horizon",
    direction: timeDecayDirection,
    weight: 0.12,
    conviction: timeDecayConviction,
    reason: timeDecayReason,
  });

  // ── 5. Market Thickness Signal (w: 0.15) ──────────────────────────────────
  // High liquidity = efficient price = higher confidence in consensus.
  // Thin market = noise, wider edge opportunity.
  const liquidityNum = parseFloat((market.liquidity ?? "0").replace(/[^0-9.]/g, "")) || 0;
  const volumeNum = parseFloat((market.volume ?? "0").replace(/[^0-9.]/g, "")) || 0;

  let priceEfficiency: "efficient" | "potentially_mispriced" | "thin_market";
  let thicknessDirection: "YES" | "NO" | "neutral" = "neutral";
  let thicknessConviction: number;
  let thicknessReason: string;

  if (liquidityNum >= 1_000_000 || volumeNum >= 500_000) {
    priceEfficiency = "efficient";
    thicknessConviction = 0.70;
    // In efficient markets, consensus is reliable → reinforce it
    thicknessDirection = consensusDirection === "YES" ? "YES" : consensusDirection === "NO" ? "NO" : "neutral";
    thicknessReason = `High-liquidity market ($${(liquidityNum / 1e6).toFixed(1)}M liq) — price reflects well-informed participants, consensus is reliable`;
  } else if (liquidityNum >= 100_000 || volumeNum >= 50_000) {
    priceEfficiency = "efficient";
    thicknessConviction = 0.40;
    thicknessDirection = "neutral";
    thicknessReason = `Moderate liquidity — price has reasonable efficiency but potential for informed-money edge`;
  } else {
    priceEfficiency = "thin_market";
    thicknessConviction = 0.30;
    thicknessDirection = "neutral";
    thicknessReason = `Thin market (low liquidity) — price may not reflect full information, treat consensus with caution`;
  }

  // Override: potentially_mispriced if market is thin but news/base rate diverge from consensus
  if (priceEfficiency === "thin_market" && sentimentDirection !== "neutral" && sentimentDirection !== consensusDirection) {
    priceEfficiency = "potentially_mispriced";
    thicknessReason += ". News sentiment diverges from market price — possible mispricing.";
  }

  signals.push({
    name: "Market Liquidity",
    direction: thicknessDirection,
    weight: 0.15,
    conviction: thicknessConviction,
    reason: thicknessReason,
  });

  // ── Score aggregation ──────────────────────────────────────────────────────
  let yesScore = 0;
  let noScore = 0;

  for (const sig of signals) {
    const points = sig.weight * sig.conviction * 100;
    if (sig.direction === "YES") yesScore += points;
    else if (sig.direction === "NO") noScore += points;
    // neutral contributes nothing
  }

  const netScore = yesScore - noScore;
  const direction: "YES" | "NO" = netScore >= 0 ? "YES" : "NO";

  // Confidence: separation drives base, agreement boosts/penalizes
  const separation = Math.abs(netScore);
  let confidence = Math.min(90, Math.max(15, separation * 1.5 + 20));

  // Signal agreement
  const directionalSignals = signals.filter((s) => s.direction !== "neutral");
  const agreeingSignals = directionalSignals.filter((s) => s.direction === direction);
  const agreement = directionalSignals.length
    ? (agreeingSignals.length / directionalSignals.length) * 100
    : 50;

  if (agreement >= 80) confidence += 8;
  else if (agreement >= 65) confidence += 4;
  else if (agreement < 45) confidence -= 8;

  // Thin market penalty
  if (priceEfficiency === "thin_market") confidence -= 5;

  // Long horizon penalty
  if (daysToResolution !== null && daysToResolution > 90) confidence -= 5;

  confidence = Math.max(15, Math.min(88, Math.round(confidence)));

  // Rationale
  const topSignals = signals
    .filter((s) => s.direction === direction)
    .sort((a, b) => b.weight * b.conviction - a.weight * a.conviction)
    .slice(0, 2);

  const verdictRationale = [
    `${direction} verdict supported by ${agreeingSignals.length}/${directionalSignals.length} fundamental signals.`,
    topSignals.length > 0
      ? `Key drivers: ${topSignals.map((s) => s.name.toLowerCase()).join(" and ")}.`
      : "",
    priceEfficiency === "thin_market"
      ? "Caution: thin market liquidity reduces confidence in price efficiency."
      : `Market consensus at ${impliedProbability}% ${priceEfficiency === "efficient" ? "from a well-informed crowd" : "in a moderately liquid venue"}.`,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    direction,
    confidence,
    yesScore: Math.round(yesScore * 10) / 10,
    noScore: Math.round(noScore * 10) / 10,
    netScore: Math.round(netScore * 10) / 10,
    signals,
    verdictRationale,
    impliedProbability,
    priceEfficiency,
    daysToResolution,
    category,
  };
}

// ─── Category-specific analytical framework (for prompt injection) ─────────────

export function buildCategoryFramework(
  category: MarketCategory,
  impliedProbability: number
): string {
  switch (category) {
    case "politics":
      return [
        `POLITICAL ANALYSIS FRAMEWORK:`,
        `- Evaluate: polling average vs market implied probability (current: ${impliedProbability}%)`,
        `- Factor: incumbency advantage, historical base rates, turnout model shifts, swing-state dynamics`,
        `- Assess: institutional endorsements, campaign finance momentum, early voting trends`,
        `- Key insight: prediction markets overweight recent news and underweight structural fundamentals`,
        `- Contrast: where does the market price diverge from polling consensus, and why?`,
      ].join("\n");

    case "economics":
      return [
        `MACROECONOMIC ANALYSIS FRAMEWORK:`,
        `- Evaluate: central bank forward guidance vs market pricing (current implied: ${impliedProbability}%)`,
        `- Factor: CPI trajectory, employment data, yield curve, Fed dot plot vs CME FedWatch`,
        `- Assess: analyst consensus vs crowd wisdom — where does Street disagree with the market?`,
        `- Key insight: economic data surprises drive rapid repricing; monitor real-time release calendar`,
        `- Contrast: what would have to be true for the market to be wrong?`,
      ].join("\n");

    case "stocks":
      return [
        `EQUITY ANALYSIS FRAMEWORK:`,
        `- Evaluate: earnings quality, revenue growth, margin direction, guidance, and valuation versus sector peers`,
        `- Factor: market regime, rates, sector rotation, liquidity, institutional positioning, and recent analyst revisions`,
        `- Assess: price action vs fundamentals — whether momentum is supported by catalysts or only short-term flow`,
        `- Key insight: tokenized stocks trade through secondary liquidity, so analysis must separate company outlook from route/liquidity risk`,
        `- Contrast: what catalyst, earnings print, guidance update, or macro shock would invalidate the current bullish/bearish read?`,
      ].join("\n");

    case "ipos":
      return [
        `IPO ANALYSIS FRAMEWORK:`,
        `- Evaluate: filing status, S-1/confidential submission signals, underwriter selection, and roadshow timing vs market implied probability (${impliedProbability}%)`,
        `- Factor: private-market valuation marks, latest funding round, secondary sales, revenue growth, margin profile, and public comparable multiples`,
        `- Assess: listing window quality — rates, equity risk appetite, sector multiples, recent IPO performance, and sponsor/investor pressure for liquidity`,
        `- Key insight: IPO markets often overprice famous-company narratives while underweighting listing mechanics, valuation discipline, and delay risk`,
        `- Contrast: what specific filing, valuation mark, or market-window signal would make the current Polymarket price wrong?`,
      ].join("\n");

    case "sports":
      return [
        `SPORTS ANALYSIS FRAMEWORK:`,
        `- Evaluate: form over last 10 fixtures, head-to-head record, current injuries`,
        `- Factor: lineup changes, home/away advantage, rest differential, travel schedule`,
        `- Assess: how does prediction market pricing at ${impliedProbability}% compare to bookmaker odds?`,
        `- Key insight: sports markets resolve on single high-variance events — edge comes from lineup intel`,
        `- Contrast: what specific lineup or injury update would flip the outcome?`,
      ].join("\n");

    case "science_tech":
      return [
        `SCIENCE & TECHNOLOGY ANALYSIS FRAMEWORK:`,
        `- Evaluate: milestone precedent — what % of similar milestones resolved YES on time historically?`,
        `- Factor: regulatory pipeline stage, prior approval/rejection rates, technical readiness level`,
        `- Assess: expert consensus (peer-reviewed research, industry reports) vs market at ${impliedProbability}%`,
        `- Key insight: ambitious technical milestones typically run 30-50% longer than planned`,
        `- Contrast: which technical or regulatory blocker is most likely to cause delay/failure?`,
      ].join("\n");

    case "legal":
      return [
        `LEGAL & REGULATORY ANALYSIS FRAMEWORK:`,
        `- Evaluate: jurisdictional precedent, presiding judge/court historical stance`,
        `- Factor: regulatory calendar, lobbying intensity, political pressure on enforcement agencies`,
        `- Assess: legal expert consensus vs market pricing at ${impliedProbability}%`,
        `- Key insight: legal outcomes hinge on procedural mechanics, not public narrative`,
        `- Contrast: what specific procedural outcome would invalidate the current market consensus?`,
      ].join("\n");

    default:
      return [
        `GENERAL ANALYSIS FRAMEWORK:`,
        `- Evaluate: information quality — verifiable evidence vs speculation, signal vs noise`,
        `- Factor: resolution mechanism — what specific, observable event determines YES vs NO?`,
        `- Assess: institutional vs retail positioning divergence, market price ${impliedProbability}% vs fair value`,
        `- Key insight: focus on the resolution criteria and verification mechanism, not the narrative`,
        `- Contrast: what would the market have to believe to be right or wrong?`,
      ].join("\n");
  }
}
