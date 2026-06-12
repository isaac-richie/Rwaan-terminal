import { FastifyInstance } from "fastify";
import { z } from "zod";
import { getGamma } from "../services/polymarket.js";
import { buildCacheKey, getJsonCache, getJsonCacheEntry, setJsonCache } from "../services/cache.js";

const gammaQuerySchema = z.record(z.string()).default({});
const MARKET_CACHE_TTL_SECONDS = 60;
const EVENT_CACHE_TTL_SECONDS = 120;
const FEED_STALE_TTL_SECONDS = 15 * 60;
const FEED_PREWARM_INTERVAL_MS = 60_000;

// Union of every tag ID the web client requests across all categories.
// Keep in sync with `categoryFeedTagIds` + `FAST_ALL_TAG_IDS` in
// apps/web/lib/polymarket.ts — these are the tags a category switch fans out to.
const PREWARM_TAG_IDS = [
  // crypto
  "21", "235", "101611", "1312",
  // tech / AI
  "1401", "439", "537", "103303", "101604",
  // finance / macro
  "120", "600", "370", "102000", "101250", "101247", "833",
  // politics / legal
  "100344", "933", "1558", "1588", "757",
  // news
  "2", "144",
  // entertainment
  "596", "100", "53",
  // sports + world cup (519 = "world cup" futures)
  "1", "519",
  // africa (AFCON + soccer + world cup + Egypt PL)
  "102974", "102969", "100350", "102350", "102232", "104397",
  // geopolitics
  "100265", "1396", "101970", "366",
];

// CRITICAL: these params must byte-for-byte match what the web client sends for a
// category switch, because `buildCacheKey` hashes the full param set (limit included).
// See apps/web/lib/polymarket.ts fetchLimit: default category = 72, crypto = 120.
const CATEGORY_EVENT_LIMIT = "72";
const CRYPTO_EVENT_LIMIT = "120";
const SPORTS_EVENT_LIMIT = "120";
const CRYPTO_PREWARM_TAG_IDS = ["21", "235", "101611", "1312"];
const SPORTS_PREWARM_TAG_IDS = ["1"];
// 519 = "world cup" (futures), 102232 = "FIFA World Cup" (game-level match events)
const WORLDCUP_PREWARM_TAG_IDS = ["519", "102232"];
const WORLDCUP_EVENT_LIMIT = "120";
const FEED_PREWARM_QUERIES: Array<Record<string, string>> = [
  ...PREWARM_TAG_IDS.map((tagId) => ({
  active: "true", closed: "false", compact: "true", limit: CATEGORY_EVENT_LIMIT, offset: "0",
  order: "volume_24hr", ascending: "false", tag_id: tagId, related_tags: "true",
  })),
  ...CRYPTO_PREWARM_TAG_IDS.map((tagId) => ({
    active: "true", closed: "false", compact: "true", limit: CRYPTO_EVENT_LIMIT, offset: "0",
    order: "volume_24hr", ascending: "false", tag_id: tagId, related_tags: "true",
  })),
  ...WORLDCUP_PREWARM_TAG_IDS.map((tagId) => ({
    active: "true", closed: "false", compact: "true", limit: WORLDCUP_EVENT_LIMIT, offset: "0",
    order: "volume_24hr", ascending: "false", tag_id: tagId, related_tags: "true",
  })),
  ...SPORTS_PREWARM_TAG_IDS.map((tagId) => ({
    active: "true", closed: "false", compact: "true", limit: SPORTS_EVENT_LIMIT, offset: "0",
    order: "volume_24hr", ascending: "false", tag_id: tagId, related_tags: "true",
  })),
];

// The "all" feed loads through the Gamma markets index, not the events batch.
// Client uses limit=24 (display 12 × 2) at the default trending sort.
const ALL_FEED_MARKETS_QUERY: Record<string, string> = {
  active: "true", closed: "false", limit: "24", offset: "0",
  order: "volume_24hr", ascending: "false",
};

