import { config } from "../config.js";
import { createHash } from "node:crypto";

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
      `- provide insight that feels worth paying for`,
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

function buildPremiumPrompt(market: PremiumAnalysisInput, articles: PremiumNewsArticle[]): string {
  const consensusStr = market.outcomes?.length
    ? market.outcomes.map(o => `${o.name}: ${o.price}%`).join(" / ")
    : "N/A";

  const newsSection = articles.length
    ? articles.map((a, i) => `--- Source ${i + 1}: ${a.title} ---\n${a.bodyText}`).join("\n\n")
    : "No live news available at this time.";

  return [
    `You are a senior intelligence analyst producing a premium market report.`,
    `You have been paid $1 for this analysis. Deliver maximum value.`,
    ``,
    `MARKET: ${market.question}`,
    `CATEGORY: ${market.category ?? "Events"}`,
    `CONSENSUS: ${consensusStr}`,
    `VOLUME: ${market.volume ?? "N/A"} | LIQUIDITY: ${market.liquidity ?? "N/A"}`,
    `CLOSES: ${market.endDate ?? "N/A"}`,
    ``,
    `LIVE INTELLIGENCE (sourced ${new Date().toISOString()}):`,
    newsSection,
    ``,
    `REQUIRED OUTPUT:`,
    `1. VERDICT: You MUST choose YES or NO. Include confidence 0-100 and a 2-3 sentence rationale explaining your directional call. Be decisive.`,
    `2. EVENT BRIEF: Why this event matters and what broader system it belongs to (3-4 sentences).`,
    `3. GLOBAL CONTEXT: Macro trends, geopolitical forces, and structural factors at play.`,
    `4. STRUCTURAL DRIVERS: 3-5 named forces driving the outcome. Each must be concrete and specific.`,
    `5. MARKET SIGNAL INTERPRETATION: What current pricing and volume reveal about conviction and positioning.`,
    `6. INFORMATION ASYMMETRY: What the public narrative misses. Where hidden or opaque factors exist.`,
    `7. RISK LANDSCAPE: 3-4 specific risks framed as uncertainties. Not generic.`,
    `8. STRATEGIC INSIGHT: How to think about this situation. What signals matter most going forward.`,
    `9. TERMINAL NOTE: Closing note reinforcing the analytical framework used.`,
    ``,
    `VERDICT RULES:`,
    `- Confidence 70-100: Strong directional evidence from news + structural factors`,
    `- Confidence 40-69: Leaning direction but significant uncertainty remains`,
    `- Confidence 0-39: Near coin-flip, verdict is marginal`,
    `- Base your verdict on the live news, market data, and structural analysis`,
    `- Be opinionated. The user paid for a clear signal, not hedging.`,
    ``,
    `STYLE: No fluff. No generic phrases. Every sentence must carry insight. Use precise, confident language.`
  ].join("\n");
}

function fallbackPremiumAnalysis(): PremiumAnalysisResult {
  return {
    verdict: {
      direction: "NO",
      confidence: 50,
      rationale: "Insufficient live data for a high-conviction directional call. The structural balance of forces does not strongly favor either outcome at this time."
    },
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
  articles: PremiumNewsArticle[]
): Promise<PremiumAnalysisResult> {
  if (!config.openai.apiKey) {
    return fallbackPremiumAnalysis();
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.openai.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: config.openai.model,
        messages: [{ role: "user", content: buildPremiumPrompt(market, articles) }],
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

    if (!response.ok) return fallbackPremiumAnalysis();

    const body = await response.json();
    const jsonText = body?.choices?.[0]?.message?.content;
    if (!jsonText) return fallbackPremiumAnalysis();

    try {
      return JSON.parse(jsonText) as PremiumAnalysisResult;
    } catch {
      return fallbackPremiumAnalysis();
    }
  } catch {
    return fallbackPremiumAnalysis();
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
