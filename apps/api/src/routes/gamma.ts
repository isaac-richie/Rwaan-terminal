import { FastifyInstance } from "fastify";
import { z } from "zod";
import { getGamma } from "../services/polymarket.js";
import { buildCacheKey, getJsonCache, setJsonCache } from "../services/cache.js";

const gammaQuerySchema = z.record(z.string()).default({});

export async function gammaRoutes(app: FastifyInstance): Promise<void> {
  app.get("/gamma/markets", async (req) => {
    const query = gammaQuerySchema.parse(req.query ?? {});
    const cacheKey = buildCacheKey("gamma:markets", query);
    const cached = await getJsonCache(cacheKey);
    if (cached) return cached;
    const markets = await getGamma("/markets", query);
    await setJsonCache(cacheKey, markets, 30);
    return markets;
  });

  app.get("/gamma/events", async (req) => {
    const query = gammaQuerySchema.parse(req.query ?? {});
    const cacheKey = buildCacheKey("gamma:events", query);
    const cached = await getJsonCache(cacheKey);
    if (cached) return cached;
    const events = await getGamma("/events", query);
    await setJsonCache(cacheKey, events, 30);
    return events;
  });

  app.get("/gamma/tags", async (req) => {
    const query = gammaQuerySchema.parse(req.query ?? {});
    const cacheKey = buildCacheKey("gamma:tags", query);
    const cached = await getJsonCache(cacheKey);
    if (cached) return cached;
    const tags = await getGamma("/tags", query);
    await setJsonCache(cacheKey, tags, 60 * 60);
    return tags;
  });
}
