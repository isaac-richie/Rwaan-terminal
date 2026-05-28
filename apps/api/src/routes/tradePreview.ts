import { FastifyInstance } from "fastify";
import { z } from "zod";
import type { PlatformFee, TradeInsight } from "@smartmarket/types";
import { config } from "../config.js";
import { getClobPublic, getGamma } from "../services/polymarket.js";
import { generateTradeInsight } from "../services/openai.js";
import {
  buildBuyPreview,
  buildSellPreview,
  parseBookLevels,
  parseBoolean,
  parseNumber,
  parseStringArray,
  roundMoney
} from "../services/tradePreview.js";

const evmAddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);

const previewSchema = z.object({
  marketId: z.string().min(1),
  tokenId: z.string().min(1),
  outcome: z.string().min(1),
  side: z.enum(["BUY", "SELL"]),
  amountUsd: z.number().positive(),
  tradingWalletAddress: evmAddressSchema.optional()
});

type UnknownRecord = Record<string, unknown>;

function matchingMarket(raw: unknown, matches?: (market: UnknownRecord) => boolean): UnknownRecord | null {
  if (Array.isArray(raw)) {
    const found = matches
      ? raw.find((item) => item && typeof item === "object" && matches(item as UnknownRecord))
      : raw[0];
    return found && typeof found === "object" ? (found as UnknownRecord) : null;
  }
  if (!raw || typeof raw !== "object") return null;
  const market = raw as UnknownRecord;
  return !matches || matches(market) ? market : null;
}

function marketTokenIds(market: UnknownRecord): string[] {
  return parseStringArray(market.clobTokenIds ?? market.clob_token_ids);
}

function marketIdentifierMatches(market: UnknownRecord, identifier: string) {
  const normalized = identifier.trim().toLowerCase();
  return (
    String(market.id ?? "").toLowerCase() === normalized ||
    String(market.slug ?? "").toLowerCase() === normalized ||
    String(market.conditionId ?? market.condition_id ?? "").toLowerCase() === normalized ||
    marketTokenIds(market).some((tokenId) => tokenId.toLowerCase() === normalized)
  );
}

async function lookupGammaMarket(
  query: Record<string, string>,
  matches?: (market: UnknownRecord) => boolean
): Promise<UnknownRecord | null> {
  return matchingMarket(await getGamma("/markets", query), matches);
}

async function resolvePreviewMarket(marketId: string, tokenId: string): Promise<UnknownRecord | null> {
  const normalizedMarketId = decodeURIComponent(marketId).trim();
  const normalizedTokenId = tokenId.trim();
  const attempts: Array<() => Promise<UnknownRecord | null>> = [];

  if (normalizedTokenId) {
    attempts.push(() =>
      lookupGammaMarket({ clob_token_ids: normalizedTokenId }, (market) => marketTokenIds(market).includes(normalizedTokenId))
    );
  }

  if (/^\d+$/.test(normalizedMarketId)) {
    const tokenAttempts = [
      () => lookupGammaMarket({ clob_token_ids: normalizedMarketId }, (market) => marketTokenIds(market).includes(normalizedMarketId)),
      () => lookupGammaMarket({ token_id: normalizedMarketId }, (market) => marketTokenIds(market).includes(normalizedMarketId)),
    ];
    const idAttempt = () => lookupGammaMarket({ id: normalizedMarketId }, (market) => String(market.id) === normalizedMarketId);
    attempts.push(...(normalizedMarketId.length > 18 ? [...tokenAttempts, idAttempt] : [idAttempt, ...tokenAttempts]));
  } else if (normalizedMarketId) {
    attempts.push(
      () => lookupGammaMarket({ slug: normalizedMarketId }, (market) => marketIdentifierMatches(market, normalizedMarketId)),
      () => lookupGammaMarket({ condition_id: normalizedMarketId }, (market) => marketIdentifierMatches(market, normalizedMarketId)),
      () => lookupGammaMarket({ conditionId: normalizedMarketId }, (market) => marketIdentifierMatches(market, normalizedMarketId))
    );
  }

  let lastError: unknown = null;
  let sawResponse = false;
  for (const attempt of attempts) {
    try {
      const market = await attempt();
      sawResponse = true;
      if (market?.id) return market;
    } catch (err) {
      lastError = err;
    }
  }

  if (lastError && !sawResponse) throw lastError;
  return null;
}

function isMarketClosed(market: UnknownRecord): boolean {
  return market.closed === true || market.active === false;
}

function isMissingOrderbookError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? "");
  return /Request failed:\s*404/i.test(message) || /No orderbook/i.test(message);
}

