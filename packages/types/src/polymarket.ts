export type GammaMarket = {
  id?: string;
  question?: string;
  active?: boolean;
  volume?: number;
  liquidity?: number;
  tags?: string[];
  category?: string;
  outcomePrices?: number[] | string[];
  outcome_prices?: number[] | string[];
  outcomes?: string[];
  clobTokenIds?: string[];
  clob_token_ids?: string[];
  enableOrderBook?: boolean;
  enable_order_book?: boolean;
  image?: string;
  image_url?: string;
  imageUrl?: string;
  icon?: string;
  icon_url?: string;
  endDate?: string;
  end_date?: string;
  volume_24hr?: number | string;
  volume_24h?: number | string;
};

export type GammaEvent = {
  id?: string;
  title?: string;
  category?: string;
  tags?: string[];
  active?: boolean;
  closed?: boolean;
  markets?: GammaMarket[];
};

export type GeoblockResponse = {
  blocked?: boolean;
  country?: string;
  region?: string;
  message?: string;
};

export type BridgeSupportedAsset = {
  chainId: string;
  chainName: string;
  token: {
    name: string;
    symbol: string;
    address: string;
    decimals: number;
  };
  minCheckoutUsd?: number;
};

export type BridgeSupportedAssetsResponse = {
  supportedAssets?: BridgeSupportedAsset[];
};

export type BridgeQuoteRequest = {
  fromAmountBaseUnit: string;
  fromChainId: string;
  fromTokenAddress: string;
  recipientAddress: string;
  toChainId: string;
  toTokenAddress: string;
};

export type BridgeQuoteResponse = {
  estCheckoutTimeMs?: number;
  estFeeBreakdown?: Record<string, number | string>;
  estInputUsd?: number;
  estOutputUsd?: number;
  estToTokenBaseUnit?: string;
  quoteId?: string;
};

export type BridgeDepositRequest = {
  address: string;
};

export type BridgeDepositResponse = {
  address?: {
    evm?: string;
    svm?: string;
    btc?: string;
    tvm?: string;
  };
  note?: string;
};

export type BridgeWithdrawRequest = {
  address: string;
  toChainId: string;
  toTokenAddress: string;
  recipientAddr: string;
};

export type BridgeTransaction = {
  fromChainId?: string;
  fromTokenAddress?: string;
  fromAmountBaseUnit?: string;
  toChainId?: string;
  toTokenAddress?: string;
  status?: "DEPOSIT_DETECTED" | "PROCESSING" | "ORIGIN_TX_CONFIRMED" | "SUBMITTED" | "COMPLETED" | "FAILED" | string;
  txHash?: string;
  createdTimeMs?: number;
};

export type BridgeStatusResponse = {
  transactions?: BridgeTransaction[];
};

export type FundingStatusPhase = "not_started" | "detected" | "processing" | "completed" | "failed";

export type FundingStatusResponse = BridgeStatusResponse & {
  ok: boolean;
  depositAddress: string;
  latest?: BridgeTransaction;
  phase: FundingStatusPhase;
  label: string;
  message: string;
  updatedAt: string;
};

export type PolymarketConfig = {
  geoblockUrl: string;
  bridgeBaseUrl: string;
  clobBaseUrl: string;
  gammaBaseUrl: string;
  dataBaseUrl: string;
};

export type OrderValidationRequest = {
  price: number;
  size: number;
  tokenId: string;
  side: "buy" | "sell";
  signature?: {
    address?: string;
    signature?: string;
    timestamp?: string;
    nonce?: string;
  };
};

export type OrderValidationResponse = {
  ok: boolean;
  error?: string;
  message?: string;
  bestPrice?: number | null;
  bestSize?: number;
};

export type TradePreviewRequest = {
  marketId: string;
  tokenId: string;
  outcome: string;
  side: "BUY" | "SELL";
  amountUsd: number;
  tradingWalletAddress?: string;
};

export type TradePreviewWarning = {
  code:
    | "amount_below_min_order_size"
    | "balance_not_checked"
    | "insufficient_visible_liquidity"
    | "neg_risk_market"
    | "no_orderbook";
  message: string;
  severity: "info" | "warning";
};

