import { FastifyInstance } from "fastify";
import { createPublicClient, fallback, formatUnits, http, parseAbi, parseUnits, type Address } from "viem";
import { bsc } from "viem/chains";
import { z } from "zod";
import { config } from "../config.js";
import { buildCacheKey, getJsonCache, getJsonCacheEntry, setJsonCache } from "../services/cache.js";

const assetQuerySchema = z.object({
  region: z.string().trim().min(2).max(2).optional(),
});

const quoteQuerySchema = z.object({
  symbol: z.string().trim().min(1).max(12),
});

const quotesQuerySchema = z.object({
  symbols: z.string().trim().min(1).max(640),
});

const routeQuerySchema = z.object({
  symbol: z.string().trim().min(1).max(16),
  region: z.string().trim().min(2).max(2).optional(),
});

const swapQuoteQuerySchema = z.object({
  symbol: z.string().trim().min(1).max(16),
  side: z.enum(["buy", "sell"]),
  amount: z.string().trim().regex(/^\d+(\.\d{1,18})?$/),
  slippageBps: z.coerce.number().int().min(10).max(1000).optional(),
});

const ONDO_TOKEN_LIST_URL = "https://tokens.pancakeswap.finance/ondo-rwa-tokens.json";
const BNB_CHAIN_ID = 56;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const BSC_USDT = {
  symbol: "USDT" as const,
  address: "0x55d398326f99059fF775485246999027B3197955" as Address,
  decimals: 18 as const,
};
const PANCAKE_V3_FACTORY = "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865" as Address;
const PANCAKE_V3_QUOTER_V2 = "0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997" as Address;
const PANCAKE_V3_SWAP_ROUTER = "0x1b81D678ffb9C0263b24A97847620C99d213eB14" as Address;
const PANCAKE_V3_FEES = [100, 500, 2500, 10000] as const;
const DEFAULT_SLIPPAGE_BPS = 200;
const ROUTE_TEST_USDT_RAW = parseUnits("10", BSC_USDT.decimals);
const MIN_ROUND_TRIP_BPS = 9000;

const bscClient = createPublicClient({
  chain: bsc,
  transport: fallback(
    [config.payment.bscRpcUrl, ...(config.payment.bscRpcFallbacks ?? [])]
      .filter((url, index, urls) => Boolean(url) && urls.indexOf(url) === index)
      .map((url) => http(url, { timeout: 8_000 }))
  ),
});

const pancakeFactoryAbi = parseAbi([
  "function getPool(address tokenA,address tokenB,uint24 fee) view returns (address pool)",
]);

const pancakeQuoterAbi = parseAbi([
  "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)",
]);

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
    backedStatus: "not_used";
    ondoStatus: "secondary_market_candidate";
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
  listedAt?: string;
  volumeRank?: number;
};

type OndoToken = {
  chainId: number;
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  logoURI?: string;
};

type RwaRouteHealth = {
  symbol: string;
  status: "blocked" | "watch_only" | "tradable" | "route_unsafe" | "quote_adapter_unavailable";
  tradable: boolean;
  exitVerified: boolean;
  source: string;
  chain: {
    name: "BNB Chain";
    chainId: 56;
  };
  token: {
    symbol: string | null;
    address: string | null;
    decimals: number | null;
    logoURI?: string;
  };
  settlementAsset: {
    symbol: "USDT";
    address: string;
    decimals: 18;
  };
  dex?: {
    venue: "PancakeSwap V3";
    router: string;
    quoter: string;
    factory: string;
    fee: number;
    pool: string;
    roundTripBps: number;
    testInputRaw: string;
    testTokenOutRaw: string;
    testSellBackRaw: string;
  };
  buy: {
    enabled: boolean;
    status: "enabled" | "blocked" | "token_missing" | "route_unsafe" | "quote_adapter_unavailable";
    note: string;
  };
  sell: {
    enabled: boolean;
    status: "enabled" | "blocked" | "token_missing" | "route_unsafe" | "quote_adapter_unavailable";
    note: string;
  };
  copy: {
    primary: string;
    secondary: string;
  };
};

type RwaSafeRoute = {
  fee: number;
  pool: string;
  roundTripBps: number;
  testInputRaw: string;
  testTokenOutRaw: string;
  testSellBackRaw: string;
};

type PancakeQuote = {
  amountOut: bigint;
  gasEstimate: bigint;
};

type RwaQuote = {
  symbol: string;
  price: number | null;
  previousClose: number | null;
  change: number | null;
  changePct: number | null;
  volume: number | null;
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
    backedStatus: "not_used" as const,
    ondoStatus: "secondary_market_candidate" as const,
  },
  trading: {
    enabled: false as const,
    status: "routing_pending" as const,
    note: "Buy and sell routing unlocks only after a live two-way PancakeSwap route is verified.",
  },
  analysis: { enabled: false as const, status: "coming_next" as const },
};

const CATALOG_ROUTE_PREFETCH_SYMBOLS = new Set(["MSFT", "GOOGL", "NVDA", "TSLA", "SPY", "QQQ"]);