export async function tradePreviewRoutes(app: FastifyInstance): Promise<void> {
  app.post("/trade/preview", async (req, reply) => {
    const parsed = previewSchema.safeParse(req.body ?? null);
    if (!parsed.success) {
      reply.status(400);
      return { ok: false, error: "invalid_preview_payload", issues: parsed.error.issues };
    }

    const { marketId, tokenId, outcome, side, amountUsd, tradingWalletAddress } = parsed.data;

    let market: UnknownRecord | null = null;
    try {
      market = await resolvePreviewMarket(marketId, tokenId);
    } catch (err) {
      req.log.error({ err, marketId, tokenId }, "Unable to load Gamma market for trade preview");
      reply.status(502);
      return { ok: false, error: "market_lookup_failed" };
    }

    if (market && isMarketClosed(market)) {
      reply.status(409);
      return { ok: false, error: "market_closed" };
    }

    const tokenIds = market ? marketTokenIds(market) : [tokenId];
    if (tokenIds.length > 0 && !tokenIds.includes(tokenId)) {
      reply.status(400);
      return { ok: false, error: "token_not_in_market", tokenIds };
    }

    const outcomes = market ? parseStringArray(market.outcomes ?? market.clobTokenIds) : [outcome];
    const marketQuestion = market ? String(market.question ?? "") : "";
    const marketCategory = market ? String(market.category ?? "") : "";
    const marketVolume = market ? String(market.volume_24hr ?? market.volume ?? "") : "";
    const marketOutcomePrices = market ? parseStringArray(market.outcomePrices) : [];

    // Fetch book with a single retry (Polymarket CLOB can be flaky)
    const fetchBookWithRetry = async () => {
      try {
        return await getClobPublic("/book", { token_id: tokenId });
      } catch (firstErr) {
        req.log.warn({ err: firstErr, tokenId }, "CLOB book first attempt failed, retrying...");
        await new Promise((r) => setTimeout(r, 500));
        return getClobPublic("/book", { token_id: tokenId });
      }
    };

    const [bookResult, insightResult] = await Promise.allSettled([
      fetchBookWithRetry(),
      generateTradeInsight({
        marketQuestion,
        category: marketCategory,
        side,
        avgPrice: null,
        amountUsd,
        bestAsk: null,
        volume: marketVolume,
        outcomes: marketOutcomePrices.length >= 2
          ? [
              { name: "Yes", price: Number(marketOutcomePrices[0]) * 100 || 0 },
              { name: "No", price: Number(marketOutcomePrices[1]) * 100 || 0 }
            ]
          : undefined
      })
    ]);

    if (bookResult.status === "rejected") {
      if (isMissingOrderbookError(bookResult.reason)) {
        req.log.warn({ err: bookResult.reason, marketId, tokenId }, "CLOB book is unavailable for trade preview");
        reply.status(409);
        return {
          ok: false,
          error: "orderbook_unavailable",
          message: "This market does not have an active order book. It may be closed, resolved, or waiting for settlement."
        };
      }
      req.log.error({ err: bookResult.reason, tokenId }, "Unable to load CLOB book for trade preview (after retry)");
      reply.status(502);
      return { ok: false, error: "orderbook_lookup_failed" };
    }

    const rawBook = bookResult.value;
    const book: UnknownRecord = rawBook && typeof rawBook === "object" ? (rawBook as UnknownRecord) : {};

    const previewOpts = {
      minOrderSize: parseNumber(book.min_order_size),
      tickSize: parseNumber(book.tick_size),
      negRisk: parseBoolean(book.neg_risk)
    };

    let preview;
    if (side === "SELL") {
      const bids = parseBookLevels(book, "bids");
      preview = buildSellPreview({
        amountShares: amountUsd,
        bids,
        ...previewOpts
      });
    } else {
      const asks = parseBookLevels(book, "asks");
      preview = buildBuyPreview({
        amountUsd,
        asks,
        ...previewOpts
      });
    }

    let platformFee: PlatformFee | undefined;
    if (config.fees.enabled && preview.filledAmountUsd > 0) {
      const feeAmount = roundMoney(preview.filledAmountUsd * (config.fees.platformFeeBps / 10000));
      platformFee = {
        bps: config.fees.platformFeeBps,
        amount: feeAmount,
        label: `Platform fee (${(config.fees.platformFeeBps / 100).toFixed(1)}%)`
      };
    }

    const tradeInsight: TradeInsight | undefined =
      insightResult.status === "fulfilled" && insightResult.value
        ? insightResult.value
        : undefined;

    return {
      ok: true,
      marketId,
      tokenId,
      outcome,
      side,
      amountUsd,
      tradingWalletAddress,
      ...preview,
      ...(platformFee ? { platformFee } : {}),
      ...(tradeInsight ? { tradeInsight } : {})
    };
  });
}
