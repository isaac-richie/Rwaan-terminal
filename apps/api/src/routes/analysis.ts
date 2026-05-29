import { FastifyInstance } from "fastify";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { generateMarketAnalysis, generatePremiumAnalysis } from "../services/openai.js";
import { paymentGate } from "../middleware/paymentGate.js";
import { fetchPremiumNews } from "../services/news.js";
import { buildPaymentRequirement } from "../services/payment.js";
import {
  detectCryptoSymbol,
  runTechnicalAnalysis,
  classifyCryptoPriceQuestion,
  deriveMarketAwareVerdict,
} from "../services/ta-engine.js";
import { computeFundamentalVerdict } from "../services/fundamental-engine.js";

const marketSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(3),
  category: z.string().optional(),
  description: z.string().optional(),
  volume: z.string().optional(),
  liquidity: z.string().optional(),
  endDate: z.string().optional(),
  outcomes: z.array(z.object({
    name: z.string(),
    price: z.number().min(0).max(100)
  })).optional()
});

const requestSchema = z.object({
  market: marketSchema
});

/**
 * Market-implied P(YES) from the consensus outcome price. Handles both percentage
 * (0-100) and fractional (0-1) encodings. Returns null for non-binary / unpriced markets.
 */
function marketImpliedYesProbability(market: z.infer<typeof marketSchema>): number | null {
  const outcomes = market.outcomes;
  if (!outcomes || outcomes.length === 0) return null;
  const yes = outcomes.find((o) => o.name?.toLowerCase().includes("yes"));
  const chosen = yes ?? (outcomes.length === 2 ? outcomes[0] : null);
  if (!chosen || !Number.isFinite(chosen.price)) return null;
  const frac = chosen.price > 1 ? chosen.price / 100 : chosen.price;
  return frac > 0 && frac < 1 ? Math.min(0.99, Math.max(0.01, frac)) : null;
}

