import { FastifyInstance } from "fastify";
import { z } from "zod";
import { getGamma } from "../services/polymarket.js";
import { buildCacheKey, getJsonCache, getJsonCacheEntry, setJsonCache } from "../services/cache.js";

const gammaQuerySchema = z.record(z.string()).default({});
// Gamma is high-latency from the VPS region, so keep it on its own generous
// cache cadence: users get fast feed data while live books/quotes stay separate.
const MARKET_CACHE_TTL_SECONDS = 300;  // 5 min fresh
const EVENT_CACHE_TTL_SECONDS  = 300;  // 5 min fresh
const FEED_STALE_TTL_SECONDS   = 6 * 60 * 60; // 6 h stale-while-revalidate
const FEED_PREWARM_INTERVAL_MS = 120_000; // refreshed well before the 5-min TTL

// Browser / CDN cache headers for gamma feed responses.
// max-age lets browsers avoid repeated same-page pulls; stale-while-revalidate
// lets CDN/browser edges serve immediately while the API refreshes in the back.
const FEED_CACHE_CONTROL = "public, max-age=90, stale-while-revalidate=21600";

// Union of every tag ID the web client requests across all categories.
// Keep in sync with `categoryFeedTagIds` + `FAST_ALL_TAG_IDS` in
// apps/web/lib/polymarket.ts — these are the tags a category switch fans out to.
const PREWARM_TAG_IDS = [
  // crypto
  "21", "235", "101611", "1312",
  // macro
  "120", "370", "102000", "101250", "101247", "833",
  // IPOs
  "600",
  // world: news + politics + legal + geopolitics
  "2", "144",
  "100344", "933", "1558", "1588", "757",
  "100265", "1396", "101970", "366",
  // sports
  "1",
  // entertainment
  "596", "100", "53",
  // africa: AFCON/Egypt PL plus broad sports tags filtered client-side by African identity
  "102974", "102969", "104397", "100350", "102350", "102232",
];

// CRITICAL: these params must byte-for-byte match what the web client sends for a
// category switch, because `buildCacheKey` hashes the full param set (limit included).
// The default category feed uses limit=96; crypto uses a deeper limit=240 so
// SOL/BNB/XRP/DOGE/altcoin markets are not crowded out by BTC/ETH.
const CATEGORY_EVENT_LIMIT = "96";
const CRYPTO_EVENT_LIMIT = "240";
const CRYPTO_PREWARM_TAG_IDS = ["21", "235", "101611", "1312"];
const FEED_PREWARM_QUERIES: Array<Record<string, string>> = [
  ...PREWARM_TAG_IDS.map((tagId) => ({
  active: "true", closed: "false", compact: "true", limit: CATEGORY_EVENT_LIMIT, offset: "0",
  order: "volume_24hr", ascending: "false", tag_id: tagId, related_tags: "true",
  })),
  ...CRYPTO_PREWARM_TAG_IDS.map((tagId) => ({
    active: "true", closed: "false", compact: "true", limit: CRYPTO_EVENT_LIMIT, offset: "0",
    order: "volume_24hr", ascending: "false", tag_id: tagId, related_tags: "true",
  })),
];

// The "all" feed loads through the Gamma markets index, not the events batch.
// Client uses limit=24 (display 12 × 2) at the default trending sort.
const ALL_FEED_MARKETS_QUERY: Record<string, string> = {
  active: "true", closed: "false", limit: "24", offset: "0",
  order: "volume_24hr", ascending: "false",
};
const COMMON_MARKETS_PREWARM_QUERIES: Array<Record<string, string>> = [
  ALL_FEED_MARKETS_QUERY,
  // The production sitrep and lightweight health probes use this exact query.
  // Keeping it warm avoids a misleading 8s "Gamma is slow" signal.
  { limit: "1" },
];

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
      return typeof label === "string" && label ? { label } : null;
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
      await setJsonCache(cacheKey, value, ttlSeconds, {
        staleTtlSeconds,
        persistStaleToRedis: cacheKey.startsWith("gamma:"),
      });
      return value;
    })
    .finally(() => {
      inFlightRefreshes.delete(cacheKey);
    });

  inFlightRefreshes.set(cacheKey, refresh);
  return refresh;
}