function expandedAsset(input: Omit<RwaAsset, "provider" | "trading" | "analysis">): RwaAsset {
  return { ...input, ...PROVIDER_DEFAULTS };
}

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

  // ─── Expanded Rawli Stock Feed ──────────────────────────────────────
  expandedAsset({
    id: "nflx", symbol: "NFLX", displaySymbol: "NFLX", name: "Netflix Inc.",
    assetClass: "equity", sector: "Streaming", sectorGroup: "Consumer & Internet",
    theme: "Streaming leader with ads tier, live events, gaming experiments, and global subscriber scale.",
    quoteSymbol: "NFLX", polymarketKeyword: "Netflix",
    risk: "high", accent: "oklch(0.62 0.20 25)", listedAt: "2026-06-03", volumeRank: 16,
  }),
  expandedAsset({
    id: "adbe", symbol: "ADBE", displaySymbol: "ADBE", name: "Adobe Inc.",
    assetClass: "equity", sector: "Creative software", sectorGroup: "Big Tech",
    theme: "Creative Cloud + enterprise workflow. AI monetization through Firefly and document automation.",
    quoteSymbol: "ADBE", polymarketKeyword: "Adobe AI",
    risk: "medium", accent: "oklch(0.66 0.19 25)", listedAt: "2026-06-03", volumeRank: 20,
  }),
  expandedAsset({
    id: "crm", symbol: "CRM", displaySymbol: "CRM", name: "Salesforce Inc.",
    assetClass: "equity", sector: "Enterprise software", sectorGroup: "Big Tech",
    theme: "Enterprise CRM platform with AI agents, margin discipline, and software spending sensitivity.",
    quoteSymbol: "CRM", polymarketKeyword: "Salesforce",
    risk: "medium", accent: "oklch(0.68 0.17 220)", listedAt: "2026-06-03", volumeRank: 24,
  }),
  expandedAsset({
    id: "orcl", symbol: "ORCL", displaySymbol: "ORCL", name: "Oracle Corp.",
    assetClass: "equity", sector: "Cloud infrastructure", sectorGroup: "Big Tech",
    theme: "Database cash flows plus cloud infrastructure demand from enterprise AI workloads.",
    quoteSymbol: "ORCL", polymarketKeyword: "Oracle",
    risk: "medium", accent: "oklch(0.64 0.18 25)", listedAt: "2026-06-03", volumeRank: 26,
  }),
  expandedAsset({
    id: "avgo", symbol: "AVGO", displaySymbol: "AVGO", name: "Broadcom Inc.",
    assetClass: "equity", sector: "AI networking", sectorGroup: "AI & Chips",
    theme: "Custom AI silicon, networking chips, and VMware software cash generation.",
    quoteSymbol: "AVGO", polymarketKeyword: "Broadcom AI",
    risk: "high", accent: "oklch(0.70 0.18 35)", listedAt: "2026-06-03", volumeRank: 9,
  }),
  expandedAsset({
    id: "arm", symbol: "ARM", displaySymbol: "ARM", name: "Arm Holdings",
    assetClass: "equity", sector: "Chip architecture", sectorGroup: "AI & Chips",
    theme: "Royalty model tied to mobile, data-center, and edge AI semiconductor design wins.",
    quoteSymbol: "ARM", polymarketKeyword: "Arm Holdings",
    risk: "high", accent: "oklch(0.65 0.18 150)", listedAt: "2026-06-03", volumeRank: 29,
  }),
  expandedAsset({
    id: "asml", symbol: "ASML", displaySymbol: "ASML", name: "ASML Holding",
    assetClass: "equity", sector: "Semicap equipment", sectorGroup: "AI & Chips",
    theme: "EUV lithography monopoly. Critical bottleneck for advanced-node AI chip production.",
    quoteSymbol: "ASML", polymarketKeyword: "ASML chips",
    risk: "medium", accent: "oklch(0.70 0.15 62)", listedAt: "2026-06-03", volumeRank: 34,
  }),
  expandedAsset({
    id: "pltr", symbol: "PLTR", displaySymbol: "PLTR", name: "Palantir Technologies",
    assetClass: "equity", sector: "AI software", sectorGroup: "AI & Chips",
    theme: "Operational AI platform with government roots and commercial AIP adoption.",
    quoteSymbol: "PLTR", polymarketKeyword: "Palantir",
    risk: "high", accent: "oklch(0.72 0.12 255)", listedAt: "2026-06-03", volumeRank: 8,
  }),
  expandedAsset({
    id: "snow", symbol: "SNOW", displaySymbol: "SNOW", name: "Snowflake Inc.",
    assetClass: "equity", sector: "Data cloud", sectorGroup: "AI & Chips",
    theme: "Data warehouse and AI app platform. Usage growth and enterprise software budgets matter.",
    quoteSymbol: "SNOW", polymarketKeyword: "Snowflake",
    risk: "high", accent: "oklch(0.72 0.14 220)", listedAt: "2026-06-03", volumeRank: 35,
  }),
  expandedAsset({
    id: "mu", symbol: "MU", displaySymbol: "MU", name: "Micron Technology",
    assetClass: "equity", sector: "Memory chips", sectorGroup: "AI & Chips",
    theme: "HBM and DRAM cycle exposure. High beta to AI server memory demand.",
    quoteSymbol: "MU", polymarketKeyword: "Micron",
    risk: "high", accent: "oklch(0.65 0.18 260)", listedAt: "2026-06-03", volumeRank: 18,
  }),
  expandedAsset({
    id: "intc", symbol: "INTC", displaySymbol: "INTC", name: "Intel Corp.",
    assetClass: "equity", sector: "Semiconductors", sectorGroup: "AI & Chips",
    theme: "Turnaround and foundry execution story. High variance around manufacturing milestones.",
    quoteSymbol: "INTC", polymarketKeyword: "Intel",
    risk: "high", accent: "oklch(0.62 0.17 250)", listedAt: "2026-06-03", volumeRank: 17,
  }),
  expandedAsset({
    id: "crcl", symbol: "CRCL", displaySymbol: "CRCL", name: "Circle Internet Group",
    assetClass: "equity", sector: "Stablecoin infrastructure", sectorGroup: "Crypto Equities",
    theme: "USDC issuer exposure to stablecoin adoption, rates, regulation, and crypto market activity.",
    quoteSymbol: "CRCL", polymarketKeyword: "Circle USDC",
    risk: "high", accent: "oklch(0.64 0.17 245)", listedAt: "2026-06-03", volumeRank: 28,
  }),
  expandedAsset({
    id: "hood", symbol: "HOOD", displaySymbol: "HOOD", name: "Robinhood Markets",
    assetClass: "equity", sector: "Retail brokerage", sectorGroup: "Crypto Equities",
    theme: "Retail trading, crypto volumes, options activity, and product expansion into wealth.",
    quoteSymbol: "HOOD", polymarketKeyword: "Robinhood",
    risk: "high", accent: "oklch(0.68 0.18 155)", listedAt: "2026-06-03", volumeRank: 13,
  }),
  expandedAsset({
    id: "sofi", symbol: "SOFI", displaySymbol: "SOFI", name: "SoFi Technologies",
    assetClass: "equity", sector: "Fintech banking", sectorGroup: "Finance",
    theme: "Consumer finance platform with lending, deposits, and Galileo tech-platform exposure.",
    quoteSymbol: "SOFI", polymarketKeyword: "SoFi",
    risk: "high", accent: "oklch(0.68 0.18 230)", listedAt: "2026-06-03", volumeRank: 15,
  }),
  expandedAsset({
    id: "ma", symbol: "MA", displaySymbol: "MA", name: "Mastercard Inc.",
    assetClass: "equity", sector: "Payments", sectorGroup: "Finance",
    theme: "Global card-network tollbooth. Cross-border travel and consumer spend sensitivity.",
    quoteSymbol: "MA",
    risk: "medium", accent: "oklch(0.74 0.17 70)", listedAt: "2026-06-03", volumeRank: 31,
  }),
  expandedAsset({
    id: "blk", symbol: "BLK", displaySymbol: "BLK", name: "BlackRock Inc.",
    assetClass: "equity", sector: "Asset management", sectorGroup: "Finance",
    theme: "World's largest asset manager. ETF flows, market levels, and tokenization narrative.",
    quoteSymbol: "BLK", polymarketKeyword: "BlackRock ETF",
    risk: "medium", accent: "oklch(0.66 0.12 255)", listedAt: "2026-06-03", volumeRank: 42,
  }),
  expandedAsset({
    id: "axp", symbol: "AXP", displaySymbol: "AXP", name: "American Express",
    assetClass: "equity", sector: "Consumer credit", sectorGroup: "Finance",
    theme: "Premium card spend, credit quality, travel, and affluent consumer resilience.",
    quoteSymbol: "AXP",
    risk: "medium", accent: "oklch(0.65 0.16 240)", listedAt: "2026-06-03", volumeRank: 44,
  }),
  expandedAsset({
    id: "cost", symbol: "COST", displaySymbol: "COST", name: "Costco Wholesale",
    assetClass: "equity", sector: "Retail", sectorGroup: "Consumer & Internet",
    theme: "Membership retail compounder with pricing power, renewal strength, and defensive demand.",
    quoteSymbol: "COST", polymarketKeyword: "Costco",
    risk: "medium", accent: "oklch(0.72 0.16 45)", listedAt: "2026-06-03", volumeRank: 25,
  }),
  expandedAsset({
    id: "wmt", symbol: "WMT", displaySymbol: "WMT", name: "Walmart Inc.",
    assetClass: "equity", sector: "Retail", sectorGroup: "Consumer & Internet",
    theme: "Defensive retail, grocery share, e-commerce scale, and ad-network upside.",
    quoteSymbol: "WMT", polymarketKeyword: "Walmart",
    risk: "medium", accent: "oklch(0.72 0.15 90)", listedAt: "2026-06-03", volumeRank: 21,
  }),
  expandedAsset({
    id: "dis", symbol: "DIS", displaySymbol: "DIS", name: "Walt Disney Co.",
    assetClass: "equity", sector: "Media & parks", sectorGroup: "Consumer & Internet",
    theme: "Streaming turnaround, theme parks, sports rights, and entertainment IP monetization.",
    quoteSymbol: "DIS", polymarketKeyword: "Disney",
    risk: "medium", accent: "oklch(0.66 0.18 270)", listedAt: "2026-06-03", volumeRank: 19,
  }),
  expandedAsset({
    id: "uber", symbol: "UBER", displaySymbol: "UBER", name: "Uber Technologies",
    assetClass: "equity", sector: "Mobility platform", sectorGroup: "Consumer & Internet",
    theme: "Rideshare and delivery network effects. Autonomous vehicle disruption remains the watch item.",
    quoteSymbol: "UBER", polymarketKeyword: "Uber",
    risk: "high", accent: "oklch(0.72 0.12 255)", listedAt: "2026-06-03", volumeRank: 12,
  }),
  expandedAsset({
    id: "abnb", symbol: "ABNB", displaySymbol: "ABNB", name: "Airbnb Inc.",
    assetClass: "equity", sector: "Travel marketplace", sectorGroup: "Consumer & Internet",
    theme: "Global travel marketplace with regulatory risk, take-rate leverage, and experiences expansion.",
    quoteSymbol: "ABNB", polymarketKeyword: "Airbnb",
    risk: "high", accent: "oklch(0.66 0.20 25)", listedAt: "2026-06-03", volumeRank: 38,
  }),
  expandedAsset({
    id: "dash", symbol: "DASH", displaySymbol: "DASH", name: "DoorDash Inc.",
    assetClass: "equity", sector: "Delivery platform", sectorGroup: "Consumer & Internet",
    theme: "Local commerce and delivery scale. Margins depend on frequency, ads, and international growth.",
    quoteSymbol: "DASH", polymarketKeyword: "DoorDash",
    risk: "high", accent: "oklch(0.62 0.20 25)", listedAt: "2026-06-03", volumeRank: 36,
  }),
  expandedAsset({
    id: "shop", symbol: "SHOP", displaySymbol: "SHOP", name: "Shopify Inc.",
    assetClass: "equity", sector: "Commerce software", sectorGroup: "Consumer & Internet",
    theme: "Merchant operating system with payments, fulfillment partnerships, and AI commerce tools.",
    quoteSymbol: "SHOP", polymarketKeyword: "Shopify",
    risk: "high", accent: "oklch(0.70 0.18 145)", listedAt: "2026-06-03", volumeRank: 27,
  }),
  expandedAsset({
    id: "sbux", symbol: "SBUX", displaySymbol: "SBUX", name: "Starbucks Corp.",
    assetClass: "equity", sector: "Restaurants", sectorGroup: "Consumer & Internet",
    theme: "Global coffee chain turnaround. China, traffic, labor, and loyalty program all matter.",
    quoteSymbol: "SBUX", polymarketKeyword: "Starbucks",
    risk: "medium", accent: "oklch(0.62 0.15 145)", listedAt: "2026-06-03", volumeRank: 33,
  }),
  expandedAsset({
    id: "gme", symbol: "GME", displaySymbol: "GME", name: "GameStop Corp.",
    assetClass: "equity", sector: "Meme equity", sectorGroup: "Consumer & Internet",
    theme: "Meme-stock volatility, cash balance, retail flow, and turnaround speculation.",
    quoteSymbol: "GME", polymarketKeyword: "GameStop",
    risk: "high", accent: "oklch(0.62 0.20 35)", listedAt: "2026-06-03", volumeRank: 14,
  }),
  expandedAsset({
    id: "rddt", symbol: "RDDT", displaySymbol: "RDDT", name: "Reddit Inc.",
    assetClass: "equity", sector: "Social media", sectorGroup: "Consumer & Internet",
    theme: "Community platform with ads, data licensing, and AI-training monetization optionality.",
    quoteSymbol: "RDDT", polymarketKeyword: "Reddit",
    risk: "high", accent: "oklch(0.68 0.20 35)", listedAt: "2026-06-03", volumeRank: 32,
  }),
  expandedAsset({
    id: "lmt", symbol: "LMT", displaySymbol: "LMT", name: "Lockheed Martin",
    assetClass: "equity", sector: "Defense", sectorGroup: "Defense & Industrials",
    theme: "Defense prime exposed to geopolitical budgets, F-35, missiles, and space systems.",
    quoteSymbol: "LMT", polymarketKeyword: "Lockheed defense",
    risk: "medium", accent: "oklch(0.60 0.10 120)", listedAt: "2026-06-03", volumeRank: 48,
  }),
  expandedAsset({
    id: "ge", symbol: "GE", displaySymbol: "GE", name: "GE Aerospace",
    assetClass: "equity", sector: "Aerospace", sectorGroup: "Defense & Industrials",
    theme: "Aircraft engine cycle, defense exposure, services backlog, and aerospace supply chain.",
    quoteSymbol: "GE", polymarketKeyword: "GE Aerospace",
    risk: "medium", accent: "oklch(0.64 0.15 225)", listedAt: "2026-06-03", volumeRank: 30,
  }),
  expandedAsset({
    id: "ba", symbol: "BA", displaySymbol: "BA", name: "Boeing Co.",
    assetClass: "equity", sector: "Aerospace", sectorGroup: "Defense & Industrials",
    theme: "High-risk aerospace turnaround. Delivery pace, safety, cash burn, and defense backlog.",
    quoteSymbol: "BA", polymarketKeyword: "Boeing",
    risk: "high", accent: "oklch(0.62 0.16 240)", listedAt: "2026-06-03", volumeRank: 22,
  }),
  expandedAsset({
    id: "nvo", symbol: "NVO", displaySymbol: "NVO", name: "Novo Nordisk",
    assetClass: "equity", sector: "GLP-1 drugs", sectorGroup: "Healthcare",
    theme: "Global weight-loss and diabetes leader. Wegovy/Ozempic demand and capacity are key.",
    quoteSymbol: "NVO", polymarketKeyword: "Novo Nordisk Ozempic",
    risk: "high", accent: "oklch(0.66 0.18 310)", listedAt: "2026-06-03", volumeRank: 23,
  }),
  expandedAsset({
    id: "unh", symbol: "UNH", displaySymbol: "UNH", name: "UnitedHealth Group",
    assetClass: "equity", sector: "Managed care", sectorGroup: "Healthcare",
    theme: "Managed-care bellwether. Medical cost trend, regulation, and Optum earnings quality.",
    quoteSymbol: "UNH", polymarketKeyword: "UnitedHealth",
    risk: "medium", accent: "oklch(0.62 0.16 245)", listedAt: "2026-06-03", volumeRank: 37,
  }),
  expandedAsset({
    id: "abt", symbol: "ABT", displaySymbol: "ABT", name: "Abbott Laboratories",
    assetClass: "equity", sector: "MedTech", sectorGroup: "Healthcare",
    theme: "Medical devices and diagnostics. Defensive healthcare with growth from diabetes care.",
    quoteSymbol: "ABT",
    risk: "medium", accent: "oklch(0.66 0.15 215)", listedAt: "2026-06-03", volumeRank: 45,
  }),
  expandedAsset({
    id: "pfe", symbol: "PFE", displaySymbol: "PFE", name: "Pfizer Inc.",
    assetClass: "equity", sector: "Pharmaceuticals", sectorGroup: "Healthcare",
    theme: "Post-COVID reset, pipeline execution, dividend debate, and pharma policy sensitivity.",
    quoteSymbol: "PFE", polymarketKeyword: "Pfizer",
    risk: "medium", accent: "oklch(0.62 0.16 250)", listedAt: "2026-06-03", volumeRank: 40,
  }),
  expandedAsset({
    id: "baba", symbol: "BABA", displaySymbol: "BABA", name: "Alibaba Group",
    assetClass: "equity", sector: "China internet", sectorGroup: "Global ADRs",
    theme: "China e-commerce/cloud bellwether. Policy, stimulus, and AI cloud narrative drive beta.",
    quoteSymbol: "BABA", polymarketKeyword: "Alibaba China",
    risk: "high", accent: "oklch(0.76 0.17 62)", listedAt: "2026-06-03", volumeRank: 11,
  }),
  expandedAsset({
    id: "bidu", symbol: "BIDU", displaySymbol: "BIDU", name: "Baidu Inc.",
    assetClass: "equity", sector: "China AI/search", sectorGroup: "Global ADRs",
    theme: "China search plus Ernie AI, autonomous driving, cloud, and macro/policy sensitivity.",
    quoteSymbol: "BIDU", polymarketKeyword: "Baidu China AI",
    risk: "high", accent: "oklch(0.62 0.17 250)", listedAt: "2026-06-03", volumeRank: 43,
  }),
  expandedAsset({
    id: "jd", symbol: "JD", displaySymbol: "JD", name: "JD.com",
    assetClass: "equity", sector: "China e-commerce", sectorGroup: "Global ADRs",
    theme: "China retail and logistics platform. Consumption recovery and margin discipline matter.",
    quoteSymbol: "JD", polymarketKeyword: "JD.com China",
    risk: "high", accent: "oklch(0.64 0.19 25)", listedAt: "2026-06-03", volumeRank: 41,
  }),
  expandedAsset({
    id: "pbr", symbol: "PBR", displaySymbol: "PBR", name: "Petrobras",
    assetClass: "equity", sector: "Brazil energy", sectorGroup: "Global ADRs",
    theme: "Brazil oil major with commodity upside, dividend politics, and state influence.",
    quoteSymbol: "PBR", polymarketKeyword: "Petrobras oil",
    risk: "high", accent: "oklch(0.68 0.15 120)", listedAt: "2026-06-03", volumeRank: 39,
  }),
  expandedAsset({
    id: "eem", symbol: "EEM", displaySymbol: "EEM", name: "iShares MSCI Emerging Markets ETF",
    assetClass: "etf", sector: "Emerging markets", sectorGroup: "ETFs",
    theme: "Broad EM basket for China, Taiwan, India, and global risk appetite exposure.",
    quoteSymbol: "EEM", polymarketKeyword: "emerging markets",
    risk: "high", accent: "oklch(0.66 0.16 155)", listedAt: "2026-06-03", volumeRank: 10,
  }),
  expandedAsset({
    id: "ivv", symbol: "IVV", displaySymbol: "IVV", name: "iShares Core S&P 500 ETF",
    assetClass: "etf", sector: "US broad market", sectorGroup: "ETFs",
    theme: "Low-cost S&P 500 exposure. Similar macro read-through as SPY with ETF liquidity.",
    quoteSymbol: "IVV", polymarketKeyword: "S&P 500",
    risk: "medium", accent: "oklch(0.72 0.16 82)", listedAt: "2026-06-03", volumeRank: 7,
  }),
  expandedAsset({
    id: "itot", symbol: "ITOT", displaySymbol: "ITOT", name: "iShares Core S&P Total US Stock Market ETF",
    assetClass: "etf", sector: "Total US market", sectorGroup: "ETFs",
    theme: "Whole US equity market exposure across mega-cap, mid-cap, and small-cap risk.",
    quoteSymbol: "ITOT",
    risk: "medium", accent: "oklch(0.70 0.15 82)", listedAt: "2026-06-03", volumeRank: 46,
  }),
  expandedAsset({
    id: "hyg", symbol: "HYG", displaySymbol: "HYG", name: "iBoxx High Yield Corporate Bond ETF",
    assetClass: "etf", sector: "Credit", sectorGroup: "ETFs",
    theme: "High-yield credit risk proxy. Sensitive to spreads, default fears, and rate volatility.",
    quoteSymbol: "HYG", polymarketKeyword: "high yield bonds",
    risk: "medium", accent: "oklch(0.66 0.12 110)", listedAt: "2026-06-03", volumeRank: 47,
  }),
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

