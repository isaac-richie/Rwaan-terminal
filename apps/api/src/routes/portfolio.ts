import { FastifyInstance } from "fastify";
import { z } from "zod";
import { getData } from "../services/polymarket.js";

const paramsSchema = z.object({
  address: z.string().min(1)
});

const querySchema = z.object({
  limit: z.string().optional()
});

const PORTFOLIO_UPSTREAM_TIMEOUT_MS = 7_000;

type PortfolioSourceKey = "positions" | "closedPositions" | "value" | "trades";

type PortfolioWarning = {
  source: PortfolioSourceKey;
  error: string;
};

function errorCode(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  if (raw.includes("timeout")) return "upstream_timeout";
  const status = raw.match(/\bRequest failed:\s*(\d{3})\b/)?.[1];
  return status ? `upstream_${status}` : "upstream_unavailable";
}

async function withTimeout<T>(promise: Promise<T>, source: PortfolioSourceKey): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`${source}_timeout`)), PORTFOLIO_UPSTREAM_TIMEOUT_MS);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function portfolioRoutes(app: FastifyInstance): Promise<void> {
  app.get("/portfolio/:address", async (req, reply) => {
    const params = paramsSchema.safeParse(req.params ?? {});
    if (!params.success) {
      reply.status(400);
      return { error: "invalid_address" };
    }
    const query = querySchema.parse(req.query ?? {});
    const limit = query.limit ? Number(query.limit) : 50;

    const sources: Array<{
      key: PortfolioSourceKey;
      fallback: unknown;
      request: Promise<unknown>;
    }> = [
      { key: "positions", fallback: [], request: getData("/positions", { user: params.data.address }) },
      { key: "closedPositions", fallback: [], request: getData("/closed-positions", { user: params.data.address }) },
      { key: "value", fallback: [{ user: params.data.address, value: 0 }], request: getData("/value", { user: params.data.address }) },
      { key: "trades", fallback: [], request: getData("/trades", { user: params.data.address, limit }) },
    ];

    const entries = await Promise.all(
      sources.map(async (source) => {
        try {
          return {
            key: source.key,
            value: await withTimeout(source.request, source.key),
            warning: null,
          };
        } catch (err) {
          const warning: PortfolioWarning = { source: source.key, error: errorCode(err) };
          req.log.warn({ err, source: source.key, address: params.data.address }, "Portfolio upstream source unavailable");
          return {
            key: source.key,
            value: source.fallback,
            warning,
          };
        }
      })
    );

    const payload = Object.fromEntries(entries.map((entry) => [entry.key, entry.value])) as Record<PortfolioSourceKey, unknown>;
    const warnings = entries.map((entry) => entry.warning).filter((warning): warning is PortfolioWarning => Boolean(warning));

    return {
      address: params.data.address,
      positions: payload.positions,
      closedPositions: payload.closedPositions,
      value: payload.value,
      trades: payload.trades,
      ...(warnings.length ? { partial: true, warnings } : {})
    };
  });
}
