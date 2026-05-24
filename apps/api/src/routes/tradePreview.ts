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

function firstMarket(raw: unknown): UnknownRecord | null {
  if (Array.isArray(raw)) {
    const first = raw[0];
    return first && typeof first === "object" ? (first as UnknownRecord) : null;
  }
  return raw && typeof raw === "object" ? (raw as UnknownRecord) : null;
}

function marketTokenIds(market: UnknownRecord): string[] {
  return parseStringArray(market.clobTokenIds ?? market.clob_token_ids);
}

function isMarketClosed(market: UnknownRecord): boolean {
  return market.closed === true || market.active === false;
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
      market = firstMarket(await getGamma("/markets", { id: marketId }));
    } catch (err) {
      req.log.error({ err, marketId }, "Unable to load Gamma market for trade preview");
      reply.status(502);
      return { ok: false, error: "market_lookup_failed" };
    }

    if (!market) {
      reply.status(404);
      return { ok: false, error: "market_not_found" };
    }

    if (isMarketClosed(market)) {
      reply.status(409);
      return { ok: false, error: "market_closed" };
    }

    const tokenIds = marketTokenIds(market);
    if (!tokenIds.includes(tokenId)) {
      reply.status(400);
      return { ok: false, error: "token_not_in_market", tokenIds };
    }

    const outcomes = parseStringArray((market as UnknownRecord).outcomes ?? (market as UnknownRecord).clobTokenIds);
    const marketQuestion = String((market as UnknownRecord).question ?? "");
    const marketCategory = String((market as UnknownRecord).category ?? "");
    const marketVolume = String((market as UnknownRecord).volume_24hr ?? (market as UnknownRecord).volume ?? "");
    const marketOutcomePrices = parseStringArray((market as UnknownRecord).outcomePrices);

    const [bookResult, insightResult] = await Promise.allSettled([
      getClobPublic("/book", { token_id: tokenId }),
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
      req.log.error({ err: bookResult.reason, tokenId }, "Unable to load CLOB book for trade preview");
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
