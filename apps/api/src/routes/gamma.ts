import { FastifyInstance } from "fastify";
import { z } from "zod";
import { getGamma } from "../services/polymarket.js";
import { buildCacheKey, getJsonCache, setJsonCache } from "../services/cache.js";

const gammaQuerySchema = z.record(z.string()).default({});

type UnknownRecord = Record<string, unknown>;

function pickFields(source: UnknownRecord, keys: string[]) {
  const out: UnknownRecord = {};
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null && value !== "") out[key] = value;
  }
  return out;
}

function compactDescription(value: unknown) {
  return typeof value === "string" ? value.slice(0, 240) : undefined;
}

function compactGammaMarket(raw: unknown) {
  const market = raw && typeof raw === "object" ? (raw as UnknownRecord) : {};
  return {
    ...pickFields(market, [
      "id",
      "question",
      "image",
      "icon",
      "category",
      "volume",
      "volume24hr",
      "volume_24hr",
      "liquidity",
      "endDate",
      "end_date_iso",
      "closed",
      "active",
      "new",
      "featured",
      "slug",
      "conditionId",
      "tokens",
      "tags",
      "outcomes",
      "outcomePrices",
      "outcome_prices",
      "clobTokenIds",
      "clob_token_ids",
      "createdAt",
      "startDate",
    ]),
    description: compactDescription(market.description),
  };
}

function compactGammaEvent(raw: unknown) {
  const event = raw && typeof raw === "object" ? (raw as UnknownRecord) : {};
  const markets = Array.isArray(event.markets) ? event.markets.map(compactGammaMarket) : [];
  return {
    ...pickFields(event, [
      "id",
      "title",
      "image",
      "icon",
      "category",
      "volume",
      "volume24hr",
      "volume_24hr",
      "liquidity",
      "endDate",
      "endDateIso",
      "active",
      "closed",
      "new",
      "featured",
      "slug",
      "tags",
      "createdAt",
      "startDate",
    ]),
    markets,
  };
}

function compactGammaEvents(raw: unknown) {
  return Array.isArray(raw) ? raw.map(compactGammaEvent) : raw;
}

function withoutInternalQuery(query: Record<string, string>) {
  const next = { ...query };
  delete next.compact;
  return next;
}

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
    const events = await getGamma("/events", withoutInternalQuery(query));
    const response = query.compact === "true" ? compactGammaEvents(events) : events;
    await setJsonCache(cacheKey, response, 120);
    return response;
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
