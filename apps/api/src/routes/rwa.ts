import { FastifyInstance } from "fastify";
import { z } from "zod";
import { buildCacheKey, getJsonCache, setJsonCache } from "../services/cache.js";

const assetQuerySchema = z.object({
  region: z.string().trim().min(2).max(2).optional(),
});

const quoteQuerySchema = z.object({
  symbol: z.string().trim().min(1).max(12),
});

const quotesQuerySchema = z.object({
  symbols: z.string().trim().min(1).max(180),
});

type RwaAsset = {
  id: string;
  symbol: string;
  displaySymbol: string;
  name: string;
  assetClass: "equity" | "etf";
  sector: string;
  sectorGroup: string; // for grouping in UI
  theme: string;
  quoteSymbol: string;
  // Optional Polymarket search slug/keyword for related prediction markets
  polymarketKeyword?: string;
  provider: {
    preferred: "ondo";
    chain: "BNB Chain";
    route: "PancakeSwap RWA";
    backedStatus: "available";  // xStocks/Backed is available in Nigeria (via Luno)
    ondoStatus: "kyc_required"; // Ondo requires KYC but does NOT block Nigeria
  };
  trading: {
    enabled: false;
    status: "routing_pending";
    note: string;
  };
  analysis: {
    enabled: false;
    status: "coming_next";
  };
  risk: "medium" | "high";
  accent: string;
};

type RwaQuote = {
  symbol: string;
  price: number | null;
  previousClose: number | null;
  change: number | null;
  changePct: number | null;
  currency: string;
  source: string;
  delayed: boolean;
  fetchedAt: string;
};

const PROVIDER_DEFAULTS = {
  provider: {
    preferred: "ondo" as const,
    chain: "BNB Chain" as const,
    route: "PancakeSwap RWA" as const,
    backedStatus: "available" as const,
    ondoStatus: "kyc_required" as const,
  },
  trading: {
    enabled: false as const,
    status: "routing_pending" as const,
    note: "Swap routing is not enabled until issuer eligibility and token contracts are finalized.",
  },
  analysis: { enabled: false as const, status: "coming_next" as const },
};