export type PlatformFee = {
  bps: number;
  amount: number;
  label: string;
};

export type TradeInsight = {
  signal: "bullish" | "bearish" | "neutral";
  headline: string;
  keyRisk: string;
  context: string;
  signalStrength: number;
};

export type TradePreviewResponse = {
  ok: boolean;
  error?: string;
  marketId?: string;
  tokenId?: string;
  outcome?: string;
  side?: "BUY" | "SELL";
  amountUsd?: number;
  tradingWalletAddress?: string;
  filledAmountUsd?: number;
  unfilledAmountUsd?: number;
  estimatedShares?: number;
  avgPrice?: number | null;
  maxPrice?: number | null;
  bestAsk?: number | null;
  minOrderSize?: number | null;
  tickSize?: number | null;
  warnings?: TradePreviewWarning[];
  platformFee?: PlatformFee;
  tradeInsight?: TradeInsight;
};

export type TradeReadinessStatus = "ready" | "pending" | "auth_required" | "blocked" | "unavailable";

export type TradeReadinessCheckCode =
  | "wallet_linked"
  | "trading_profile"
  | "funding_deposit"
  | "clob_session"
  | "collateral_balance_allowance"
  | "order_signing";

export type TradeReadinessCheck = {
  code: TradeReadinessCheckCode;
  label: string;
  status: TradeReadinessStatus;
  message: string;
};

export type BalanceAllowanceSnapshot = {
  balance: string;
  allowance: string;
  assetType: "COLLATERAL" | "CONDITIONAL";
  tokenId?: string;
};

export type TradeReadinessRequest = {
  connectedWalletAddress?: string;
  tradingWalletAddress?: string;
  tradingWalletKind?: TradingWalletKind;
  depositAddress?: string;
  marketId?: string;
  tokenId?: string;
  amountUsd?: number;
};

export type TradeReadinessResponse = {
  ok: boolean;
  canPreview: boolean;
  canExecute: boolean;
  executionLockedReason: string;
  auth: {
    clobSessionPresent: boolean;
    clobSessionRequired: boolean;
  };
  checks: TradeReadinessCheck[];
  collateral?: BalanceAllowanceSnapshot;
  conditional?: BalanceAllowanceSnapshot;
  error?: string;
};

export type TradingWalletKind = "eoa" | "safe" | "proxy" | "deposit";

export type TradingProfileStatus = "wallet_linked" | "deposit_ready" | "funded" | "blocked";

export type TradingProfile = {
  connectedWalletAddress: string;
  tradingWalletAddress: string;
  tradingWalletKind: TradingWalletKind;
  status: TradingProfileStatus;
  fundingChainId: "56";
  depositAddress?: {
    evm?: string;
    svm?: string;
    btc?: string;
    tvm?: string;
  };
  createdAt: string;
  updatedAt: string;
};

export type AnalysisVerdict = {
  direction: "YES" | "NO";
  confidence: number;
  rationale: string;
};

export type PremiumNewsSource = {
  title: string;
  url: string;
  summary: string;
};

export type PremiumAnalysis = {
  verdict: AnalysisVerdict;
  eventBrief: string;
  globalContext: string;
  structuralDrivers: string[];
  marketSignalInterpretation: string;
  informationAsymmetry: string;
  riskLandscape: string[];
  strategicInsight: string;
  terminalNote: string;
  newsSources: PremiumNewsSource[];
  generatedAt: string;
  signalHash: string;
  // Populated for crypto markets only
  technicalAnalysis?: PremiumTechnicalAnalysis;
  // Populated for non-crypto markets only
  fundamentalAnalysis?: PremiumFundamentalAnalysis;
  // Model-vs-market probability breakdown (crypto price markets only). `edge` is the
  // divergence between our model and the market price — the mispricing signal.
  probabilityModel?: {
    modelProbability: number;
    marketProbability: number | null;
    blendedProbability: number;
    edge: number | null;
  };
};

export type PaymentRequirement = {
  chainId: number;
  tokenContract: string;
  tokenSymbol: string;
  tokenDecimals: number;
  receiver: string;
  amountRaw: string;
  amountHuman: string;
};