function regionEligibility(region?: string) {
  const normalized = region?.toUpperCase().trim() ?? "NG";

  const ondoStatus =
    ONDO_PROHIBITED.has(normalized) ? "blocked" :
    ONDO_QUALIFIED_ONLY.has(normalized) ? "qualified_investor_only" :
    "eligible";

  return {
    region: normalized,
    backed: {
      status: "not_used",
      note: "Rawli's stock lane is scoped to Ondo tokenized stocks on BNB Chain. Backed/xStocks is not part of this route.",
    },
    ondo: {
      status: ondoStatus,
      note: ondoStatus === "blocked"
        ? "Your jurisdiction is on Ondo's prohibited list (OFAC/sanctions)."
        : ondoStatus === "qualified_investor_only"
        ? "Ondo is available in your region but requires Professional/Qualified Investor status under local securities law."
        : "Your region is not blocked for Ondo secondary-market access. Direct issuer onboarding or redemption may still require Ondo checks.",
    },
  };
}

function ondoBaseSymbol(symbol: string) {
  return symbol.toLowerCase().endsWith("on")
    ? symbol.slice(0, -2).toUpperCase()
    : symbol.toUpperCase();
}

let ondoTokenMapInflight: Promise<Map<string, OndoToken>> | null = null;

async function fetchOndoTokenMap(): Promise<Map<string, OndoToken>> {
  const cacheKey = buildCacheKey("rwa:ondo-token-list", { chainId: BNB_CHAIN_ID });
  const cached = await getJsonCache<OndoToken[]>(cacheKey);
  if (cached) {
    return new Map(cached.map((token) => [ondoBaseSymbol(token.symbol), token]));
  }

  if (!ondoTokenMapInflight) {
    ondoTokenMapInflight = (async () => {
      const res = await fetch(ONDO_TOKEN_LIST_URL, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error(`ondo_token_list_${res.status}`);

      const payload = await res.json() as { tokens?: OndoToken[] };
      const tokens = (payload.tokens ?? [])
        .filter((token) =>
          token.chainId === BNB_CHAIN_ID &&
          typeof token.address === "string" &&
          typeof token.symbol === "string" &&
          Number.isFinite(Number(token.decimals))
        );

      await setJsonCache(cacheKey, tokens, 3600, { staleTtlSeconds: 24 * 3600 });
      return new Map(tokens.map((token) => [ondoBaseSymbol(token.symbol), token]));
    })().finally(() => {
      ondoTokenMapInflight = null;
    });
  }

  return ondoTokenMapInflight;
}

async function getPancakePool(tokenA: Address, tokenB: Address, fee: number): Promise<Address | null> {
  const pool = await bscClient.readContract({
    address: PANCAKE_V3_FACTORY,
    abi: pancakeFactoryAbi,
    functionName: "getPool",
    args: [tokenA, tokenB, fee],
  });

  return pool === ZERO_ADDRESS ? null : pool;
}

async function quotePancakeExactInput(
  tokenIn: Address,
  tokenOut: Address,
  amountIn: bigint,
  fee: number
): Promise<PancakeQuote> {
  const result = await bscClient.simulateContract({
    address: PANCAKE_V3_QUOTER_V2,
    abi: pancakeQuoterAbi,
    functionName: "quoteExactInputSingle",
    args: [{
      tokenIn,
      tokenOut,
      amountIn,
      fee,
      sqrtPriceLimitX96: 0n,
    }],
  });

  return {
    amountOut: result.result[0],
    gasEstimate: result.result[3],
  };
}

async function findSafeUsdtRoute(token: OndoToken): Promise<RwaSafeRoute | null> {
  const cacheKey = buildCacheKey("rwa:pancake:v3:safe-route", { address: token.address.toLowerCase() });
  const cached = await getJsonCacheEntry<RwaSafeRoute | null>(cacheKey);
  if (cached) return cached.value;

  const tokenAddress = token.address as Address;
  const candidates: Array<RwaSafeRoute | null> = await Promise.all(PANCAKE_V3_FEES.map(async (fee) => {
    try {
      const pool = await getPancakePool(BSC_USDT.address, tokenAddress, fee);
      if (!pool) return null;

      const buy = await quotePancakeExactInput(BSC_USDT.address, tokenAddress, ROUTE_TEST_USDT_RAW, fee);
      if (buy.amountOut <= 0n) return null;

      const sellBack = await quotePancakeExactInput(tokenAddress, BSC_USDT.address, buy.amountOut, fee);
      if (sellBack.amountOut <= 0n) return null;

      return {
        fee,
        pool,
        roundTripBps: Number((sellBack.amountOut * 10_000n) / ROUTE_TEST_USDT_RAW),
        testInputRaw: ROUTE_TEST_USDT_RAW.toString(),
        testTokenOutRaw: buy.amountOut.toString(),
        testSellBackRaw: sellBack.amountOut.toString(),
      } satisfies RwaSafeRoute;
    } catch {
      return null;
    }
  }));

  const safe = candidates
    .filter((candidate): candidate is RwaSafeRoute => Boolean(candidate))
    .filter((candidate) => candidate.roundTripBps >= MIN_ROUND_TRIP_BPS)
    .sort((a, b) => b.roundTripBps - a.roundTripBps)[0] ?? null;

  await setJsonCache(cacheKey, safe, 60, { staleTtlSeconds: 300 });
  return safe;
}

async function buildRouteHealth(asset: RwaAsset, region?: string): Promise<RwaRouteHealth> {
  const eligibility = regionEligibility(region);
  const blocked = eligibility.ondo.status === "blocked";
  let tokenMap: Map<string, OndoToken>;

  try {
    tokenMap = await fetchOndoTokenMap();
  } catch {
    return {
      symbol: asset.displaySymbol,
      status: "quote_adapter_unavailable",
      tradable: false,
      exitVerified: false,
      source: ONDO_TOKEN_LIST_URL,
      chain: { name: "BNB Chain", chainId: BNB_CHAIN_ID },
      token: { symbol: null, address: null, decimals: null },
      settlementAsset: BSC_USDT,
      buy: {
        enabled: false,
        status: "quote_adapter_unavailable",
        note: "Ondo token list is unavailable right now, so Rawli cannot verify the buy route.",
      },
      sell: {
        enabled: false,
        status: "quote_adapter_unavailable",
        note: "Ondo token list is unavailable right now, so Rawli cannot verify the sell route.",
      },
      copy: {
        primary: "Checking availability",
        secondary: "We're verifying this stock's trading route. Please check back shortly.",
      },
    };
  }

  const token = tokenMap.get(asset.quoteSymbol.toUpperCase()) ?? null;

  if (blocked) {
    return {
      symbol: asset.displaySymbol,
      status: "blocked",
      tradable: false,
      exitVerified: false,
      source: ONDO_TOKEN_LIST_URL,
      chain: { name: "BNB Chain", chainId: BNB_CHAIN_ID },
      token: token ? { symbol: token.symbol, address: token.address, decimals: token.decimals, logoURI: token.logoURI } : { symbol: null, address: null, decimals: null },
      settlementAsset: BSC_USDT,
      buy: {
        enabled: false,
        status: "blocked",
        note: "This region is blocked for Ondo Global Markets.",
      },
      sell: {
        enabled: false,
        status: "blocked",
        note: "This region is blocked for Ondo Global Markets.",
      },
      copy: {
        primary: "Not available in your region",
        secondary: "This stock isn't available for trading in your region.",
      },
    };
  }

  if (!token) {
    return {
      symbol: asset.displaySymbol,
      status: "watch_only",
      tradable: false,
      exitVerified: false,
      source: ONDO_TOKEN_LIST_URL,
      chain: { name: "BNB Chain", chainId: BNB_CHAIN_ID },
      token: { symbol: null, address: null, decimals: null },
      settlementAsset: BSC_USDT,
      buy: {
        enabled: false,
        status: "token_missing",
        note: "Ondo/PancakeSwap does not currently expose a BNB token contract for this asset.",
      },
      sell: {
        enabled: false,
        status: "token_missing",
        note: "No token contract means Rawli cannot verify an exit route yet.",
      },
      copy: {
        primary: "Coming soon",
        secondary: "You can track this stock's price, but trading isn't available yet.",
      },
    };
  }

  let safeRoute: RwaSafeRoute | null = null;
  try {
    safeRoute = await findSafeUsdtRoute(token);
  } catch {
    return {
      symbol: asset.displaySymbol,
      status: "quote_adapter_unavailable",
      tradable: false,
      exitVerified: false,
      source: ONDO_TOKEN_LIST_URL,
      chain: { name: "BNB Chain", chainId: BNB_CHAIN_ID },
      token: { symbol: token.symbol, address: token.address, decimals: token.decimals, logoURI: token.logoURI },
      settlementAsset: BSC_USDT,
      buy: {
        enabled: false,
        status: "quote_adapter_unavailable",
        note: "Rawli could not reach PancakeSwap route quotes right now.",
      },
      sell: {
        enabled: false,
        status: "quote_adapter_unavailable",
        note: "Rawli could not verify the sell route right now.",
      },
      copy: {
        primary: "Temporarily unavailable",
        secondary: "Trading is temporarily paused. Please try again in a moment.",
      },
    };
  }

  if (!safeRoute) {
    return {
      symbol: asset.displaySymbol,
      status: "route_unsafe",
      tradable: false,
      exitVerified: false,
      source: ONDO_TOKEN_LIST_URL,
      chain: { name: "BNB Chain", chainId: BNB_CHAIN_ID },
      token: { symbol: token.symbol, address: token.address, decimals: token.decimals, logoURI: token.logoURI },
      settlementAsset: BSC_USDT,
      buy: {
        enabled: false,
        status: "route_unsafe",
        note: "A pool may exist, but the live buy/sell spread is too wide for Rawli to enable it.",
      },
      sell: {
        enabled: false,
        status: "route_unsafe",
        note: "Sell is locked until a small round-trip quote returns at least 90% of the test input.",
      },
      copy: {
        primary: "Low liquidity",
        secondary: "This stock has low trading volume right now. Trading will unlock once liquidity improves.",
      },
    };
  }

  return {
    symbol: asset.displaySymbol,
    status: "tradable",
    tradable: true,
    exitVerified: true,
    source: ONDO_TOKEN_LIST_URL,
    chain: { name: "BNB Chain", chainId: BNB_CHAIN_ID },
    token: { symbol: token.symbol, address: token.address, decimals: token.decimals, logoURI: token.logoURI },
    settlementAsset: BSC_USDT,
    dex: {
      venue: "PancakeSwap V3",
      router: PANCAKE_V3_SWAP_ROUTER,
      quoter: PANCAKE_V3_QUOTER_V2,
      factory: PANCAKE_V3_FACTORY,
      fee: safeRoute.fee,
      pool: safeRoute.pool,
      roundTripBps: safeRoute.roundTripBps,
      testInputRaw: safeRoute.testInputRaw,
      testTokenOutRaw: safeRoute.testTokenOutRaw,
      testSellBackRaw: safeRoute.testSellBackRaw,
    },
    buy: {
      enabled: true,
      status: "enabled",
      note: "Live USDT buy route verified through PancakeSwap V3.",
    },
    sell: {
      enabled: true,
      status: "enabled",
      note: "Live USDT sell route verified through PancakeSwap V3.",
    },
    copy: {
      primary: "Ready to trade",
      secondary: "Buy and sell this stock using USDT. We verify both directions before enabling trading.",
    },
  };
}

async function buildCatalogRouteHealth(asset: RwaAsset, region?: string): Promise<RwaRouteHealth> {
  if (CATALOG_ROUTE_PREFETCH_SYMBOLS.has(asset.quoteSymbol.toUpperCase())) {
    return buildRouteHealth(asset, region);
  }

  const eligibility = regionEligibility(region);
  let tokenMap: Map<string, OndoToken>;

  try {
    tokenMap = await fetchOndoTokenMap();
  } catch {
    return {
      symbol: asset.displaySymbol,
      status: "quote_adapter_unavailable",
      tradable: false,
      exitVerified: false,
      source: ONDO_TOKEN_LIST_URL,
      chain: { name: "BNB Chain", chainId: BNB_CHAIN_ID },
      token: { symbol: null, address: null, decimals: null },
      settlementAsset: BSC_USDT,
      buy: {
        enabled: false,
        status: "quote_adapter_unavailable",
        note: "Ondo token list is unavailable right now, so Rawli cannot verify the buy route.",
      },
      sell: {
        enabled: false,
        status: "quote_adapter_unavailable",
        note: "Ondo token list is unavailable right now, so Rawli cannot verify the sell route.",
      },
      copy: {
        primary: "Checking availability",
        secondary: "We're verifying this stock's trading route. Please check back shortly.",
      },
    };
  }

  const token = tokenMap.get(asset.quoteSymbol.toUpperCase()) ?? null;
  const blocked = eligibility.ondo.status === "blocked";

  if (blocked) {
    return {
      symbol: asset.displaySymbol,
      status: "blocked",
      tradable: false,
      exitVerified: false,
      source: ONDO_TOKEN_LIST_URL,
      chain: { name: "BNB Chain", chainId: BNB_CHAIN_ID },
      token: token ? { symbol: token.symbol, address: token.address, decimals: token.decimals, logoURI: token.logoURI } : { symbol: null, address: null, decimals: null },
      settlementAsset: BSC_USDT,
      buy: {
        enabled: false,
        status: "blocked",
        note: "This region is blocked for Ondo Global Markets.",
      },
      sell: {
        enabled: false,
        status: "blocked",
        note: "This region is blocked for Ondo Global Markets.",
      },
      copy: {
        primary: "Not available in your region",
        secondary: "This stock isn't available for trading in your region.",
      },
    };
  }

  if (!token) {
    return {
      symbol: asset.displaySymbol,
      status: "watch_only",
      tradable: false,
      exitVerified: false,
      source: ONDO_TOKEN_LIST_URL,
      chain: { name: "BNB Chain", chainId: BNB_CHAIN_ID },
      token: { symbol: null, address: null, decimals: null },
      settlementAsset: BSC_USDT,
      buy: {
        enabled: false,
        status: "token_missing",
        note: "Ondo/PancakeSwap does not currently expose a BNB token contract for this asset.",
      },
      sell: {
        enabled: false,
        status: "token_missing",
        note: "No token contract means Rawli cannot verify an exit route yet.",
      },
      copy: {
        primary: "Coming soon",
        secondary: "You can track this stock's price, but trading isn't available yet.",
      },
    };
  }

  return {
    symbol: asset.displaySymbol,
    status: "watch_only",
    tradable: false,
    exitVerified: false,
    source: ONDO_TOKEN_LIST_URL,
    chain: { name: "BNB Chain", chainId: BNB_CHAIN_ID },
    token: { symbol: token.symbol, address: token.address, decimals: token.decimals, logoURI: token.logoURI },
    settlementAsset: BSC_USDT,
    buy: {
      enabled: false,
      status: "route_unsafe",
      note: "Select this asset to run a live PancakeSwap route check.",
    },
    sell: {
      enabled: false,
      status: "route_unsafe",
      note: "Sell unlocks only after Rawli verifies the same asset has a safe exit route.",
    },
    copy: {
      primary: "Route check on select",
      secondary: "This token is mapped on BNB Chain. Rawli runs the deeper buy/sell liquidity check when you open it.",
    },
  };
}

async function buildSwapQuote(
  asset: RwaAsset,
  token: OndoToken,
  side: "buy" | "sell",
  amount: string,
  slippageBps = DEFAULT_SLIPPAGE_BPS
) {
  const route = await findSafeUsdtRoute(token);
  if (!route) return null;

  const tokenIn = side === "buy" ? BSC_USDT : { symbol: token.symbol, address: token.address as Address, decimals: token.decimals };
  const tokenOut = side === "buy" ? { symbol: token.symbol, address: token.address as Address, decimals: token.decimals } : BSC_USDT;
  const amountInRaw = parseUnits(amount, tokenIn.decimals);
  if (amountInRaw <= 0n) return null;

  const quoted = await quotePancakeExactInput(tokenIn.address, tokenOut.address, amountInRaw, route.fee);
  const amountOutMinimumRaw = (quoted.amountOut * BigInt(10_000 - slippageBps)) / 10_000n;

  return {
    symbol: asset.displaySymbol,
    side,
    venue: "PancakeSwap V3",
    chainId: BNB_CHAIN_ID,
    router: PANCAKE_V3_SWAP_ROUTER,
    spender: PANCAKE_V3_SWAP_ROUTER,
    quoter: PANCAKE_V3_QUOTER_V2,
    factory: PANCAKE_V3_FACTORY,
    fee: route.fee,
    pool: route.pool,
    slippageBps,
    roundTripBps: route.roundTripBps,
    tokenIn: {
      symbol: tokenIn.symbol,
      address: tokenIn.address,
      decimals: tokenIn.decimals,
    },
    tokenOut: {
      symbol: tokenOut.symbol,
      address: tokenOut.address,
      decimals: tokenOut.decimals,
    },
    amountInRaw: amountInRaw.toString(),
    amountInHuman: formatUnits(amountInRaw, tokenIn.decimals),
    amountOutRaw: quoted.amountOut.toString(),
    amountOutHuman: formatUnits(quoted.amountOut, tokenOut.decimals),
    amountOutMinimumRaw: amountOutMinimumRaw.toString(),
    amountOutMinimumHuman: formatUnits(amountOutMinimumRaw, tokenOut.decimals),
    gasEstimate: quoted.gasEstimate.toString(),
    generatedAt: new Date().toISOString(),
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
    headers: { Accept: "application/json", "User-Agent": "Rawli/1.0" },
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) {
    throw new Error(`quote_upstream_${res.status}`);
  }

  const payload = await res.json() as any;
  const result = payload?.chart?.result?.[0];
  const meta = result?.meta ?? {};
  const indicator = result?.indicators?.quote?.[0] ?? {};
  const closes = (indicator?.close ?? []).filter((value: unknown) => Number.isFinite(Number(value)));
  const volumes = (indicator?.volume ?? []).filter((value: unknown) => Number.isFinite(Number(value)));
  const price = finiteOrNull(meta.regularMarketPrice) ?? finiteOrNull(closes.at(-1));
  const previousClose = finiteOrNull(meta.chartPreviousClose) ?? finiteOrNull(closes.at(-2));
  const change = price !== null && previousClose !== null ? price - previousClose : null;
  const changePct = change !== null && previousClose ? (change / previousClose) * 100 : null;
  const volume = finiteOrNull(meta.regularMarketVolume) ?? finiteOrNull(volumes.at(-1));

  const quote: RwaQuote = {
    symbol: normalized,
    price,
    previousClose,
    change,
    changePct,
    volume,
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
    const region = query.data.region;
    const routes = await Promise.all(assets.map((asset) => buildCatalogRouteHealth(asset, region)));
    const routeBySymbol = new Map(routes.map((route) => [route.symbol, route]));

    return {
      ok: true,
      assets: assets.map((asset) => ({
        ...asset,
        route: routeBySymbol.get(asset.displaySymbol),
      })),
      eligibility: regionEligibility(region),
      disclaimers: [
        "Tokenized stock products are not direct shareholder ownership.",
        "Rawli stock trading is buy/sell through PancakeSwap secondary liquidity. Rawli does not expose an issuer cash-out path.",
        "Direct Ondo issuer onboarding or issuer cash-out may require Ondo checks. Rawli only routes wallet-side swaps when available.",
        "Buy buttons remain locked until the same asset also has a live sell route quoteable in the same session.",
      ],
    };
  });

  app.get("/rwa/route/health", async (req, reply) => {
    const query = routeQuerySchema.safeParse(req.query ?? {});
    if (!query.success) {
      reply.status(400);
      return { ok: false, error: "invalid_rwa_route_query" };
    }

    const normalized = query.data.symbol.toUpperCase();
    const asset = assets.find((item) =>
      item.displaySymbol.toUpperCase() === normalized ||
      item.symbol.toUpperCase() === normalized ||
      item.id.toUpperCase() === normalized
    );
    if (!asset) {
      reply.status(404);
      return { ok: false, error: "rwa_asset_not_found" };
    }

    return {
      ok: true,
      route: await buildRouteHealth(asset, query.data.region),
    };
  });

  app.get("/rwa/swap/quote", async (req, reply) => {
    const query = swapQuoteQuerySchema.safeParse(req.query ?? {});
    if (!query.success) {
      reply.status(400);
      return { ok: false, error: "invalid_rwa_swap_quote_query" };
    }

    const normalized = query.data.symbol.toUpperCase();
    const asset = assets.find((item) =>
      item.displaySymbol.toUpperCase() === normalized ||
      item.symbol.toUpperCase() === normalized ||
      item.id.toUpperCase() === normalized
    );
    if (!asset) {
      reply.status(404);
      return { ok: false, error: "rwa_asset_not_found" };
    }

    try {
      const tokenMap = await fetchOndoTokenMap();
      const token = tokenMap.get(asset.quoteSymbol.toUpperCase()) ?? null;
      if (!token) {
        reply.status(404);
        return { ok: false, error: "rwa_token_not_mapped" };
      }

      const quote = await buildSwapQuote(
        asset,
        token,
        query.data.side,
        query.data.amount,
        query.data.slippageBps ?? DEFAULT_SLIPPAGE_BPS
      );

      if (!quote) {
        reply.status(409);
        return {
          ok: false,
          error: "rwa_route_not_safe",
          message: "No safe two-way PancakeSwap route is available for this stock right now.",
        };
      }

      return { ok: true, quote };
    } catch (err) {
      req.log.warn({ err, symbol: query.data.symbol, side: query.data.side }, "rwa swap quote unavailable");
      reply.status(502);
      return { ok: false, error: "rwa_swap_quote_unavailable" };
    }
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
        .slice(0, 80)
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