const inFlightRefreshes = new Map<string, Promise<unknown>>();

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
  return typeof value === "string" ? value.slice(0, 120) : undefined;
}

function compactTags(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  return value
    .map((tag) => {
      if (typeof tag === "string") return { label: tag };
      if (!tag || typeof tag !== "object") return null;
      const record = tag as UnknownRecord;
      const label = record.label ?? record.name ?? record.slug;
      if (typeof label !== "string" || !label) return null;
      return {
        ...(typeof record.id === "string" || typeof record.id === "number" ? { id: String(record.id) } : {}),
        label,
        ...(typeof record.slug === "string" && record.slug ? { slug: record.slug } : {}),
      };
    })
    .filter(Boolean);
}

function dropDuplicateIcon(record: UnknownRecord) {
  if (record.icon && record.image && record.icon === record.image) delete record.icon;
  return record;
}

function isOpenGammaMarket(raw: unknown) {
  if (!raw || typeof raw !== "object") return false;
  const market = raw as UnknownRecord;
  return market.active !== false && market.closed !== true;
}

function compactGammaMarket(raw: unknown) {
  const market = raw && typeof raw === "object" ? (raw as UnknownRecord) : {};
  return dropDuplicateIcon({
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
      "outcomes",
      "outcomePrices",
      "outcome_prices",
      "clobTokenIds",
      "clob_token_ids",
      "createdAt",
      "startDate",
    ]),
    description: compactDescription(market.description),
    tags: compactTags(market.tags),
  });
}

function compactGammaEvent(raw: unknown) {
  const event = raw && typeof raw === "object" ? (raw as UnknownRecord) : {};
  const markets = Array.isArray(event.markets)
    ? event.markets.filter(isOpenGammaMarket).map(compactGammaMarket)
    : [];
  return dropDuplicateIcon({
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
      "createdAt",
      "startDate",
    ]),
    tags: compactTags(event.tags),
    markets,
  });
}

function compactGammaEvents(raw: unknown) {
  return Array.isArray(raw) ? raw.map(compactGammaEvent) : raw;
}

function withoutInternalQuery(query: Record<string, string>) {
  const next = { ...query };
  delete next.compact;
  return next;
}

async function refreshCacheOnce<T>(
  cacheKey: string,
  load: () => Promise<T>,
  ttlSeconds: number,
  staleTtlSeconds = 0,
): Promise<T> {
  const existing = inFlightRefreshes.get(cacheKey) as Promise<T> | undefined;
  if (existing) return existing;

  const refresh = load()
    .then(async (value) => {
      await setJsonCache(cacheKey, value, ttlSeconds, { staleTtlSeconds });
      return value;
    })
    .finally(() => {
      inFlightRefreshes.delete(cacheKey);
    });

  inFlightRefreshes.set(cacheKey, refresh);
  return refresh;
}

async function getCachedOrRefresh<T>(
  cacheKey: string,
  load: () => Promise<T>,
  ttlSeconds: number,
  staleTtlSeconds = 0,
): Promise<T> {
  const cached = await getJsonCacheEntry<T>(cacheKey);
  if (cached?.state === "fresh") return cached.value;
  if (cached?.state === "stale") {
    void refreshCacheOnce(cacheKey, load, ttlSeconds, staleTtlSeconds).catch(() => undefined);
    return cached.value;
  }
  return refreshCacheOnce(cacheKey, load, ttlSeconds, staleTtlSeconds);
}

