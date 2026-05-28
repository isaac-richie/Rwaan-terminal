import { config as loadEnv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultConfig } from "@smartmarket/config";

loadEnv();
loadEnv({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env"), override: true });

const openaiModel = process.env.OPENAI_MODEL?.trim() || "gpt-5-mini";

export const config = {
  port: Number(process.env.PORT ?? 4000),
  host: process.env.HOST ?? "0.0.0.0",
  openai: {
    apiKey: process.env.OPENAI_API_KEY ?? "",
    model: openaiModel
  },
  polymarket: {
    geoblockUrl: process.env.POLYMARKET_GEOBLOCK_URL ?? defaultConfig.polymarket.geoblockUrl,
    bridgeBaseUrl: process.env.POLYMARKET_BRIDGE_BASE_URL ?? defaultConfig.polymarket.bridgeBaseUrl,
    clobBaseUrl: process.env.POLYMARKET_CLOB_BASE_URL ?? defaultConfig.polymarket.clobBaseUrl,
    gammaBaseUrl: process.env.POLYMARKET_GAMMA_BASE_URL ?? defaultConfig.polymarket.gammaBaseUrl,
    dataBaseUrl: process.env.POLYMARKET_DATA_BASE_URL ?? defaultConfig.polymarket.dataBaseUrl,
    relayerUrl: process.env.POLYMARKET_RELAYER_URL ?? "https://relayer-v2.polymarket.com",
    builderCreds: {
      key: process.env.POLYMARKET_BUILDER_API_KEY ?? "",
      secret: process.env.POLYMARKET_BUILDER_SECRET ?? "",
      passphrase: process.env.POLYMARKET_BUILDER_PASSPHRASE ?? ""
    }
  },
  kalshi: {
    baseUrl: process.env.KALSHI_BASE_URL ?? "https://api.elections.kalshi.com/trade-api/v2"
  },
  fees: {
    platformFeeBps: Number(process.env.PLATFORM_FEE_BPS ?? 50),
    enabled: process.env.ENABLE_PLATFORM_FEE !== "false"
  },
  gasAssist: {
    enabled: process.env.GAS_ASSIST_ENABLED === "true",
    polygonRpcUrl: process.env.POLYGON_RPC_URL ?? "https://polygon-rpc.com",
    relayerPrivateKey: process.env.POLYGON_GAS_RELAYER_PRIVATE_KEY ?? "",
    minPusdBalance: process.env.GAS_ASSIST_MIN_PUSD_BALANCE ?? "2",
    minPolBalance: process.env.GAS_ASSIST_MIN_POL_BALANCE ?? "0.02",
    topupPol: process.env.GAS_ASSIST_TOPUP_POL ?? "0.05",
    maxTopupPol: process.env.GAS_ASSIST_MAX_TOPUP_POL ?? "0.08",
    cooldownHours: Number(process.env.GAS_ASSIST_COOLDOWN_HOURS ?? 24)
  },
  payment: {
    receiverAddress: process.env.PAYMENT_RECEIVER_ADDRESS ?? "",
    // Primary RPC — set BSC_RPC_URL to your premium endpoint (NodeReal / QuickNode / Ankr)
    // Falls back through a prioritised list of public nodes if primary fails
    bscRpcUrl: process.env.BSC_RPC_URL ?? "https://bsc-dataseed1.binance.org",
    // Ordered fallback list — tried in sequence when the primary fails
    // Add your premium URL as BSC_RPC_URL and it will always be tried first
    bscRpcFallbacks: [
      "https://bsc-dataseed1.binance.org",
      "https://bsc-dataseed2.binance.org",
      "https://bsc-dataseed3.binance.org",
      "https://bsc-dataseed4.binance.org",
      "https://bsc.publicnode.com",           // unlimited, community run
      "https://rpc.ankr.com/bsc",             // 30 req/s free tier
      "https://bsc-dataseed1.defibit.io",
      "https://bsc-dataseed1.ninicoin.io",
    ],
    usdtContract: "0x55d398326f99059fF775485246999027B3197955",
    usdtDecimals: 18,
    priceRaw: "1000000000000000000",
    priceHuman: "1.00",
    txMaxAgeSeconds: Number(process.env.PAYMENT_TX_MAX_AGE ?? 600)
  }
};
