import { config } from "../config.js";
import { createHash } from "node:crypto";
import type { TechnicalAnalysis } from "./ta-engine.js";
import type { FundamentalVerdict } from "./fundamental-engine.js";
import { buildCategoryFramework } from "./fundamental-engine.js";

const OPENAI_ANALYSIS_TIMEOUT_MS = Number(process.env.OPENAI_ANALYSIS_TIMEOUT_MS ?? 25000);

export interface AnalysisMarketInput {
  id: string;
  question: string;
  category?: string;
  description?: string;
  outcomes?: Array<{ name: string; price: number }>;
  volume?: string;
  liquidity?: string;
  endDate?: string;
}

export interface MarketAnalysis {
  eventBrief: string;
  globalContext: string;
  structuralDrivers: string[];
  marketSignalInterpretation: string;
  informationAsymmetry: string;
  riskLandscape: string[];
  strategicInsight: string;
  terminalNote: string;
  intelligenceDossier?: {
    probabilityBias: "Positive" | "Negative" | "Neutral";
    tacticalMilestones: string[];
    informationAsymmetry: string;
    catalystChronology: string[];
    signalStrength?: number;
    rawSignalHash: string;
  };
}

function analysisSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "eventBrief", "globalContext", "structuralDrivers",
      "marketSignalInterpretation", "informationAsymmetry", "riskLandscape",
      "strategicInsight", "terminalNote"
    ],
    properties: {
      eventBrief: { type: "string" },
      globalContext: { type: "string" },
      structuralDrivers: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 5 },
      marketSignalInterpretation: { type: "string" },
      informationAsymmetry: { type: "string" },
      riskLandscape: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 4 },
      strategicInsight: { type: "string" },
      terminalNote: { type: "string" }
    }
  };
}

function buildPrompt(market: AnalysisMarketInput) {
  const consensusStr = market.outcomes?.[0]?.price ? `${market.outcomes[0].price}%` : 'N/A';
  
  const baseSystemPrompt = [
      `You are an institutional intelligence analyst operating inside a real-time intelligence terminal.`,
      `Your role is NOT to predict outcomes or assign probabilities.`,
      `Your role is to:`,
      `- analyze global, economic, political, technological, and cultural forces`,
      `- interpret market behavior as a reflection of narrative and positioning`,
      `- identify structural drivers, information asymmetries, and risk landscapes`,
      ``,
      `You must NEVER:`,
      `- give direct predictions (e.g., "this will happen")`,
      `- assign probabilities or percentages`,
      `- sound like a betting or forecasting tool`,
      ``,
      `You must ALWAYS:`,
      `- write in a confident, analytical, concise tone`,
      `- think like a macro strategist or intelligence analyst`,
      `- explain WHY something is happening, not WHAT will happen`,
      `- provide insight that feels worth trusting and coming back for`,
      ``
  ];

  baseSystemPrompt.push(
    `Output must be structured into clearly defined sections.`,
    `Avoid fluff. Avoid generic statements. Every sentence must carry insight.`,
    ``,
    `EVENT: ${market.question}`,
    ``,
    `CONTEXT:`,
    `- Source: Polymarket Event`,
    `- Category: ${market.category ?? "Events"}`,
    `- Market Behavior: Primary outcome consensus sits at ${consensusStr} with a 24h volume of ${market.volume ?? "$0"}.`,
    `- Timeframe: ${market.endDate ?? "N/A"}`,
    ``,
    `OBJECTIVE:`,
    `Generate a high-quality intelligence report explaining the deeper forces behind this event.`,
    ``,
    `REQUIRED MODULES:`,
    `1. EVENT BRIEF: Write a sharp event brief explaining why this topic is attracting attention. Focus on why this event exists and what broader system it belongs to. Keep it concise (3-4 sentences max).`,
    `2. GLOBAL CONTEXT: Explain the global context surrounding this event. Include macro trends and how global systems influence this event. Make it feel like a macro intelligence briefing.`,
    `3. STRUCTURAL DRIVERS: Identify the core forces driving this situation. Provide 3-5 drivers. For each, name the driver and explain its impact clearly and concretely. Avoid vague statements.`,
    `4. MARKET SIGNAL INTERPRETATION: Interpret how participants are reacting. Focus on positioning behavior, sentiment structure, and what current behavior reveals about conviction and uncertainty.`,
    `5. INFORMATION ASYMMETRY: Explain where information gaps exist. Focus on what the public believes vs what is actually known, and hidden/opaque factors.`,
    `6. RISK LANDSCAPE: Analyze the key risks. Provide 3-4 risks. Explain each in a sharp, non-generic way. Frame them as uncertainties.`,
    `7. STRATEGIC INSIGHT: Provide strategic insight on how this event should be interpreted. Focus on how to think about this situation, what signals actually matter, and what should be monitored going forward.`,
    `8. TERMINAL NOTE: Write a closing note reinforcing that this is an intelligence analysis. Emphasize understanding systems/narratives over predicting.`,
    ``,
    `STYLE RULES:`,
    `- No fluff`,
    `- No generic phrases`,
    `- No repetition`,
    `- No mention of betting, odds, or prediction markets`,
    `- Use precise, confident language`,
    `- Every sentence must provide value`
  );

  return baseSystemPrompt.join("\n");
}

