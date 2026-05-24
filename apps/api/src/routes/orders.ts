import { FastifyInstance } from "fastify";
import { z } from "zod";
import { getClobPublic } from "../services/polymarket.js";
import { parseBookLevels } from "../services/tradePreview.js";

const validateSchema = z.object({
  price: z.number().min(0.01).max(0.99),
  size: z.number().positive(),
  tokenId: z.string().min(1),
  side: z.enum(["buy", "sell"])
});

const signatureSchema = z.object({
  address: z.string().optional(),
  signature: z.string().optional(),
  timestamp: z.string().optional(),
  nonce: z.string().optional()
});

export async function orderRoutes(app: FastifyInstance): Promise<void> {
  app.post("/order/validate", async (req, reply) => {
    const parsed = validateSchema.safeParse(req.body ?? null);
    if (!parsed.success) {
      reply.status(400);
      return { ok: false, error: "invalid_payload", issues: parsed.error.issues };
    }

    const sig = signatureSchema.safeParse((req.body as Record<string, unknown> ?? {}).signature ?? {});
    if (!sig.success) {
      reply.status(400);
      return { ok: false, error: "invalid_signature" };
    }

    const { price, size, tokenId } = parsed.data;

    // Pull top-of-book to ensure we don't exceed a reasonable depth threshold.
    let bestPrice: number | null = null;
    let bestSize = 0;

    try {
      const book = await getClobPublic("/book", { token_id: tokenId });
      const side = parsed.data.side === "buy" ? "asks" : "bids";
      const entries = parseBookLevels(book, side);
      if (entries.length) {
        bestPrice = entries[0].price;
        bestSize = entries[0].size;
      }
    } catch {
      // ignore book failures for validation
    }

    if (bestPrice !== null && Number.isFinite(bestPrice)) {
      const priceDiff = Math.abs(price - bestPrice);
      if (priceDiff > 0.2) {
        reply.status(400);
        return { ok: false, error: "price_out_of_range", message: "Price too far from top of book." };
      }
    }

    if (bestSize > 0 && size > bestSize * 5) {
      reply.status(400);
      return { ok: false, error: "size_exceeds_liquidity", message: "Order size exceeds available liquidity." };
    }

    return {
      ok: true,
      price,
      size,
      tokenId,
      bestPrice,
      bestSize
    };
  });
}