function prewarmGammaFeeds(app: FastifyInstance) {
  if (process.env.NODE_ENV === "test" || process.env.RAWLI_DISABLE_GAMMA_PREWARM === "true") return;

  const refresh = () => {
    // Per-tag event feeds (every category switch hits one of these cache keys)
    const eventRefreshes = FEED_PREWARM_QUERIES.map((query) => {
      const cacheKey = buildCacheKey("gamma:events", query);
      return refreshCacheOnce(
        cacheKey,
        async () => compactGammaEvents(await getGamma("/events", withoutInternalQuery(query))),
        EVENT_CACHE_TTL_SECONDS,
        FEED_STALE_TTL_SECONDS,
      );
    });

    // The default "all" feed loads through the Gamma markets index.
    const allFeedRefresh = refreshCacheOnce(
      buildCacheKey("gamma:markets", ALL_FEED_MARKETS_QUERY),
      () => getGamma("/markets", ALL_FEED_MARKETS_QUERY),
      MARKET_CACHE_TTL_SECONDS,
      FEED_STALE_TTL_SECONDS,
    );

    void Promise.allSettled([...eventRefreshes, allFeedRefresh]).then((results) => {
      const failed = results.filter((result) => result.status === "rejected").length;
      if (failed > 0) app.log.warn({ failed }, "gamma feed prewarm had failed requests");
    });
  };

  refresh();
  const interval = setInterval(refresh, FEED_PREWARM_INTERVAL_MS);
  interval.unref?.();
  app.addHook("onClose", async () => {
    clearInterval(interval);
  });
}

export async function gammaRoutes(app: FastifyInstance): Promise<void> {
  prewarmGammaFeeds(app);

  app.get("/gamma/markets", async (req) => {
    const query = gammaQuerySchema.parse(req.query ?? {});
    const cacheKey = buildCacheKey("gamma:markets", query);
    return getCachedOrRefresh(
      cacheKey,
      () => getGamma("/markets", query),
      MARKET_CACHE_TTL_SECONDS,
      FEED_STALE_TTL_SECONDS,
    );
  });

  app.get("/gamma/events", async (req) => {
    const query = gammaQuerySchema.parse(req.query ?? {});
    const cacheKey = buildCacheKey("gamma:events", query);
    return getCachedOrRefresh(
      cacheKey,
      async () => {
        const events = await getGamma("/events", withoutInternalQuery(query));
        return query.compact === "true" ? compactGammaEvents(events) : events;
      },
      EVENT_CACHE_TTL_SECONDS,
      FEED_STALE_TTL_SECONDS,
    );
  });

  // Batch endpoint: fetch multiple tag_ids in a single request, merge server-side.
  // Eliminates N parallel requests from the frontend per category switch.
  app.get("/gamma/events/batch", async (req) => {
    const query = gammaQuerySchema.parse(req.query ?? {});
    const tagIdsRaw = query.tag_ids ?? "";
    const tagIds = tagIdsRaw.split(",").map((s: string) => s.trim()).filter(Boolean);
    if (tagIds.length === 0) return [];

    // Build per-tag queries (reuse existing cache)
    const perTagResults = await Promise.allSettled(
      tagIds.map((tagId: string) => {
        const perTagQuery: Record<string, string> = { ...query, tag_id: tagId, related_tags: "true" };
        delete perTagQuery.tag_ids;
        const isCompact = perTagQuery.compact === "true";
        const cacheKey = buildCacheKey("gamma:events", perTagQuery);
        return getCachedOrRefresh(
          cacheKey,
          async () => {
            const events = await getGamma("/events", withoutInternalQuery(perTagQuery));
            return isCompact ? compactGammaEvents(events) : events;
          },
          EVENT_CACHE_TTL_SECONDS,
          FEED_STALE_TTL_SECONDS,
        );
      })
    );

    // Merge + dedupe events across all tags
    const mergedEvents = new Map<string, unknown>();
    for (const result of perTagResults) {
      if (result.status !== "fulfilled" || !Array.isArray(result.value)) continue;
      for (const event of result.value) {
        const e = event as Record<string, unknown>;
        const key = String(e.id ?? e.slug ?? e.title ?? "");
        if (key && !mergedEvents.has(key)) mergedEvents.set(key, event);
      }
    }

    return Array.from(mergedEvents.values());
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
