import { FastifyInstance } from "fastify";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { generateMarketAnalysis, generatePremiumAnalysis } from "../services/openai.js";
import { paymentGate } from "../middleware/paymentGate.js";
import { fetchPremiumNews } from "../services/news.js";
import { buildPaymentRequirement } from "../services/payment.js";
import { detectCryptoSymbol, runTechnicalAnalysis } from "../services/ta-engine.js";
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

      // Detect crypto asset from market question for TA enrichment
      const cryptoSymbol = detectCryptoSymbol(market.question);

      // Fetch news + TA/fundamental signals in parallel
      // - TA engine: crypto markets only
      // - Fundamental engine: non-crypto markets (runs after news fetch, needs articles)
      const [newsArticles, taResult] = await Promise.all([
        fetchPremiumNews(market.question, market.category),
        cryptoSymbol
          ? runTechnicalAnalysis(cryptoSymbol).catch((err) => {
              console.warn(`[smartmarket] TA engine failed for ${cryptoSymbol}:`, err);
              return null;
            })
          : Promise.resolve(null),
      ]);

      // Compute fundamental verdict for non-crypto markets using the fetched articles
      const fundamentalResult = !cryptoSymbol
        ? computeFundamentalVerdict(market, newsArticles)
        : null;

      const raw = await generatePremiumAnalysis(market, newsArticles, taResult, fundamentalResult);

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
