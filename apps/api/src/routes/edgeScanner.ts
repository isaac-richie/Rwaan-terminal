import { FastifyInstance } from "fastify";
import { scanForEdges } from "../services/edgeScanner.js";
import { buildCacheKey, getJsonCacheEntry, setJsonCache } from "../services/cache.js";

const SCAN_CACHE_TTL_SECONDS = 90;
const SCAN_STALE_TTL_SECONDS = 5 * 60;

export async function edgeScannerRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /analysis/edges
   *
   * Scans all live Polymarket crypto price markets, runs the TA engine on each
   * underlying asset, and returns markets ranked by model-vs-market probability
   * divergence. A large |edge| flags a potential mispricing.
   *
   * Query params:
   *   min_edge  — minimum absolute edge to surface (default 0.05 = 5pt)
   *   limit     — max results (default 20)
   */
  app.get("/analysis/edges", async (req) => {
    const query = req.query as Record<string, string>;
    const minEdge = Number(query.min_edge) || 0.05;
    const limit = Math.min(50, Math.max(1, Number(query.limit) || 20));

    const cacheKey = buildCacheKey("edge-scan", { min_edge: String(minEdge), limit: String(limit) });
    const cached = await getJsonCacheEntry(cacheKey);
    if (cached?.state === "fresh") return cached.value;

    // If stale cache exists, return it and refresh in background
    if (cached?.state === "stale") {
      void scanForEdges({ minAbsEdge: minEdge, maxResults: limit })
        .then((result) => setJsonCache(cacheKey, result, SCAN_CACHE_TTL_SECONDS, { staleTtlSeconds: SCAN_STALE_TTL_SECONDS }))
        .catch(() => undefined);
      return cached.value;
    }

    const result = await scanForEdges({ minAbsEdge: minEdge, maxResults: limit });
    void setJsonCache(cacheKey, result, SCAN_CACHE_TTL_SECONDS, { staleTtlSeconds: SCAN_STALE_TTL_SECONDS });
    return result;
  });
}