const assets: RwaAsset[] = [
  // ─── Big Tech ────────────────────────────────────────────────────────
  {
    id: "aapl", symbol: "AAPL", displaySymbol: "AAPL", name: "Apple Inc.",
    assetClass: "equity", sector: "Consumer technology", sectorGroup: "Big Tech",
    theme: "Quality mega-cap hardware and services. iPhone supercycle + Services flywheel.",
    quoteSymbol: "AAPL", polymarketKeyword: "Apple",
    risk: "medium", accent: "oklch(0.74 0.14 230)", ...PROVIDER_DEFAULTS,
  },
  {
    id: "msft", symbol: "MSFT", displaySymbol: "MSFT", name: "Microsoft Corp.",
    assetClass: "equity", sector: "Cloud & AI", sectorGroup: "Big Tech",
    theme: "Azure cloud + Copilot AI integration across enterprise software.",
    quoteSymbol: "MSFT", polymarketKeyword: "Microsoft",
    risk: "medium", accent: "oklch(0.66 0.17 250)", ...PROVIDER_DEFAULTS,
  },
  {
    id: "googl", symbol: "GOOGL", displaySymbol: "GOOGL", name: "Alphabet Inc.",
    assetClass: "equity", sector: "Search & AI", sectorGroup: "Big Tech",
    theme: "Search dominance + Gemini AI race. YouTube and Cloud growing.",
    quoteSymbol: "GOOGL", polymarketKeyword: "Google",
    risk: "medium", accent: "oklch(0.70 0.18 155)", ...PROVIDER_DEFAULTS,
  },
  {
    id: "meta", symbol: "META", displaySymbol: "META", name: "Meta Platforms",
    assetClass: "equity", sector: "Social media", sectorGroup: "Big Tech",
    theme: "Social ad dominance + Llama AI + Ray-Ban smart glasses momentum.",
    quoteSymbol: "META", polymarketKeyword: "Meta",
    risk: "medium", accent: "oklch(0.62 0.17 250)", ...PROVIDER_DEFAULTS,
  },
  {
    id: "amzn", symbol: "AMZN", displaySymbol: "AMZN", name: "Amazon.com Inc.",
    assetClass: "equity", sector: "Cloud & Commerce", sectorGroup: "Big Tech",
    theme: "AWS cloud + e-commerce + advertising — three high-margin engines.",
    quoteSymbol: "AMZN", polymarketKeyword: "Amazon",
    risk: "medium", accent: "oklch(0.76 0.17 82)", ...PROVIDER_DEFAULTS,
  },
  // ─── AI & Semiconductors ─────────────────────────────────────────────
  {
    id: "nvda", symbol: "NVDA", displaySymbol: "NVDA", name: "NVIDIA Corp.",
    assetClass: "equity", sector: "AI infrastructure", sectorGroup: "AI & Chips",
    theme: "AI chips, data-center capex, and high-beta growth. Blackwell cycle.",
    quoteSymbol: "NVDA", polymarketKeyword: "Nvidia",
    risk: "high", accent: "oklch(0.72 0.19 145)", ...PROVIDER_DEFAULTS,
  },
  {
    id: "amd", symbol: "AMD", displaySymbol: "AMD", name: "Advanced Micro Devices",
    assetClass: "equity", sector: "Semiconductors", sectorGroup: "AI & Chips",
    theme: "MI300 AI GPU challenger. Server CPU + GPU share gains vs Intel.",
    quoteSymbol: "AMD", polymarketKeyword: "AMD",
    risk: "high", accent: "oklch(0.68 0.20 25)", ...PROVIDER_DEFAULTS,
  },
  {
    id: "tsm", symbol: "TSM", displaySymbol: "TSM", name: "Taiwan Semiconductor",
    assetClass: "equity", sector: "Semiconductors", sectorGroup: "AI & Chips",
    theme: "World's leading chip foundry. Every AI chip flows through TSMC.",
    quoteSymbol: "TSM", polymarketKeyword: "TSMC Taiwan",
    risk: "high", accent: "oklch(0.70 0.18 200)", ...PROVIDER_DEFAULTS,
  },
  // ─── EV & Mobility ───────────────────────────────────────────────────
  {
    id: "tsla", symbol: "TSLA", displaySymbol: "TSLA", name: "Tesla Inc.",
    assetClass: "equity", sector: "EV and autonomy", sectorGroup: "EV & Mobility",
    theme: "High-volatility EV, robotics, Full Self-Driving, and Optimus robot narrative.",
    quoteSymbol: "TSLA", polymarketKeyword: "Tesla",
    risk: "high", accent: "oklch(0.64 0.21 25)", ...PROVIDER_DEFAULTS,
  },
  // ─── Crypto-adjacent Equities ────────────────────────────────────────
  {
    id: "coin", symbol: "COIN", displaySymbol: "COIN", name: "Coinbase Global",
    assetClass: "equity", sector: "Crypto infrastructure", sectorGroup: "Crypto Equities",
    theme: "Crypto beta through regulated exchange revenue. Key beneficiary of ETF flows.",
    quoteSymbol: "COIN", polymarketKeyword: "Coinbase",
    risk: "high", accent: "oklch(0.62 0.17 250)", ...PROVIDER_DEFAULTS,
  },
  {
    id: "mstr", symbol: "MSTR", displaySymbol: "MSTR", name: "MicroStrategy (Strategy)",
    assetClass: "equity", sector: "Bitcoin treasury", sectorGroup: "Crypto Equities",
    theme: "Leveraged Bitcoin exposure through corporate treasury. Saylor-led BTC accumulation.",
    quoteSymbol: "MSTR", polymarketKeyword: "MicroStrategy",
    risk: "high", accent: "oklch(0.74 0.16 82)", ...PROVIDER_DEFAULTS,
  },
  {
    id: "mara", symbol: "MARA", displaySymbol: "MARA", name: "MARA Holdings",
    assetClass: "equity", sector: "Bitcoin mining", sectorGroup: "Crypto Equities",
    theme: "Pure-play Bitcoin miner. High beta to BTC price + hashrate expansion.",
    quoteSymbol: "MARA", polymarketKeyword: "Marathon Bitcoin",
    risk: "high", accent: "oklch(0.66 0.16 82)", ...PROVIDER_DEFAULTS,
  },
  // ─── Finance ─────────────────────────────────────────────────────────
  {
    id: "jpm", symbol: "JPM", displaySymbol: "JPM", name: "JPMorgan Chase",
    assetClass: "equity", sector: "Banking", sectorGroup: "Finance",
    theme: "Largest US bank. Rate-sensitive revenue + trading desk + Dimon leadership.",
    quoteSymbol: "JPM", polymarketKeyword: "JPMorgan",
    risk: "medium", accent: "oklch(0.68 0.16 210)", ...PROVIDER_DEFAULTS,
  },
  {
    id: "v", symbol: "V", displaySymbol: "V", name: "Visa Inc.",
    assetClass: "equity", sector: "Payments", sectorGroup: "Finance",
    theme: "Global payment network tollbooth. Consumer spending proxy.",
    quoteSymbol: "V",
    risk: "medium", accent: "oklch(0.64 0.18 260)", ...PROVIDER_DEFAULTS,
  },
  {
    id: "gs", symbol: "GS", displaySymbol: "GS", name: "Goldman Sachs",
    assetClass: "equity", sector: "Investment banking", sectorGroup: "Finance",
    theme: "Top IB + trading. IPO cycle + dealmaking beneficiary.",
    quoteSymbol: "GS",
    risk: "medium", accent: "oklch(0.72 0.14 82)", ...PROVIDER_DEFAULTS,
  },
  // ─── Healthcare ──────────────────────────────────────────────────────
  {
    id: "lly", symbol: "LLY", displaySymbol: "LLY", name: "Eli Lilly & Co.",
    assetClass: "equity", sector: "Pharmaceuticals", sectorGroup: "Healthcare",
    theme: "GLP-1 weight-loss drugs (Mounjaro/Zepbound) creating a multi-decade revenue platform.",
    quoteSymbol: "LLY", polymarketKeyword: "Eli Lilly Ozempic",
    risk: "high", accent: "oklch(0.68 0.20 310)", ...PROVIDER_DEFAULTS,
  },
  {
    id: "jnj", symbol: "JNJ", displaySymbol: "JNJ", name: "Johnson & Johnson",
    assetClass: "equity", sector: "Diversified healthcare", sectorGroup: "Healthcare",
    theme: "Defensive healthcare conglomerate. MedTech + Pharma diversification.",
    quoteSymbol: "JNJ",
    risk: "medium", accent: "oklch(0.64 0.14 25)", ...PROVIDER_DEFAULTS,
  },
  // ─── Energy ──────────────────────────────────────────────────────────
  {
    id: "xom", symbol: "XOM", displaySymbol: "XOM", name: "ExxonMobil Corp.",
    assetClass: "equity", sector: "Oil & Gas", sectorGroup: "Energy",
    theme: "Integrated oil giant. Cash cow, buybacks, oil-price leverage.",
    quoteSymbol: "XOM", polymarketKeyword: "ExxonMobil oil",
    risk: "medium", accent: "oklch(0.66 0.14 60)", ...PROVIDER_DEFAULTS,
  },
  // ─── ETFs ────────────────────────────────────────────────────────────
  {
    id: "spy", symbol: "SPY", displaySymbol: "SPY", name: "SPDR S&P 500 ETF",
    assetClass: "etf", sector: "US broad market", sectorGroup: "ETFs",
    theme: "Diversified S&P 500 benchmark. 500 largest US companies in one trade.",
    quoteSymbol: "SPY", polymarketKeyword: "S&P 500",
    risk: "medium", accent: "oklch(0.78 0.16 82)", ...PROVIDER_DEFAULTS,
  },
  {
    id: "qqq", symbol: "QQQ", displaySymbol: "QQQ", name: "Invesco QQQ ETF",
    assetClass: "etf", sector: "Nasdaq growth", sectorGroup: "ETFs",
    theme: "Top 100 Nasdaq — mega-cap tech and growth concentration.",
    quoteSymbol: "QQQ",
    risk: "medium", accent: "oklch(0.65 0.18 290)", ...PROVIDER_DEFAULTS,
  },
  {
    id: "iwm", symbol: "IWM", displaySymbol: "IWM", name: "iShares Russell 2000 ETF",
    assetClass: "etf", sector: "US small-cap", sectorGroup: "ETFs",
    theme: "2000 small-cap US stocks. High beta to economic growth and rate cuts.",
    quoteSymbol: "IWM",
    risk: "high", accent: "oklch(0.68 0.16 155)", ...PROVIDER_DEFAULTS,
  },
  {
    id: "gld", symbol: "GLD", displaySymbol: "GLD", name: "SPDR Gold Shares",
    assetClass: "etf", sector: "Commodities", sectorGroup: "ETFs",
    theme: "Physical gold ETF. Safe-haven, dollar-hedge, macro uncertainty proxy.",
    quoteSymbol: "GLD", polymarketKeyword: "gold price",
    risk: "medium", accent: "oklch(0.76 0.17 82)", ...PROVIDER_DEFAULTS,
  },
  {
    id: "ibit", symbol: "IBIT", displaySymbol: "IBIT", name: "iShares Bitcoin ETF",
    assetClass: "etf", sector: "Crypto ETF", sectorGroup: "ETFs",
    theme: "BlackRock's spot Bitcoin ETF — institutional-grade BTC exposure.",
    quoteSymbol: "IBIT", polymarketKeyword: "Bitcoin ETF",
    risk: "high", accent: "oklch(0.74 0.16 82)", ...PROVIDER_DEFAULTS,
  },
  {
    id: "arkk", symbol: "ARKK", displaySymbol: "ARKK", name: "ARK Innovation ETF",
    assetClass: "etf", sector: "Disruptive tech", sectorGroup: "ETFs",
    theme: "Cathie Wood's high-conviction disruptive tech bets. Highest-beta US ETF.",
    quoteSymbol: "ARKK",
    risk: "high", accent: "oklch(0.64 0.20 330)", ...PROVIDER_DEFAULTS,
  },
];

