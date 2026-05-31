import { FastifyInstance } from "fastify";
import { z } from "zod";
import { buildCacheKey, getJsonCache, setJsonCache } from "../services/cache.js";

const chartQuerySchema = z.object({
  asset: z.string().min(2).max(10),
  range: z.enum(["1D", "1W", "1M", "3M", "1Y"]).default("1M"),
});

const supportedAssets: Record<string, { name: string; binanceSymbol: string }> = {
  BTC: { name: "Bitcoin", binanceSymbol: "BTCUSDT" },
  ETH: { name: "Ethereum", binanceSymbol: "ETHUSDT" },
  BNB: { name: "BNB", binanceSymbol: "BNBUSDT" },
  SOL: { name: "Solana", binanceSymbol: "SOLUSDT" },
  XRP: { name: "XRP", binanceSymbol: "XRPUSDT" },
  DOGE: { name: "Dogecoin", binanceSymbol: "DOGEUSDT" },
  ADA: { name: "Cardano", binanceSymbol: "ADAUSDT" },
  AVAX: { name: "Avalanche", binanceSymbol: "AVAXUSDT" },
  LINK: { name: "Chainlink", binanceSymbol: "LINKUSDT" },
  DOT: { name: "Polkadot", binanceSymbol: "DOTUSDT" },
  POL: { name: "Polygon", binanceSymbol: "POLUSDT" },
  MATIC: { name: "Polygon", binanceSymbol: "POLUSDT" },
  TRX: { name: "TRON", binanceSymbol: "TRXUSDT" },
  TON: { name: "Toncoin", binanceSymbol: "TONUSDT" },
  SHIB: { name: "Shiba Inu", binanceSymbol: "SHIBUSDT" },
  PEPE: { name: "Pepe", binanceSymbol: "PEPEUSDT" },
  WIF: { name: "dogwifhat", binanceSymbol: "WIFUSDT" },
  BONK: { name: "Bonk", binanceSymbol: "BONKUSDT" },
  RENDER: { name: "Render", binanceSymbol: "RENDERUSDT" },
  NEAR: { name: "NEAR", binanceSymbol: "NEARUSDT" },
  SUI: { name: "Sui", binanceSymbol: "SUIUSDT" },
  APT: { name: "Aptos", binanceSymbol: "APTUSDT" },
  ARB: { name: "Arbitrum", binanceSymbol: "ARBUSDT" },
  OP: { name: "Optimism", binanceSymbol: "OPUSDT" },
  UNI: { name: "Uniswap", binanceSymbol: "UNIUSDT" },
  LTC: { name: "Litecoin", binanceSymbol: "LTCUSDT" },
  BCH: { name: "Bitcoin Cash", binanceSymbol: "BCHUSDT" },
};

const rangeConfig: Record<z.infer<typeof chartQuerySchema>["range"], { interval: string; limit: number }> = {
  "1D": { interval: "15m", limit: 96 },
  "1W": { interval: "1h", limit: 168 },
  "1M": { interval: "4h", limit: 180 },
  "3M": { interval: "1d", limit: 90 },
  "1Y": { interval: "1d", limit: 365 },
};

type BinanceKline = [
  number,
  string,
  string,
  string,
  string,
  string,
  number,
  string,
  number,
  string,
  string,
  string,
];

export async function cryptoRoutes(app: FastifyInstance): Promise<void> {
  app.get("/crypto/chart", async (req, reply) => {
    const query = chartQuerySchema.safeParse(req.query ?? {});
    if (!query.success) {
      reply.status(400);
      return { error: "invalid_crypto_chart_query" };
    }

    const asset = query.data.asset.toUpperCase();
    const meta = supportedAssets[asset];
    if (!meta) {
      reply.status(400);
      return { error: "unsupported_crypto_asset" };
    }

    const config = rangeConfig[query.data.range];
    const cacheKey = buildCacheKey("crypto:chart", { asset, range: query.data.range });
    const cached = await getJsonCache(cacheKey);
    if (cached) return cached;

    const url = new URL("https://api.binance.com/api/v3/klines");
    url.searchParams.set("symbol", meta.binanceSymbol);
    url.searchParams.set("interval", config.interval);
    url.searchParams.set("limit", String(config.limit));

    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      req.log.warn({ asset, range: query.data.range, status: res.status }, "crypto chart upstream unavailable");
      reply.status(502);
      return { error: "crypto_chart_unavailable" };
    }

    const raw = (await res.json()) as BinanceKline[];
    const candles = raw
      .map((row) => ({
        time: Math.floor(Number(row[0]) / 1000),
        open: Number(row[1]),
        high: Number(row[2]),
        low: Number(row[3]),
        close: Number(row[4]),
        volume: Number(row[5]),
      }))
      .filter((row) =>
        Number.isFinite(row.time) &&
        Number.isFinite(row.open) &&
        Number.isFinite(row.high) &&
        Number.isFinite(row.low) &&
        Number.isFinite(row.close),
      );

    const first = candles[0]?.close ?? null;
    const last = candles[candles.length - 1]?.close ?? null;
    const changePct = first && last ? ((last - first) / first) * 100 : null;

    const payload = {
      asset,
      name: meta.name,
      quote: "USDT",
      range: query.data.range,
      source: "Binance",
      currentPrice: last,
      changePct,
      candles,
    };

    await setJsonCache(cacheKey, payload, 30);
    return payload;
  });
}
