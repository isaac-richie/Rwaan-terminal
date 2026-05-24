import { FastifyInstance } from "fastify";
import { z } from "zod";
import { clobAuth, clobCreateApiKey, getClobPublic, postClobPublic } from "../services/polymarket.js";
import { buildCacheKey, getJsonCache, setJsonCache } from "../services/cache.js";

const clobQuerySchema = z.record(z.string()).default({});

function extractAuthHeaders(headers: Record<string, string | string[] | undefined>) {
  const pick = (key: string) => {
    const value = headers[key];
    if (!value) return undefined;
    return Array.isArray(value) ? value[0] : value;
  };

  const polyAddress = pick("poly_address") ?? pick("POLY_ADDRESS");
  const polySignature = pick("poly_signature") ?? pick("POLY_SIGNATURE");
  const polyTimestamp = pick("poly_timestamp") ?? pick("POLY_TIMESTAMP");
  const polyNonce = pick("poly_nonce") ?? pick("POLY_NONCE");

  if (!polyAddress || !polySignature || !polyTimestamp || !polyNonce) {
    return null;
  }

  return {
    POLY_ADDRESS: polyAddress,
    POLY_SIGNATURE: polySignature,
    POLY_TIMESTAMP: polyTimestamp,
    POLY_NONCE: polyNonce
  };
}

const tokenIdsSchema = z.object({ token_ids: z.array(z.string()).min(1) });

export async function clobRoutes(app: FastifyInstance): Promise<void> {
  app.get("/clob/price", async (req) => {
    const query = clobQuerySchema.parse(req.query ?? {});
    return getClobPublic("/price", query);
  });

  app.get("/clob/book", async (req) => {
    const query = clobQuerySchema.parse(req.query ?? {});
    const cacheKey = buildCacheKey("clob:book", query);
    const cached = await getJsonCache(cacheKey);
    if (cached) return cached;
    const book = await getClobPublic("/book", query);
    await setJsonCache(cacheKey, book, 3);
    return book;
  });

  app.get("/clob/markets", async (req) => {
    const query = clobQuerySchema.parse(req.query ?? {});
    return getClobPublic("/markets", query);
  });

  app.get("/clob/prices-history", async (req) => {
    const query = clobQuerySchema.parse(req.query ?? {});
    try {
      return await getClobPublic("/prices-history", query);
    } catch (err) {
      req.log.warn({ err, query }, "CLOB price history unavailable; returning an empty series");
      return [];
    }
  });

  app.post("/clob/last-trades-prices", async (req, reply) => {
    const body = tokenIdsSchema.safeParse(req.body ?? null);
    if (!body.success) {
      reply.status(400);
      return { error: "invalid_body" };
    }
    return postClobPublic("/last-trades-prices", body.data);
  });

  app.get("/clob/auth/derive-api-key", async (req, reply) => {
    const headers = extractAuthHeaders(req.headers as Record<string, string | string[] | undefined>);
    if (!headers) {
      reply.status(400);
      return { error: "missing_auth_headers" };
    }
    return clobAuth("/auth/derive-api-key", headers);
  });

  app.post("/clob/auth/api-key", async (req, reply) => {
    const headers = extractAuthHeaders(req.headers as Record<string, string | string[] | undefined>);
    if (!headers) {
      reply.status(400);
      return { error: "missing_auth_headers" };
    }
    return clobCreateApiKey(headers);
  });
}
