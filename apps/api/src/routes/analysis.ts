import { FastifyInstance } from "fastify";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { fallbackPremiumAnalysis, generateMarketAnalysis, generatePremiumAnalysis } from "../services/openai.js";
import { paymentGate } from "../middleware/paymentGate.js";
import { fetchPremiumNews } from "../services/news.js";
import { buildPaymentRequirement } from "../services/payment.js";
import { config } from "../config.js";
import {
  detectCryptoSymbol,
  runTechnicalAnalysis,
  classifyCryptoPriceQuestion,
  deriveMarketAwareVerdict,
} from "../services/ta-engine.js";
import { computeFundamentalVerdict } from "../services/fundamental-engine.js";
import { computeStockTechnicals, type StockTechnicals } from "../services/stock-ta.js";
import { logPrediction, scoreResolvedPredictions, getAccuracy } from "../services/predictionLog.js";

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

function isStockAnalysisMarket(marketId?: string | null): boolean {
  return String(marketId ?? "").toLowerCase().startsWith("stock:");
}

function shouldGatePremiumAnalysis(marketId?: string | null): boolean {
  return isStockAnalysisMarket(marketId)
    ? config.payment.stockAnalysisFeeEnabled
    : config.payment.analysisFeeEnabled;
}

function withFallbackTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  fallback: T,
  onTimeout?: () => void
): Promise<T> {
  return new Promise((resolve) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      onTimeout?.();
      resolve(fallback);
    }, timeoutMs);

    promise
      .then((value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(value);
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(fallback);
      });
  });
}

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
    const paymentRequirement = buildPaymentRequirement();

    if (config.payment.analysisFeeEnabled) {
      return {
        ok: true,
        free: false,
        testing: false,
        price: paymentRequirement,
        stock: {
          free: !config.payment.stockAnalysisFeeEnabled,
          testing: !config.payment.stockAnalysisFeeEnabled,
          price: config.payment.stockAnalysisFeeEnabled ? paymentRequirement : null,
        },
      };
    }

    return {
      ok: true,
      free: true,
      testing: true,
      price: null,
      stock: {
        free: !config.payment.stockAnalysisFeeEnabled,
        testing: !config.payment.stockAnalysisFeeEnabled,
        price: config.payment.stockAnalysisFeeEnabled ? paymentRequirement : null,
      },
      memo: "Premium intelligence reports are free during testing.",
    };
  });

  const premiumPaymentGate = paymentGate({
    extractMarketId: (req) => (req.body as any)?.market?.id ?? "",
  });

  app.post(
    "/analysis/premium",
    {
      preHandler: async (req, reply) => {
        const marketId = (req.body as any)?.market?.id ?? "";
        if (!shouldGatePremiumAnalysis(marketId)) return;
        return premiumPaymentGate(req, reply);
      },
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
      // Stock markets (id "stock:NVDA") get real price technicals from daily
      // OHLC data — crypto symbol detection must not run on stock questions
      // (tickers like SOL/COIN/HOOD collide with crypto names).
      const stockSymbol = isStockAnalysisMarket(market.id)
        ? market.id.slice("stock:".length).toUpperCase()
        : null;
      const cryptoSymbol = stockSymbol ? null : detectCryptoSymbol(market.question);
      const priceClassification = cryptoSymbol ? classifyCryptoPriceQuestion(market.question) : null;
      const useTA = Boolean(cryptoSymbol && priceClassification?.isPriceQuestion);

      // Fetch news + (conditionally) TA signals in parallel
      const [newsArticles, rawTaResult, stockTechnicals] = await Promise.all([
        withFallbackTimeout(
          fetchPremiumNews(market.question, market.category),
          9000,
          [],
          () => req.log.warn({ marketId: market.id }, "Premium news fetch timed out")
        ),
        useTA
          ? withFallbackTimeout(
              runTechnicalAnalysis(cryptoSymbol!),
              14000,
              null,
              () => req.log.warn({ marketId: market.id, cryptoSymbol }, "Premium TA fetch timed out")
            )
          : Promise.resolve(null),
        stockSymbol
          ? withFallbackTimeout(
              computeStockTechnicals(stockSymbol).catch(() => null) as Promise<StockTechnicals | null>,
              9000,
              null,
              () => req.log.warn({ marketId: market.id, stockSymbol }, "Stock TA fetch timed out")
            )
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

      // Fundamental verdict for everything the TA engine doesn't drive.
      // For stocks, real price technicals join the weighted vote so the verdict
      // is anchored to hard market data, not just news-keyword sentiment.
      const fundamentalResult = !taResult
        ? computeFundamentalVerdict(market, newsArticles, stockTechnicals?.signals ?? [])
        : null;

      const raw = await withFallbackTimeout(
        generatePremiumAnalysis(
          market,
          newsArticles,
          taResult,
          fundamentalResult,
          taMappingNote,
          { timeoutMs: 16000 }
        ),
        17000,
        fallbackPremiumAnalysis(taResult, fundamentalResult),
        () => req.log.warn({ marketId: market.id }, "Premium AI generation timed out")
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
        // Real price technicals for tokenized stocks (Yahoo daily OHLC)
        ...(stockTechnicals && {
          stockTechnicals: {
            symbol: stockTechnicals.symbol,
            price: stockTechnicals.price,
            sma50: stockTechnicals.sma50,
            sma200: stockTechnicals.sma200,
            rsi14: stockTechnicals.rsi14,
            macd: stockTechnicals.macd,
            ret1mPct: stockTechnicals.ret1mPct,
            ret3mPct: stockTechnicals.ret3mPct,
            realizedVolAnnualPct: stockTechnicals.realizedVolAnnualPct,
            high52w: stockTechnicals.high52w,
            low52w: stockTechnicals.low52w,
            pctFrom52wHigh: stockTechnicals.pctFrom52wHigh,
            summary: stockTechnicals.summary,
          },
        }),
      };

      // ── Log the prediction for calibration/backtesting (best-effort) ──
      {
        const engine = taResult ? "ta" : fundamentalResult ? "fundamental" : "llm";
        const dir: "YES" | "NO" = raw.verdict.direction;
        const conf = raw.verdict.confidence;
        const pYesFromVerdict = dir === "YES" ? conf / 100 : 1 - conf / 100;
        let blendedProb = pYesFromVerdict;
        let modelProb: number | null = null;
        let marketProb: number | null = marketImpliedYesProb;
        if (probabilityModel) {
          blendedProb = probabilityModel.blendedProbability;
          modelProb = probabilityModel.modelProbability;
          marketProb = probabilityModel.marketProbability;
        } else if (fundamentalResult) {
          const ip = fundamentalResult.impliedProbability;
          if (typeof ip === "number" && Number.isFinite(ip)) marketProb = ip > 1 ? ip / 100 : ip;
        }
        void logPrediction({
          signalHash,
          marketId: market.id,
          question: market.question,
          category: market.category ?? null,
          engine,
          direction: dir,
          modelProb,
          marketProb,
          blendedProb,
          confidence: conf,
          resolvesAt: market.endDate ?? null,
        });
      }

      return {
        ok: true,
        marketId: market.id,
        analysis,
      };
    }
  );

  // Calibration scoreboard — how accurate have past verdicts been once resolved.
  // Opportunistically scores any newly-resolved markets (throttled) before reporting.
  app.get("/analysis/accuracy", async () => {
    await scoreResolvedPredictions().catch(() => undefined);
    const stats = await getAccuracy();
    return { ok: true, ...stats };
  });
}