// Ondo Finance prohibited jurisdictions (OFAC sanctioned + select securities law):
// Afghanistan, Belarus, Canada, Cuba, North Korea, Iran, Libya, Myanmar, Russia,
// Somalia, South Sudan, Sudan, Syria, United States (all territories), and
// occupied Ukraine regions. EU/EEA, UK, HK, MY, SG, CH require qualified investor status.
// Source: https://docs.ondo.finance/ondo-global-markets/eligibility
const ONDO_PROHIBITED = new Set([
  "AF","BY","CA","CU","KP","IR","LY","MM","RU","SO","SS","SD","SY","US",
]);

// Ondo jurisdictions that require professional/qualified investor status
const ONDO_QUALIFIED_ONLY = new Set(["BR","EU","GB","HK","MY","SG","CH"]);

// Backed/xStocks blocked jurisdictions:
// US, EU/EEA, UK, Canada, Australia, Belgium — developed markets with heavy RWA scrutiny.
// Nigeria is NOT blocked; Luno actively offers xStocks in Nigeria.
// Source: https://docs.xstocks.fi/legal-and-compliance
const BACKED_BLOCKED = new Set(["US","CA","AU","BE","GB"]);

function regionEligibility(region?: string) {
  const normalized = region?.toUpperCase().trim() ?? "NG";

  const ondoStatus =
    ONDO_PROHIBITED.has(normalized) ? "blocked" :
    ONDO_QUALIFIED_ONLY.has(normalized) ? "qualified_investor_only" :
    "eligible";

  const backedStatus =
    BACKED_BLOCKED.has(normalized) ? "blocked" : "available";

  return {
    region: normalized,
    backed: {
      status: backedStatus,
      note: backedStatus === "blocked"
        ? "xStocks/Backed is not available in your jurisdiction due to securities regulations."
        : "xStocks (Backed Finance) is available in your region. Used by Luno in Nigeria.",
    },
    ondo: {
      status: ondoStatus,
      note: ondoStatus === "blocked"
        ? "Your jurisdiction is on Ondo's prohibited list (OFAC/sanctions)."
        : ondoStatus === "qualified_investor_only"
        ? "Ondo is available in your region but requires Professional/Qualified Investor status under local securities law."
        : "Your region is eligible for Ondo Finance. KYC is required to complete onboarding.",
    },
  };
}