function fallbackAnalysis(_market: AnalysisMarketInput): MarketAnalysis {
  return {
    eventBrief: `This situation has evolved into a key bellwether for assessing the immediate structural dependencies within its sector. It reflects an ongoing recalibration among institutional participants attempting to price in opaque timing and regulatory shifts.`,
    globalContext: `Broad macroeconomic contraction and localized policy ambiguity form the backdrop of this dynamic. As global liquidity tightens, secondary narratives must demonstrate resilient fundamentals to attract conviction. Current positioning indicates the market is absorbing elevated systemic stress without full destabilization.`,
    structuralDrivers: [
      "Institutional Accumulation: Strategic repositioning by entities seeking exposure ahead of consensus formation.",
      "Policy Ambiguity: The persistent lack of a formalized framework stalls immediate execution pathways.",
      "Liquidity Silos: Capital remains fragmented, preventing strong momentum breakthroughs and artificially containing volatility."
    ],
    marketSignalInterpretation: `Participants exhibit significant hesitancy, preferring to hedge downside exposure rather than establish outright aggressive positioning. This suggests a market structure governed by preservation of capital rather than opportunistic pursuit of alpha, highlighting deep institutional uncertainty.`,
    informationAsymmetry: `There remains a profound disconnect between retail narrative amplification and the actual timelines dictated by behind-the-scenes procedural gatekeepers. Observers are overweighting public discourse while discounting structural mechanics.`,
    riskLandscape: [
      "Narrative Risk: Premature public consensus may force rapid liquidation if the narrative fractures.",
      "Structural Risk: Underlying mechanics lack the robustness to handle exogenous liquidity shocks.",
      "Timing Risk: The duration required for resolution may outlast participant capital availability."
    ],
    strategicInsight: `Attention should shift away from immediate public sentiment indicators towards deep metrics of capital flow and procedural milestones. Recognizing the divergence between narrative momentum and structural reality is the key to maintaining an objective positioning stance.`,
    terminalNote: `[SIA] This assessment aims to decode structural vulnerabilities rather than forecast chronological outcomes. Operate via systems thinking.`
  };
}

export interface TradeInsightInput {
  marketQuestion: string;
  category?: string;
  side: "BUY" | "SELL";
  avgPrice: number | null;
  amountUsd: number;
  bestAsk: number | null;
  outcomes?: Array<{ name: string; price: number }>;
  volume?: string;
}

export interface TradeInsightResult {
  signal: "bullish" | "bearish" | "neutral";
  headline: string;
  keyRisk: string;
  context: string;
  signalStrength: number;
}

function tradeInsightSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["signal", "headline", "keyRisk", "context", "signalStrength"],
    properties: {
      signal: { type: "string", enum: ["bullish", "bearish", "neutral"] },
      headline: { type: "string" },
      keyRisk: { type: "string" },
      context: { type: "string" },
      signalStrength: { type: "number" }
    }
  };
}

function buildTradeInsightPrompt(input: TradeInsightInput): string {
  const priceStr = input.avgPrice ? `${(input.avgPrice * 100).toFixed(1)}¢` : "N/A";
  const consensusStr = input.outcomes?.length
    ? input.outcomes.map(o => `${o.name}: ${o.price.toFixed(0)}%`).join(", ")
    : "N/A";

  return [
    `You are a concise market intelligence analyst.`,
    `A trader is about to ${input.side} shares in: "${input.marketQuestion}"`,
    `Category: ${input.category ?? "Events"}`,
    `Entry price: ${priceStr}`,
    `Trade size: $${input.amountUsd.toFixed(2)}`,
    `Consensus: ${consensusStr}`,
    `Volume: ${input.volume ?? "N/A"}`,
    ``,
    `Provide a BRIEF trade-context signal:`,
    `- signal: "bullish", "bearish", or "neutral" (directional view on this specific entry)`,
    `- headline: 1 sentence (max 15 words) summarizing the setup`,
    `- keyRisk: 1 sentence on the primary risk for this specific trade`,
    `- context: 1-2 sentences of strategic context`,
    `- signalStrength: 0-100 confidence score`,
    ``,
    `Be precise and opinionated. No fluff. No predictions or probabilities.`
  ].join("\n");
}

export async function generateTradeInsight(
  input: TradeInsightInput
): Promise<TradeInsightResult | null> {
  if (!config.openai.apiKey) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.openai.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: config.openai.model,
        messages: [{ role: "user", content: buildTradeInsightPrompt(input) }],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "trade_insight",
            strict: true,
            schema: tradeInsightSchema()
          }
        }
      }),
      signal: controller.signal
    });

    if (!response.ok) return null;
    const body = await response.json();
    const jsonText = body?.choices?.[0]?.message?.content;
    if (!jsonText) return null;

    try {
      return JSON.parse(jsonText) as TradeInsightResult;
    } catch {
      return null;
    }
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export interface PremiumAnalysisInput {
  id: string;
  question: string;
  category?: string;
  description?: string;
  outcomes?: Array<{ name: string; price: number }>;
  volume?: string;
  liquidity?: string;
  endDate?: string;
}

export interface PremiumNewsArticle {
  title: string;
  url: string;
  bodyText: string;
}

export interface PremiumAnalysisResult {
  verdict: { direction: "YES" | "NO"; confidence: number; rationale: string };
  eventBrief: string;
  globalContext: string;
  structuralDrivers: string[];
  marketSignalInterpretation: string;
  informationAsymmetry: string;
  riskLandscape: string[];
  strategicInsight: string;
  terminalNote: string;
}

