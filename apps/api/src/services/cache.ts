import { Redis } from "ioredis";

const REDIS_URL = process.env.REDIS_URL?.trim() || "";

type MemoryCacheEntry = {
  value: string;
  expiresAt: number;
};

let redisClient: Redis | null = null;
const memoryCache = new Map<string, MemoryCacheEntry>();

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

export const getJsonCache = async <T>(key: string): Promise<T | null> => {
  const memoryEntry = memoryCache.get(key);
  if (memoryEntry) {
    if (memoryEntry.expiresAt > Date.now()) {
      return JSON.parse(memoryEntry.value) as T;
    }
    memoryCache.delete(key);
  }

  try {
    const client = getClient();
    if (!client) return null;
    const cached = await client.get(key);
    if (!cached) return null;
    memoryCache.set(key, { value: cached, expiresAt: Date.now() + 5_000 });
    return JSON.parse(cached) as T;
  } catch {
    return null;
  }
};

export const setJsonCache = async (key: string, value: unknown, ttlSeconds: number): Promise<void> => {
  const serialized = JSON.stringify(value);
  memoryCache.set(key, {
    value: serialized,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });

  try {
    const client = getClient();
    if (!client) return;
    await client.set(key, serialized, "EX", ttlSeconds);
  } catch {
    // ignore cache failures
  }
};