// Hard timeout for Polymarket upstream fetches — if Polymarket takes >3s,
// serve stale immediately rather than blocking the user for 5-7s.
const UPSTREAM_TIMEOUT_MS = 3000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

async function getCachedOrRefresh<T>(
  cacheKey: string,
  load: () => Promise<T>,
  ttlSeconds: number,
  staleTtlSeconds = 0,
): Promise<T> {
  const cached = await getJsonCacheEntry<T>(cacheKey, { includeRedisStale: cacheKey.startsWith("gamma:") });
  if (cached?.state === "fresh") return cached.value;
  if (cached?.state === "stale") {
    void refreshCacheOnce(cacheKey, load, ttlSeconds, staleTtlSeconds).catch(() => undefined);
    return cached.value;
  }

  // Cold cache — try fetch with timeout; if Polymarket is slow, serve stale anyway
  try {
    return await withTimeout(
      refreshCacheOnce(cacheKey, load, ttlSeconds, staleTtlSeconds),
      UPSTREAM_TIMEOUT_MS,
      cacheKey,
    );
  } catch (err) {
    // Timeout or fetch error — check if we have anything stale at all
    const staleEntry = await getJsonCacheEntry<T>(cacheKey, { includeRedisStale: cacheKey.startsWith("gamma:") }).catch(() => null);
    if (staleEntry?.value) return staleEntry.value;
    throw err;
  }
}

function prewarmGammaFeeds(app: FastifyInstance) {
  if (process.env.NODE_ENV === "test" || process.env.RAWLI_DISABLE_GAMMA_PREWARM === "true") return;

  const refresh = () => {
    // Per-tag event feeds — use getCachedOrRefresh so we only hit upstream
    // when the entry is actually stale, not on every prewarm tick.
    const eventRefreshes = FEED_PREWARM_QUERIES.map((query) => {
      const cacheKey = buildCacheKey("gamma:events", query);
      return getCachedOrRefresh(
        cacheKey,
        async () => compactGammaEvents(await getGamma("/events", withoutInternalQuery(query))),
        EVENT_CACHE_TTL_SECONDS,
        FEED_STALE_TTL_SECONDS,
      );
    });

    // The default "all" feed and lightweight probes load through the Gamma
    // markets index. Prewarm these separately from event tags.
    const marketRefreshes = COMMON_MARKETS_PREWARM_QUERIES.map((query) =>
      getCachedOrRefresh(
        buildCacheKey("gamma:markets", query),
        () => getGamma("/markets", query),
        MARKET_CACHE_TTL_SECONDS,
        FEED_STALE_TTL_SECONDS,
      )
    );

    void Promise.allSettled([...eventRefreshes, ...marketRefreshes]).then((results) => {
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

  app.get("/gamma/markets", async (req, reply) => {
    reply.header("Cache-Control", FEED_CACHE_CONTROL);
    const query = gammaQuerySchema.parse(req.query ?? {});
    const cacheKey = buildCacheKey("gamma:markets", query);
    return getCachedOrRefresh(
      cacheKey,
      () => getGamma("/markets", query),
      MARKET_CACHE_TTL_SECONDS,
      FEED_STALE_TTL_SECONDS,
    );
  });

  app.get("/gamma/events", async (req, reply) => {
    reply.header("Cache-Control", FEED_CACHE_CONTROL);
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
  app.get("/gamma/events/batch", async (req, reply) => {
    reply.header("Cache-Control", FEED_CACHE_CONTROL);
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

  app.get("/gamma/tags", async (req, reply) => {
    reply.header("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
    const query = gammaQuerySchema.parse(req.query ?? {});
    const cacheKey = buildCacheKey("gamma:tags", query);
    const cached = await getJsonCache(cacheKey);
    if (cached) return cached;
    const tags = await getGamma("/tags", query);
    await setJsonCache(cacheKey, tags, 60 * 60);
    return tags;
  });
}