const GENERIC_PREMIUM_FALLBACK_RATIONALE =
  "Insufficient live data for a high-conviction directional call.";

function isPaidPremiumReport(market: PremiumAnalysisInput): boolean {
  const marketId = String(market.id ?? "").toLowerCase();
  if (marketId.startsWith("stock:")) return config.payment.stockAnalysisFeeEnabled;
  return config.payment.analysisFeeEnabled;
}

function isGenericPremiumFallback(rationale?: string | null) {
  return String(rationale ?? "")
    .toLowerCase()
    .includes(GENERIC_PREMIUM_FALLBACK_RATIONALE.toLowerCase());
}

function taVerdict(ta: TechnicalAnalysis): PremiumAnalysisResult["verdict"] {
  return {
    direction: ta.verdict.direction as "YES" | "NO",
    confidence: Math.min(95, Math.max(10, ta.verdict.confidence)),
    rationale: `Quant engine verdict based on ${ta.confluenceFactors?.length ?? 0} confluence factors across 24 technical signals (${ta.verdict.signalAgreement ?? 0}% signal agreement). ${ta.verdict.verdictRationale ?? `${ta.verdict.direction === "YES" ? "Bullish" : "Bearish"} structure confirmed by ${ta.htf?.structure ?? "N/A"} market structure with ${ta.htf?.trendStrength ?? "N/A"} trend strength.`}`
  };
}

function fundamentalVerdict(fundamental: FundamentalVerdict): PremiumAnalysisResult["verdict"] {
  return {
    direction: fundamental.direction as "YES" | "NO",
    confidence: Math.min(88, Math.max(15, fundamental.confidence)),
    rationale: `Fundamental signal engine verdict: ${fundamental.verdictRationale ?? "Based on aggregated news sentiment and event probability scoring."}`
  };
}

function enforceComputedPremiumVerdict(
  result: PremiumAnalysisResult,
  ta?: TechnicalAnalysis | null,
  fundamental?: FundamentalVerdict | null
): PremiumAnalysisResult {
  const computed = ta?.verdict?.direction
    ? taVerdict(ta)
    : fundamental?.direction
    ? fundamentalVerdict(fundamental)
    : null;

  if (!computed) return result;

  const incoming = result.verdict;
  const incomingConfidence = Number(incoming?.confidence);
  const confidenceDrift = Number.isFinite(incomingConfidence)
    ? Math.abs(incomingConfidence - computed.confidence)
    : Number.POSITIVE_INFINITY;
  const shouldReplaceRationale =
    !incoming?.rationale ||
    isGenericPremiumFallback(incoming.rationale) ||
    incoming.direction !== computed.direction ||
    confidenceDrift > 10;

  return {
    ...result,
    verdict: {
      direction: computed.direction,
      confidence: computed.confidence,
      rationale: shouldReplaceRationale ? computed.rationale : incoming.rationale,
    },
  };
}

function premiumAnalysisSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "verdict", "eventBrief", "globalContext", "structuralDrivers",
      "marketSignalInterpretation", "informationAsymmetry", "riskLandscape",
      "strategicInsight", "terminalNote"
    ],
    properties: {
      verdict: {
        type: "object",
        additionalProperties: false,
        required: ["direction", "confidence", "rationale"],
        properties: {
          direction: { type: "string", enum: ["YES", "NO"] },
          confidence: { type: "number" },
          rationale: { type: "string" }
        }
      },
      eventBrief: { type: "string" },
      globalContext: { type: "string" },
      structuralDrivers: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 5 },
      marketSignalInterpretation: { type: "string" },
      informationAsymmetry: { type: "string" },
      riskLandscape: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 4 },
      strategicInsight: { type: "string" },
      terminalNote: { type: "string" }
    }
  };
}

