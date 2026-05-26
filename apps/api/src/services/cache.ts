import { Redis } from "ioredis";

const REDIS_URL = process.env.REDIS_URL?.trim() || "";

type MemoryCacheEntry = {
  value: string;
  expiresAt: number;
  staleUntil: number;
};

let redisClient: Redis | null = null;
const memoryCache = new Map<string, MemoryCacheEntry>();

export type JsonCacheHit<T> = {
  value: T;
  state: "fresh" | "stale";
};

const getClient = () => {
  if (!REDIS_URL) return null;
  if (!redisClient) {
    redisClient = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 1,
      enableReadyCheck: true
    });
    redisClient.on("error", () => {
      // swallow errors to keep API responsive
    });
  }
  return redisClient;
};

export const buildCacheKey = (prefix: string, query: Record<string, string | number | boolean | undefined> = {}) => {
  const params = new URLSearchParams();
  Object.entries(query)
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([key, value]) => {
      if (value === undefined) return;
      params.set(key, String(value));
    });
  const suffix = params.toString();
  return suffix ? `${prefix}?${suffix}` : prefix;
};

export const getJsonCacheEntry = async <T>(key: string): Promise<JsonCacheHit<T> | null> => {
  const memoryEntry = memoryCache.get(key);
  if (memoryEntry) {
    const now = Date.now();
    if (memoryEntry.expiresAt > now) {
      return { value: JSON.parse(memoryEntry.value) as T, state: "fresh" };
    }
    if (memoryEntry.staleUntil > now) {
      return { value: JSON.parse(memoryEntry.value) as T, state: "stale" };
    }
    memoryCache.delete(key);
  }

  try {
    const client = getClient();
    if (!client) return null;
    const cached = await client.get(key);
    if (!cached) return null;
    const now = Date.now();
    memoryCache.set(key, { value: cached, expiresAt: now + 5_000, staleUntil: now + 5_000 });
    return { value: JSON.parse(cached) as T, state: "fresh" };
  } catch {
    return null;
  }
};

export const getJsonCache = async <T>(key: string): Promise<T | null> => {
  const hit = await getJsonCacheEntry<T>(key);
  return hit?.state === "fresh" ? hit.value : null;
};

export const setJsonCache = async (
  key: string,
  value: unknown,
  ttlSeconds: number,
  options: { staleTtlSeconds?: number } = {},
): Promise<void> => {
  const serialized = JSON.stringify(value);
  const now = Date.now();
  const staleTtlSeconds = options.staleTtlSeconds ?? 0;
  memoryCache.set(key, {
    value: serialized,
    expiresAt: now + ttlSeconds * 1000,
    staleUntil: now + (ttlSeconds + staleTtlSeconds) * 1000,
  });

  try {
    const client = getClient();
    if (!client) return;
    await client.set(key, serialized, "EX", ttlSeconds);
  } catch {
    // ignore cache failures
  }
};