function finiteOrNull(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

async function fetchQuote(symbol: string): Promise<RwaQuote> {
  const normalized = symbol.toUpperCase();
  const cacheKey = buildCacheKey("rwa:quote", { symbol: normalized });
  const cached = await getJsonCache<RwaQuote>(cacheKey);
  if (cached) return cached;

  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(normalized)}`);
  url.searchParams.set("range", "5d");
  url.searchParams.set("interval", "1d");

  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    throw new Error(`quote_upstream_${res.status}`);
  }

  const payload = await res.json() as any;
  const result = payload?.chart?.result?.[0];
  const meta = result?.meta ?? {};
  const closes = (result?.indicators?.quote?.[0]?.close ?? []).filter((value: unknown) => Number.isFinite(Number(value)));
  const price = finiteOrNull(meta.regularMarketPrice) ?? finiteOrNull(closes.at(-1));
  const previousClose = finiteOrNull(meta.chartPreviousClose) ?? finiteOrNull(closes.at(-2));
  const change = price !== null && previousClose !== null ? price - previousClose : null;
  const changePct = change !== null && previousClose ? (change / previousClose) * 100 : null;

  const quote: RwaQuote = {
    symbol: normalized,
    price,
    previousClose,
    change,
    changePct,
    currency: String(meta.currency ?? "USD"),
    source: "Yahoo Finance",
    delayed: true,
    fetchedAt: new Date().toISOString(),
  };

  await setJsonCache(cacheKey, quote, 30, { staleTtlSeconds: 120 });
  return quote;
}

export async function rwaRoutes(app: FastifyInstance): Promise<void> {
  // Asset catalog with sector groupings
  app.get("/rwa/assets", async (req, reply) => {
    const query = assetQuerySchema.safeParse(req.query ?? {});
    if (!query.success) {
      reply.status(400);
      return { ok: false, error: "invalid_rwa_asset_query" };
    }

    return {
      ok: true,
      assets,
      eligibility: regionEligibility(query.data.region),
      disclaimers: [
        "Tokenized stock products are not direct shareholder ownership.",
        "Nigeria is eligible for both Ondo Finance and xStocks/Backed — no jurisdiction block applies.",
        "Ondo Finance requires KYC onboarding. Prohibited regions include: US, Russia, Iran, North Korea, and other OFAC-sanctioned states.",
        "xStocks (Backed Finance) is available in Nigeria and actively offered via Luno. Blocked regions include US, Canada, Australia, UK.",
        "Buy routing will be enabled once provider KYC integration and token contracts are finalized.",
      ],
    };
  });

  app.get("/rwa/quote", async (req, reply) => {
    const query = quoteQuerySchema.safeParse(req.query ?? {});
    if (!query.success) {
      reply.status(400);
      return { ok: false, error: "invalid_rwa_quote_query" };
    }

    try {
      const quote = await fetchQuote(query.data.symbol);
      return { ok: true, quote };
    } catch (err) {
      req.log.warn({ err, symbol: query.data.symbol }, "rwa quote unavailable");
      reply.status(502);
      return { ok: false, error: "rwa_quote_unavailable" };
    }
  });

  app.get("/rwa/quotes", async (req, reply) => {
    const query = quotesQuerySchema.safeParse(req.query ?? {});
    if (!query.success) {
      reply.status(400);
      return { ok: false, error: "invalid_rwa_quotes_query" };
    }

    const symbols = Array.from(new Set(
      query.data.symbols
        .split(",")
        .map((symbol) => symbol.trim().toUpperCase())
        .filter(Boolean)
        .slice(0, 20)
    ));

    const settled = await Promise.allSettled(symbols.map(fetchQuote));
    const quotes = settled
      .map((result) => result.status === "fulfilled" ? result.value : null)
      .filter((quote): quote is RwaQuote => Boolean(quote));

    return {
      ok: true,
      quotes,
      failed: settled.filter((result) => result.status === "rejected").length,
    };
  });

  // Related Polymarket prediction markets for a stock asset
  app.get("/rwa/related-markets", async (req, reply) => {
    const q = req.query as Record<string, string>;
    const assetId = q.asset_id?.toLowerCase().trim();
    const asset = assets.find((a) => a.id === assetId);
    if (!asset?.polymarketKeyword) {
      return { ok: true, markets: [] };
    }

    const cacheKey = buildCacheKey("rwa:related", { keyword: asset.polymarketKeyword });
    const cached = await getJsonCache(cacheKey);
    if (cached) return { ok: true, markets: cached };

    try {
      const url = new URL("https://gamma-api.polymarket.com/events");
      url.searchParams.set("q", asset.polymarketKeyword);
      url.searchParams.set("active", "true");
      url.searchParams.set("closed", "false");
      url.searchParams.set("limit", "8");
      url.searchParams.set("order", "volume24hr");
      url.searchParams.set("ascending", "false");

      const res = await fetch(url.toString(), {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return { ok: true, markets: [] };

      const events = await res.json() as any[];
      const markets = events.flatMap((ev: any) =>
        (ev.markets ?? []).slice(0, 2).map((m: any) => ({
          id: m.id,
          question: m.question ?? ev.title,
          slug: m.slug ?? ev.slug,
          yesPrice: (() => {
            try {
              const prices = JSON.parse(m.outcomePrices ?? "[]");
              return Number(prices[0]) > 1 ? Number(prices[0]) / 100 : Number(prices[0]);
            } catch { return null; }
          })(),
          volume: m.volume24hr ?? m.volume ?? 0,
          endDate: m.endDate ?? ev.endDate ?? null,
        }))
      ).filter((m: any) => m.id).slice(0, 6);

      await setJsonCache(cacheKey, markets, 120, { staleTtlSeconds: 600 });
      return { ok: true, markets };
    } catch {
      return { ok: true, markets: [] };
    }
  });
}
