import { FastifyInstance } from "fastify";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { generateMarketAnalysis, generatePremiumAnalysis } from "../services/openai.js";
import { paymentGate } from "../middleware/paymentGate.js";
import { fetchPremiumNews } from "../services/news.js";
import { buildPaymentRequirement } from "../services/payment.js";

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

      const newsArticles = await fetchPremiumNews(market.question);

      const raw = await generatePremiumAnalysis(market, newsArticles);

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
      };

      return {
        ok: true,
        marketId: market.id,
        analysis,
      };
    }
  );
}