export type PremiumAnalysisResponse = {
  ok: boolean;
  marketId?: string;
  analysis?: PremiumAnalysis;
  error?: string;
  paymentRequired?: PaymentRequirement;
};

// ── Fundamental signal engine types (non-crypto markets) ─────────────────────

export type MarketCategory =
  | "politics"
  | "economics"
  | "sports"
  | "science_tech"
  | "legal"
  | "general";

export type FundamentalSignal = {
  name: string;
  direction: "YES" | "NO" | "neutral";
  weight: number;
  conviction: number;
  reason: string;
};

export type PremiumFundamentalAnalysis = {
  direction: "YES" | "NO";
  confidence: number;
  yesScore: number;
  noScore: number;
  netScore: number;
  signals: FundamentalSignal[];
  verdictRationale: string;
  impliedProbability: number;
  priceEfficiency: "efficient" | "potentially_mispriced" | "thin_market";
  daysToResolution: number | null;
  category: MarketCategory;
};

// ── Quant Engine TA types (mirrors ta-engine.ts, safe to import on frontend) ──

export type TASignalVote = {
  name: string;
  direction: "bullish" | "bearish" | "neutral";
  weight: number;
  conviction: number;
  reason: string;
};

export type TAComputedVerdict = {
  direction: "YES" | "NO";
  confidence: number;
  bullishScore: number;
  bearishScore: number;
  netScore: number;
  signalAgreement: number;
  totalSignals: number;
  agreeingSignals: number;
  votes: TASignalVote[];
  regimeAdjustment: number;
  contrariansFlags: string[];
  verdictRationale: string;
};

export type TAOpenInterest = {
  current: number;
  change24h: number;
  trend: "rising" | "falling" | "flat";
  signal: "bullish" | "bearish" | "neutral";
  interpretation: string;
};

export type TALongShort = {
  globalLongPct: number;
  globalShortPct: number;
  topTraderLongPct: number;
  topTraderShortPct: number;
  retailBias: "long_heavy" | "short_heavy" | "balanced";
  smartMoneyBias: "long_heavy" | "short_heavy" | "balanced";
  contrarian: "bullish" | "bearish" | "neutral";
  interpretation: string;
};

export type TATakerRatio = {
  buyRatio: number;
  sellRatio: number;
  trend: "buyers_dominant" | "sellers_dominant" | "balanced";
  strength: "strong" | "moderate" | "weak";
  interpretation: string;
};

export type PremiumTechnicalAnalysis = {
  symbol: string;
  currentPrice: number;
  structure: string;
  trendStrength: number;
  bias: string;
  swingHigh: number | null;
  swingLow: number | null;
  ema: {
    ema9: number;
    ema21: number;
    ema50: number;
    ema200: number;
    stack: "bullish" | "bearish" | "compressed" | "mixed";
  };
  macd: {
    macd: number;
    signal: number;
    histogram: number;
    trend: string;
    histogramTrend: string;
    crossover: string | null;
  };
  bollinger: {
    upper: number;
    middle: number;
    lower: number;
    bandwidth: number;
    squeeze: boolean;
    percentB: number;
  };
  rsi14: number;
  rsiDivergence: { type: "bullish" | "bearish"; strength: "weak" | "moderate" | "strong" } | null;
  multiTfRsi: { tf4h: number; tf1h: number; tf15m: number; alignment: string };
  obv: { trend: "rising" | "falling" | "flat"; divergence: { type: "bullish" | "bearish" } | null };
  volumeProfile: string;
  nearestSupport: number | null;
  nearestResistance: number | null;
  vwapDistance: number;
  volatilityPct: number;
  regime: string;
  funding: { fundingRate: number; nextFunding: string } | null;
  fearGreed: { value: number; classification: string } | null;
  openInterest: TAOpenInterest | null;
  longShort: TALongShort | null;
  takerRatio: TATakerRatio | null;
  confluenceScore: number;
  confluenceFactors: string[];
  computedVerdict: TAComputedVerdict;
  riskReward: {
    longEntry: number;
    longStop: number;
    longTarget: number;
    longRR: number;
    shortEntry: number;
    shortStop: number;
    shortTarget: number;
    shortRR: number;
  } | null;
};