function buildPremiumPrompt(
  market: PremiumAnalysisInput,
  articles: PremiumNewsArticle[],
  ta?: TechnicalAnalysis | null,
  fundamental?: FundamentalVerdict | null,
  marketMappingNote?: string | null
): string {
  const consensusStr = market.outcomes?.length
    ? market.outcomes.map(o => `${o.name}: ${o.price}%`).join(" / ")
    : "N/A";

  const newsSection = articles.length
    ? articles.map((a, i) => `--- Source ${i + 1}: ${a.title} ---\n${a.bodyText}`).join("\n\n")
    : "No live news available at this time.";

  const taSection = ta
    ? [
        ``,
        `TECHNICAL ANALYSIS (${ta.symbol} — live from Binance):`,
        ta.summary,
      ].join("\n")
    : "";

  // If we have TA with a pre-computed verdict, the AI must justify it — not override it
  const verdictBlock = ta?.verdict
    ? [
        ``,
        `PRE-COMPUTED VERDICT FROM QUANTITATIVE ENGINE:`,
        `Direction: ${ta.verdict.direction}`,
        `Confidence: ${ta.verdict.confidence}%`,
        `Signal Agreement: ${ta.verdict.agreeingSignals}/${ta.verdict.totalSignals} directional signals (${ta.verdict.signalAgreement}%)`,
        `Net Score: ${ta.verdict.netScore > 0 ? "+" : ""}${ta.verdict.netScore} (bull ${ta.verdict.bullishScore} / bear ${ta.verdict.bearishScore})`,
        `Regime: ${ta.regime} (adjustment: ${ta.verdict.regimeAdjustment > 0 ? "+" : ""}${ta.verdict.regimeAdjustment}pts)`,
        ...(ta.verdict.contrariansFlags.length > 0
          ? [`Contrarian signals: ${ta.verdict.contrariansFlags.join(" | ")}`]
          : []),
      ].join("\n")
    : "";

  // ── Category framework (non-crypto only) ──────────────────────────────────
  const categoryFramework = !ta && fundamental
    ? [
        ``,
        buildCategoryFramework(fundamental.category, fundamental.impliedProbability),
      ].join("\n")
    : "";

  // ── Fundamental verdict block (non-crypto only) ────────────────────────────
  const fundamentalVerdictBlock = !ta && fundamental
    ? [
        ``,
        `PRE-COMPUTED VERDICT FROM FUNDAMENTAL SIGNAL ENGINE:`,
        `Direction: ${fundamental.direction}`,
        `Confidence: ${fundamental.confidence}%`,
        `Yes Score: ${fundamental.yesScore} / No Score: ${fundamental.noScore} / Net: ${fundamental.netScore > 0 ? "+" : ""}${fundamental.netScore}`,
        `Market Implied Probability: ${fundamental.impliedProbability}%`,
        `Price Efficiency: ${fundamental.priceEfficiency.replace(/_/g, " ")}`,
        ...(fundamental.daysToResolution !== null
          ? [`Days to Resolution: ${fundamental.daysToResolution}`]
          : []),
        ``,
        `SIGNAL BREAKDOWN (${fundamental.signals.length} signals):`,
        ...fundamental.signals.map(
          (s) =>
            `- ${s.name}: ${s.direction.toUpperCase()} (weight ${(s.weight * 100).toFixed(0)}%, conviction ${(s.conviction * 100).toFixed(0)}%) — ${s.reason}`
        ),
      ].join("\n")
    : "";

  // ── TA instructions (crypto only) ─────────────────────────────────────────
  const taInstructions = ta
    ? [
        ``,
        `CRITICAL — CRYPTO MARKET WITH FULL QUANTITATIVE TA SUITE:`,
        `This is a crypto asset market. A deterministic quant engine has already computed a verdict`,
        `from 16 weighted signal votes across multi-timeframe technical analysis.`,
        ...(marketMappingNote
          ? [
              ``,
              `MARKET-QUESTION MAPPING (critical — read carefully):`,
              marketMappingNote,
              `The verdict direction "${ta.verdict.direction}" ALREADY reflects this mapping. The raw`,
              `technicals describe the ASSET (bullish/bearish); the verdict answers the MARKET QUESTION.`,
              `If the asset is bullish but YES requires a price DROP, the correct verdict is NO — explain`,
              `the YES/NO strictly in terms of the market's resolution condition, never just asset direction.`,
            ]
          : []),
        ``,
        `The quant engine analyzed 16 weighted signal votes:`,
        `- 4H/1H/15m market structure, EMA ribbon (9/21/50/200): ${ta.ema.ribbonState.replace("_", " ")}`,
        `- MACD: ${ta.macd.crossover !== "none" ? `FRESH ${ta.macd.crossover.replace("_", " ").toUpperCase()}` : ta.macd.trend + " (" + ta.macd.histogramDirection + ")"}`,
        `- Bollinger Bands: %B ${ta.bollinger.percentB.toFixed(0)}%${ta.bollinger.squeeze ? " — SQUEEZE ACTIVE" : ""}`,
        `- RSI: ${ta.rsi14} (multi-TF: ${ta.multiTfRsi.alignment.replace("_", " ")})`,
        ...(ta.rsiDivergence ? [`- ⚠ RSI DIVERGENCE: ${ta.rsiDivergence.type}`] : []),
        ...(ta.obv.divergence ? [`- ⚠ OBV DIVERGENCE: ${ta.obv.divergence.type}`] : []),
        `- Fibonacci, key S/R, VWAP, OBV, funding rate, Fear & Greed`,
        ...(ta.openInterest ? [`- Open Interest: $${(ta.openInterest.current / 1e9).toFixed(2)}B (${ta.openInterest.change24h > 0 ? "+" : ""}${ta.openInterest.change24h.toFixed(1)}% 24h) — ${ta.openInterest.interpretation}`] : []),
        ...(ta.longShort ? [`- Long/Short: retail ${ta.longShort.globalLongPct.toFixed(0)}%L/${ta.longShort.globalShortPct.toFixed(0)}%S, smart money ${ta.longShort.topTraderLongPct.toFixed(0)}%L — ${ta.longShort.interpretation}`] : []),
        ...(ta.takerRatio ? [`- Taker Ratio: ${(ta.takerRatio.buyRatio * 100).toFixed(1)}% buy — ${ta.takerRatio.interpretation}`] : []),
        ``,
        `YOUR ROLE IS TO EXPLAIN AND JUSTIFY — NOT TO OVERRIDE:`,
        `- Your verdict MUST match the quant engine: ${ta.verdict.direction} direction`,
        `- Your confidence MUST be within ±10 of the computed ${ta.verdict.confidence}%`,
        `- Your rationale must explain WHY the indicators support this direction`,
        `- Reference specific EMA levels, MACD state, Bollinger position, RSI readings`,
        `- Call out any divergences (RSI, OBV) as key evidence`,
        ...(ta.longShort ? [`- Reference the L/S ratio positioning — retail vs smart money divergence is a key insight`] : []),
        ...(ta.takerRatio ? [`- Use the taker ratio to explain who is being aggressive right now`] : []),
        ...(ta.openInterest ? [`- Reference OI trend to confirm whether new money is entering or leaving`] : []),
        `- Use exact dollar price levels from Fibonacci and S/R throughout`,
        `- If news contradicts the TA verdict, explain the divergence — but maintain the TA direction`,
        `- The only exception: if breaking news fundamentally invalidates the technical setup, you may flip`,
        `  the direction but MUST explicitly state why and reduce confidence to 30-45%`,
        `- Include specific price levels for entries, stops, and targets from the R:R data`,
      ].join("\n")
    : !ta && fundamental
    ? [
        ``,
        `YOUR ROLE IS TO EXPLAIN AND JUSTIFY — NOT TO OVERRIDE:`,
        `- Your verdict MUST match the fundamental engine: ${fundamental.direction}`,
        `- Your confidence MUST be within ±10 of the computed ${fundamental.confidence}%`,
        `- Reference the category framework above — apply its specific analytical lenses`,
        `- Use the signal breakdown to explain WHY each driver supports the verdict`,
        `- Call out the news sentiment findings explicitly — which articles are most relevant?`,
        `- Address the market consensus (${fundamental.impliedProbability}% implied) — is the crowd right or is this a mispricing?`,
        ...(fundamental.priceEfficiency === "potentially_mispriced"
          ? [`- ⚠ POTENTIAL MISPRICING DETECTED: news sentiment diverges from market price — address this directly`]
          : []),
        ...(fundamental.daysToResolution !== null && fundamental.daysToResolution <= 14
          ? [`- Resolution is imminent (${fundamental.daysToResolution} days) — focus on near-term catalysts and resolution mechanics`]
          : []),
        `- If news contradicts the fundamental verdict, acknowledge but maintain direction unless evidence is overwhelming`,
      ].join("\n")
    : "";

  const isNonCryptoWithFundamental = !ta && !!fundamental;
  const isPaidReport = isPaidPremiumReport(market);

  return [
    `You are a senior quantitative intelligence analyst producing a premium market report.`,
    isPaidReport
      ? `You have been paid $1 for this analysis. Deliver maximum value.`
      : `This report is free during testing, but it must still feel production-grade and high-value.`,
    ta
      ? `Your analysis is backed by a real-time quantitative engine processing live Binance data.`
      : `Your analysis is backed by a fundamental signal engine and live news intelligence.`,
    ``,
    `MARKET: ${market.question}`,
    `CATEGORY: ${market.category ?? "Events"}`,
    `CONSENSUS: ${consensusStr}`,
    `VOLUME: ${market.volume ?? "N/A"} | LIQUIDITY: ${market.liquidity ?? "N/A"}`,
    `CLOSES: ${market.endDate ?? "N/A"}`,
    categoryFramework,
    ``,
    `LIVE INTELLIGENCE (sourced ${new Date().toISOString()}, ${articles.length} articles):`,
    newsSection,
    taSection,
    fundamentalVerdictBlock,
    verdictBlock,
    taInstructions,
    ``,
    `REQUIRED OUTPUT:`,
    `1. VERDICT: ${
      ta?.verdict
        ? `You MUST output "${ta.verdict.direction}" as direction. Confidence within ±10 of ${ta.verdict.confidence}%. Write a 2-3 sentence rationale explaining the technical AND fundamental basis.`
        : isNonCryptoWithFundamental
        ? `You MUST output "${fundamental!.direction}" as direction. Confidence within ±10 of ${fundamental!.confidence}%. Write a 2-3 sentence rationale explaining BOTH the signal engine findings AND the news evidence.`
        : `You MUST choose YES or NO. Include confidence 0-100 and a 2-3 sentence rationale.`
    }`,
    `2. EVENT BRIEF: Why this event matters and what broader system it belongs to (3-4 sentences).`,
    `3. GLOBAL CONTEXT: ${isNonCryptoWithFundamental ? `Apply the ${fundamental!.category.replace("_", "/") } framework above — connect global/macro forces to this specific resolution question.` : "Macro trends, geopolitical forces, and structural factors at play."}`,
    `4. STRUCTURAL DRIVERS: 3-5 named forces driving the outcome. Each must be concrete and specific.${ta ? " Include at least 2 technical drivers with exact price levels." : isNonCryptoWithFundamental ? ` Map at least 2 drivers directly to signals from the fundamental engine.` : ""}`,
    `5. MARKET SIGNAL INTERPRETATION: ${
      ta
        ? "Interpret the EMA ribbon, MACD histogram, Bollinger position, RSI readings, and volume flow. Use specific numbers."
        : isNonCryptoWithFundamental
        ? `Interpret what the market price of ${fundamental!.impliedProbability}% implies about crowd conviction. Reference the news sentiment signal and whether it confirms or contradicts the price.`
        : "What current pricing and volume reveal about conviction and positioning."
    }`,
    `6. INFORMATION ASYMMETRY: What the public narrative misses. ${
      ta
        ? "Include what the quant engine detects that retail traders cannot see (divergences, smart money flow, crowded positioning)."
        : isNonCryptoWithFundamental
        ? `Highlight where the category base rate diverges from market price and what this implies. Surface what retail participants are likely missing.`
        : "Where hidden or opaque factors exist."
    }`,
    `7. RISK LANDSCAPE: 3-4 specific risks framed as uncertainties. Not generic.${ta ? " Include at least 1 technical risk with a specific price level that would invalidate the thesis." : isNonCryptoWithFundamental ? " Include the specific scenario that would flip the verdict." : ""}`,
    `8. STRATEGIC INSIGHT: ${
      ta
        ? "Provide specific entry zones, stop levels, and targets from the technical data. Tell the user exactly what to watch."
        : isNonCryptoWithFundamental
        ? `What specific catalyst, data release, or event should participants monitor? What is the highest-signal indicator to watch before resolution?`
        : "How to think about this situation. What signals matter most going forward."
    }`,
    `9. TERMINAL NOTE: Closing note. ${
      ta
        ? "Reference the quant engine's signal agreement and confluence score."
        : isNonCryptoWithFundamental
        ? `Reference the fundamental engine's signal count and price efficiency rating (${fundamental!.priceEfficiency.replace(/_/g, " ")}).`
        : "Reinforce the analytical framework."
    }`,
    ``,
    `VERDICT RULES:`,
    ...(ta?.verdict
      ? [
          `- Your direction MUST be ${ta.verdict.direction} (from the quant engine)`,
          `- Your confidence MUST be between ${Math.max(10, ta.verdict.confidence - 10)} and ${Math.min(95, ta.verdict.confidence + 10)}`,
          `- ${ta.verdict.signalAgreement >= 70 ? "High signal agreement — express conviction clearly" : "Lower signal agreement — acknowledge the contrarian signals but maintain direction"}`,
        ]
      : isNonCryptoWithFundamental
      ? [
          `- Your direction MUST be ${fundamental!.direction} (from the fundamental engine)`,
          `- Your confidence MUST be between ${Math.max(15, fundamental!.confidence - 10)} and ${Math.min(88, fundamental!.confidence + 10)}`,
          `- ${fundamental!.confidence >= 65 ? "Sufficient signal strength — express conviction clearly and back it with evidence" : "Mixed signals — be direct about the verdict but acknowledge the key uncertainties"}`,
          ...(fundamental!.priceEfficiency === "potentially_mispriced"
            ? [`- This market may be mispriced — explicitly discuss the divergence between news and market price`]
            : []),
        ]
      : [
          `- Confidence 70-100: Strong directional evidence from news + structural factors`,
          `- Confidence 40-69: Leaning direction but significant uncertainty remains`,
          `- Confidence 0-39: Near coin-flip, verdict is marginal`,
        ]),
    `- Be opinionated. The user paid for a clear signal, not hedging.`,
    ``,
    `STYLE: No fluff. No generic phrases. Every sentence must carry insight. Use precise, confident language.${ta ? " Include specific dollar amounts and percentages throughout." : isNonCryptoWithFundamental ? " Reference specific data points from the news articles and signal engine throughout." : ""}`
  ].join("\n");
}

export function fallbackPremiumAnalysis(
  ta?: TechnicalAnalysis | null,
  fundamental?: FundamentalVerdict | null
): PremiumAnalysisResult {
  // Use TA-computed verdict when available instead of generic fallback
  const hasTA = ta?.verdict?.direction;
  const hasFundamental = fundamental?.direction;

  const verdict = hasTA
    ? taVerdict(ta!)
    : hasFundamental
    ? fundamentalVerdict(fundamental!)
    : {
        direction: "NO" as const,
        confidence: 50,
        rationale: "Insufficient live data for a high-conviction directional call. The structural balance of forces does not strongly favor either outcome at this time."
      };

  // When TA data is available, build data-rich fallback sections
  if (hasTA) {
    const t = ta!;
    const priceStr = `$${t.currentPrice?.toLocaleString() ?? "N/A"}`;
    const structure = t.htf?.structure ?? "undefined";
    const bias = t.htf?.bias ?? "neutral";
    const rsi = t.rsi14 != null ? t.rsi14.toFixed(1) : "N/A";
    const macdHist = t.macd?.histogram?.toFixed(2) ?? "N/A";
    const bbPos = t.bollinger ? ((t.currentPrice - t.bollinger.lower) / (t.bollinger.upper - t.bollinger.lower) * 100).toFixed(0) : "N/A";
    const funding = t.funding?.rate != null ? (t.funding.rate * 100).toFixed(4) + "%" : "N/A";
    const oi = t.openInterest ? (t.openInterest.change24h > 0 ? "+" : "") + t.openInterest.change24h.toFixed(1) + "%" : "N/A";
    const lsGlobal = t.longShort ? `${t.longShort.globalLongPct.toFixed(0)}/${t.longShort.globalShortPct.toFixed(0)}` : "N/A";
    const ichStatus = t.ichimoku?.priceVsCloud ?? "N/A";
    const adxVal = t.adx?.adx?.toFixed(1) ?? "N/A";
    const adxTrend = t.adx?.trendStrength ?? "N/A";
    const stochK = t.stochRsi?.k?.toFixed(1) ?? "N/A";
    const cvdTrend = t.cvd?.trend ?? "N/A";

    // Find the golden ratio fib level (0.618)
    const goldenFib = t.fibLevels?.find(f => f.level === "0.618");

    // Determine relevant anchored VWAP value
    const anchoredVwapVal = t.anchoredVwap
      ? (t.anchoredVwap.anchorType === "swing_low" ? t.anchoredVwap.swingLowVwap : t.anchoredVwap.swingHighVwap)
      : null;

    // Risk/reward — use longRR or shortRR based on verdict direction
    const rr = t.riskReward
      ? (t.verdict.direction === "YES" ? t.riskReward.longRR : t.riskReward.shortRR)
      : null;

    return {
      verdict,
      eventBrief: `${t.symbol} at ${priceStr} with ${structure} market structure and ${bias} bias. The quant engine processed 24 signals across multiple timeframes with ${t.verdict.signalAgreement ?? 0}% agreement, producing a ${t.verdict.confidence}-confidence ${t.verdict.direction} verdict.`,
      globalContext: `Market regime: ${t.regime ?? "N/A"}. Fear & Greed Index: ${t.fearGreed?.value ?? "N/A"} (${t.fearGreed?.classification ?? "N/A"}). Funding rate at ${funding} with OI change ${oi} over 24h. Long/Short ratio: ${lsGlobal}. ${t.takerRatio?.trend ?? "Balanced"} taker flow detected.`,
      structuralDrivers: [
        `EMA Alignment: ${t.ema?.ribbonState ?? "N/A"} (price ${t.ema?.priceVsEma200 ?? "N/A"} EMA200)`,
        `MACD: Histogram at ${macdHist}, ${t.macd?.crossover ?? "no signal"} — ${Number(macdHist) > 0 ? "bullish momentum" : Number(macdHist) < 0 ? "bearish pressure" : "neutral"}`,
        `Bollinger Position: Price at ${bbPos}% of band width (RSI ${rsi}) — ${Number(bbPos) > 80 ? "overbought zone" : Number(bbPos) < 20 ? "oversold zone" : "mid-range"}`,
        `Ichimoku: ${ichStatus} cloud, ${t.ichimoku?.tkCross ?? "no TK cross"} — ${ichStatus === "above" ? "bullish cloud confirmation" : ichStatus === "below" ? "bearish cloud signal" : "within cloud = indecision"}`,
        `ADX: ${adxVal} (${adxTrend}) — ${Number(adxVal) > 25 ? "strong directional movement" : "weak trend, range-bound action likely"}`,
      ],
      marketSignalInterpretation: `Stochastic RSI K=${stochK} with CVD trend ${cvdTrend}. OBV is ${t.obv?.trend ?? "N/A"} with ${t.obv?.divergence ?? "no"} divergence. Volume profile shows ${t.volumeProfile ?? "N/A"} positioning. Confluence score: ${t.confluenceScore?.toFixed(0) ?? "N/A"}/100 across ${t.confluenceFactors?.length ?? 0} factors.`,
      informationAsymmetry: `Order book depth: ${t.orderBook ? (t.orderBook.imbalanceRatio1pct > 1 ? "bid-heavy (" + ((t.orderBook.imbalanceRatio1pct - 1) * 100).toFixed(0) + "% bid skew)" : "ask-heavy (" + ((1 - t.orderBook.imbalanceRatio1pct) * 100).toFixed(0) + "% ask skew)") : "balanced"}. ${t.liquidations?.nearestLongLiq || t.liquidations?.nearestShortLiq ? "Nearest liquidation cluster: " + (t.liquidations.magnetDirection === "down" && t.liquidations.nearestLongLiq ? "$" + t.liquidations.nearestLongLiq.toLocaleString() + " (long liquidations)" : t.liquidations.nearestShortLiq ? "$" + t.liquidations.nearestShortLiq.toLocaleString() + " (short liquidations)" : "balanced") : "No significant liquidation clusters detected"}. VWAP distance: ${t.vwapDistance != null ? (t.vwapDistance > 0 ? "+" : "") + (t.vwapDistance * 100).toFixed(2) + "% from VWAP" : "N/A"}.`,
      riskLandscape: [
        `Volatility: ${t.volatilityPct != null ? t.volatilityPct.toFixed(1) + "% 24h range" : "N/A"} — ${(t.volatilityPct ?? 0) > 5 ? "elevated risk, size positions accordingly" : "contained volatility"}`,
        `Support/Resistance: Key support at $${t.nearestSupport?.toLocaleString() ?? "N/A"}, resistance at $${t.nearestResistance?.toLocaleString() ?? "N/A"}`,
        `Risk/Reward: ${rr?.toFixed(2) ?? "N/A"} R:R — ${(rr ?? 0) > 2 ? "favorable asymmetry" : (rr ?? 0) > 1 ? "marginally positive" : "unfavorable, caution warranted"}`,
        `RSI Divergence: ${t.rsiDivergence?.type ?? "none"} — ${t.rsiDivergence?.type === "bullish" ? "hidden buying pressure" : t.rsiDivergence?.type === "bearish" ? "hidden selling pressure" : "price action aligns with momentum"}`,
      ],
      strategicInsight: `With ${t.confluenceFactors?.length ?? 0} confluence factors and ${t.verdict.signalAgreement ?? 0}% signal agreement, the quant engine identifies a ${verdict.confidence >= 70 ? "high" : verdict.confidence >= 50 ? "moderate" : "low"}-conviction ${verdict.direction} setup. Key levels to watch: Fibonacci 0.618 at $${goldenFib?.price?.toLocaleString() ?? "N/A"}, anchored VWAP at $${anchoredVwapVal?.toLocaleString() ?? "N/A"}.`,
      terminalNote: `[SIA] AI narration unavailable — this report was generated by the 24-signal quant engine fallback. All data points are computed directly from market data. Signal hash derived from ${t.symbol} at ${priceStr}.`
    };
  }

  return {
    verdict,
    eventBrief: "This event has emerged as a focal point for participants attempting to price complex, multi-factor dynamics under conditions of significant uncertainty.",
    globalContext: "Broad macroeconomic conditions and localized policy dynamics form the backdrop. Participants face elevated systemic ambiguity, limiting strong conviction in either direction.",
    structuralDrivers: [
      "Information Opacity: Key decision-makers operate behind closed doors, creating persistent uncertainty.",
      "Narrative Momentum: Public discourse has amplified certain scenarios beyond their structural probability.",
      "Timing Risk: The gap between current positioning and resolution creates exposure to exogenous shocks."
    ],
    marketSignalInterpretation: "Current pricing reflects a market balancing competing narratives rather than a settled consensus. Volume patterns suggest cautious positioning with limited aggressive conviction.",
    informationAsymmetry: "Public-facing narratives diverge from the procedural and institutional mechanics that will ultimately determine the outcome. This gap creates both risk and opportunity.",
    riskLandscape: [
      "Narrative Fracture: If the dominant public narrative breaks, rapid repricing follows.",
      "Structural Surprise: Institutional or procedural decisions could override market consensus.",
      "Duration Risk: Extended timelines may outlast participant capital and attention."
    ],
    strategicInsight: "Focus on procedural milestones and institutional signals rather than public sentiment. The resolution mechanics, not the narrative, will determine outcome.",
    terminalNote: "[SIA] Premium intelligence analysis. Verdict reflects structural balance, not speculative bias. Confidence levels below 60 indicate genuine uncertainty."
  };
}

export async function generatePremiumAnalysis(
  market: PremiumAnalysisInput,
  articles: PremiumNewsArticle[],
  ta?: TechnicalAnalysis | null,
  fundamental?: FundamentalVerdict | null,
  marketMappingNote?: string | null,
  options?: { timeoutMs?: number }
): Promise<PremiumAnalysisResult> {
  if (!config.openai.apiKey) {
    return fallbackPremiumAnalysis(ta, fundamental);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options?.timeoutMs ?? 30000);
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.openai.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: config.openai.model,
        messages: [{ role: "user", content: buildPremiumPrompt(market, articles, ta, fundamental, marketMappingNote) }],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "premium_analysis",
            strict: true,
            schema: premiumAnalysisSchema()
          }
        }
      }),
      signal: controller.signal
    });

    if (!response.ok) return fallbackPremiumAnalysis(ta, fundamental);

    const body = await response.json();
    const jsonText = body?.choices?.[0]?.message?.content;
    if (!jsonText) return fallbackPremiumAnalysis(ta, fundamental);

    try {
      const parsed = JSON.parse(jsonText) as PremiumAnalysisResult;
      return enforceComputedPremiumVerdict(parsed, ta, fundamental);
    } catch {
      return fallbackPremiumAnalysis(ta, fundamental);
    }
  } catch {
    return fallbackPremiumAnalysis(ta, fundamental);
  } finally {
    clearTimeout(timeout);
  }
}

export async function generateMarketAnalysis(
  market: AnalysisMarketInput
): Promise<MarketAnalysis> {
  if (!config.openai.apiKey) {
    return fallbackAnalysis(market);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAI_ANALYSIS_TIMEOUT_MS);
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.openai.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: config.openai.model,
        messages: [{ role: "user", content: buildPrompt(market) }],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "analyst_strategic_briefing",
            strict: true,
            schema: analysisSchema()
          }
        }
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      console.warn(
        `[smartmarket] OpenAI market analysis failed: ${response.status} ${errorText.slice(0, 300)}`
      );
      return fallbackAnalysis(market);
    }

    const body = await response.json();
    const jsonText = body?.choices?.[0]?.message?.content;
    if (!jsonText) {
      return fallbackAnalysis(market);
    }

    try {
      const parsed = JSON.parse(jsonText) as MarketAnalysis;
      
      // Calculate Deterministic Signal Hash (SIA-PoI Protocol)
      const hashContent = JSON.stringify({ 
        marketId: market.id, 
        summary: parsed.eventBrief
      });
      const integrityHash = createHash("sha256").update(hashContent).digest("hex");
      
      if (parsed.intelligenceDossier) {
        parsed.intelligenceDossier.rawSignalHash = integrityHash;
      }
      
      return parsed;
    } catch (error) {
      console.warn("[smartmarket] OpenAI market analysis returned invalid JSON.", error);
      return fallbackAnalysis(market);
    }
  } catch (err: any) {
    if (err.name === "AbortError") {
      console.warn("[smartmarket] OpenAI request timed out, using fallback.");
    }
    return fallbackAnalysis(market);
  } finally {
    clearTimeout(timeout);
  }
}
