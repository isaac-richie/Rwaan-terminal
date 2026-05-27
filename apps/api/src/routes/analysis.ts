import { FastifyInstance } from "fastify";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { generateMarketAnalysis, generatePremiumAnalysis } from "../services/openai.js";
import { paymentGate } from "../middleware/paymentGate.js";
import { fetchPremiumNews } from "../services/news.js";
import { buildPaymentRequirement } from "../services/payment.js";
import { detectCryptoSymbol, runTechnicalAnalysis } from "../services/ta-engine.js";

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

      // Fetch news and TA in parallel (TA only runs for crypto markets)
      const [newsArticles, taResult] = await Promise.all([
        fetchPremiumNews(market.question),
        cryptoSymbol
          ? runTechnicalAnalysis(cryptoSymbol).catch((err) => {
              console.warn(`[smartmarket] TA engine failed for ${cryptoSymbol}:`, err);
              return null;
            })
          : Promise.resolve(null),
      ]);

      const raw = await generatePremiumAnalysis(market, newsArticles, taResult);

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
            // EMA Ribbon
            ema: taResult.ema,
            // MACD
            macd: taResult.macd,
            // Bollinger
            bollinger: taResult.bollinger,
            // RSI suite
            rsi14: taResult.rsi14,
            rsiDivergence: taResult.rsiDivergence,
            multiTfRsi: taResult.multiTfRsi,
            // Volume
            obv: taResult.obv,
            volumeProfile: taResult.volumeProfile,
            // Levels
            nearestSupport: taResult.nearestSupport,
            nearestResistance: taResult.nearestResistance,
            fibLevels: taResult.fibLevels,
            // Context
            vwapDistance: taResult.vwapDistance,
            volatilityPct: taResult.volatilityPct,
            regime: taResult.regime,
            funding: taResult.funding,
            fearGreed: taResult.fearGreed,
            openInterest: taResult.openInterest,
            longShort: taResult.longShort,
            takerRatio: taResult.takerRatio,
            // Conviction
            confluenceScore: taResult.confluenceScore,
            confluenceFactors: taResult.confluenceFactors,
            // Deterministic verdict from quant engine
            computedVerdict: taResult.verdict,
            riskReward: taResult.riskReward,
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