export async function analysisRoutes(app: FastifyInstance): Promise<void> {
  app.get("/analysis/quote", async () => {
    return {
      ok: true,
      quoteId: randomUUID(),
      rail: "direct",
      memo: "Generate market intelligence analysis"
    };
  });

  app.post("/analysis/unlock", async (req, reply) => {
    const payload = requestSchema.safeParse(req.body ?? null);
    if (!payload.success) {
      reply.status(400);
      return { ok: false, error: "invalid_payload", issues: payload.error.issues };
    }

    const analysis = await generateMarketAnalysis(payload.data.market);
    return {
      ok: true,
      marketId: payload.data.market.id,
      analysis
    };
  });

  app.get("/analysis/premium/price", async () => {
    return { ok: true, price: buildPaymentRequirement() };
  });

  app.post(
    "/analysis/premium",
    {
      preHandler: paymentGate({
        extractMarketId: (req) => (req.body as any)?.market?.id ?? "",
      }),
    },
    async (req, reply) => {
      const payload = requestSchema.safeParse(req.body ?? null);
      if (!payload.success) {
        reply.status(400);
        return { ok: false, error: "invalid_payload", issues: payload.error.issues };
      }

      const { market } = payload.data;

      // Detect crypto asset + decide whether the question is actually about price.
      // TA only drives the verdict for crypto PRICE questions ("will X be above $Y?").
      // Non-price crypto questions (ETF approvals, hacks, listings) go to the
      // fundamental/news engine instead — price technicals are irrelevant there.
      const cryptoSymbol = detectCryptoSymbol(market.question);
      const priceClassification = cryptoSymbol ? classifyCryptoPriceQuestion(market.question) : null;
      const useTA = Boolean(cryptoSymbol && priceClassification?.isPriceQuestion);

      // Fetch news + (conditionally) TA signals in parallel
      const [newsArticles, rawTaResult] = await Promise.all([
        fetchPremiumNews(market.question, market.category),
        useTA
          ? runTechnicalAnalysis(cryptoSymbol!).catch((err) => {
              console.warn(`[smartmarket] TA engine failed for ${cryptoSymbol}:`, err);
              return null;
            })
          : Promise.resolve(null),
      ]);

      // Market-implied P(YES) from the consensus outcome price — used as the prior
      // our model blends against (the market is the hardest baseline to beat).
      const marketImpliedYesProb = marketImpliedYesProbability(market);

      // Map the asset-level TA read onto the actual market question so a bullish
      // asset doesn't wrongly resolve a "will it drop below $X" market as YES.
      let taResult = rawTaResult;
      let taMappingNote: string | null = null;
      let probabilityModel: {
        modelProbability: number;
        marketProbability: number | null;
        blendedProbability: number;
        edge: number | null;
      } | null = null;
      if (rawTaResult) {
        const mapped = deriveMarketAwareVerdict(rawTaResult, market.question, market.endDate, marketImpliedYesProb);
        if (mapped.taRelevant) {
          taResult = { ...rawTaResult, verdict: mapped.verdict };
          taMappingNote = mapped.mappingNote;
          probabilityModel = {
            modelProbability: mapped.modelProbability,
            marketProbability: mapped.marketProbability,
            blendedProbability: mapped.probability,
            edge: mapped.edge,
          };
        } else {
          // Crypto symbol present but the question isn't about price — drop TA so the
          // fundamental engine answers it instead.
          taResult = null;
        }
      }

      // Fundamental verdict for everything the TA engine doesn't drive
      const fundamentalResult = !taResult
        ? computeFundamentalVerdict(market, newsArticles)
        : null;

      const raw = await generatePremiumAnalysis(
        market,
        newsArticles,
        taResult,
        fundamentalResult,
        taMappingNote
      );

      const generatedAt = new Date().toISOString();
      const signalHash = createHash("sha256")
        .update(market.id + generatedAt + raw.verdict.direction)
        .digest("hex")
        .slice(0, 16);

      const analysis = {
        ...raw,
        newsSources: newsArticles.map((a) => ({
          title: a.title,
          url: a.url,
          summary: a.bodyText.slice(0, 200),
        })),
        generatedAt,
        signalHash,
        // Model vs market probability breakdown (crypto price markets only)
        ...(probabilityModel && { probabilityModel }),
        // Include full TA metadata when available (crypto markets only)
        ...(taResult && {
          technicalAnalysis: {
            symbol: taResult.symbol,
            currentPrice: taResult.currentPrice,
            structure: taResult.htf.structure,
            trendStrength: taResult.htf.trendStrength,
            bias: taResult.htf.bias,
            swingHigh: taResult.htf.swingHigh,
            swingLow: taResult.htf.swingLow,
            ema: taResult.ema,
            macd: taResult.macd,
            bollinger: taResult.bollinger,
            rsi14: taResult.rsi14,
            rsiDivergence: taResult.rsiDivergence,
            multiTfRsi: taResult.multiTfRsi,
            obv: taResult.obv,
            volumeProfile: taResult.volumeProfile,
            nearestSupport: taResult.nearestSupport,
            nearestResistance: taResult.nearestResistance,
            fibLevels: taResult.fibLevels,
            vwapDistance: taResult.vwapDistance,
            volatilityPct: taResult.volatilityPct,
            regime: taResult.regime,
            funding: taResult.funding,
            fearGreed: taResult.fearGreed,
            openInterest: taResult.openInterest,
            longShort: taResult.longShort,
            takerRatio: taResult.takerRatio,
            confluenceScore: taResult.confluenceScore,
            confluenceFactors: taResult.confluenceFactors,
            computedVerdict: taResult.verdict,
            riskReward: taResult.riskReward,
            // V3 indicators
            ichimoku: taResult.ichimoku,
            adx: taResult.adx,
            stochRsi: taResult.stochRsi,
            cvd: taResult.cvd,
            volumeProfileData: taResult.volumeProfileData,
            orderBook: taResult.orderBook,
            liquidations: taResult.liquidations,
            anchoredVwap: taResult.anchoredVwap,
          },
        }),
        // Include fundamental signal metadata when available (non-crypto markets only)
        ...(fundamentalResult && {
          fundamentalAnalysis: {
            direction: fundamentalResult.direction,
            confidence: fundamentalResult.confidence,
            yesScore: fundamentalResult.yesScore,
            noScore: fundamentalResult.noScore,
            netScore: fundamentalResult.netScore,
            signals: fundamentalResult.signals,
            verdictRationale: fundamentalResult.verdictRationale,
            impliedProbability: fundamentalResult.impliedProbability,
            priceEfficiency: fundamentalResult.priceEfficiency,
            daysToResolution: fundamentalResult.daysToResolution,
            category: fundamentalResult.category,
          },
        }),
      };

      return {
        ok: true,
        marketId: market.id,
        analysis,
      };
    }
  );
}
