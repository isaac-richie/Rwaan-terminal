"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, BarChart3, Bitcoin, Loader2 } from "lucide-react";
import { ColorType, CrosshairMode, IChartApi, createChart } from "lightweight-charts";
import { cn } from "@/lib/utils";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

type CryptoAsset =
  | "BTC" | "ETH" | "BNB" | "SOL" | "XRP" | "DOGE"
  | "ADA" | "AVAX" | "LINK" | "DOT" | "POL" | "MATIC" | "TRX" | "TON"
  | "SHIB" | "PEPE" | "WIF" | "BONK" | "RENDER" | "NEAR" | "SUI" | "APT"
  | "ARB" | "OP" | "UNI" | "LTC" | "BCH";
type ChartRange = "1D" | "1W" | "1M" | "3M" | "1Y";

type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

type ChartPayload = {
  asset: CryptoAsset;
  name: string;
  quote: string;
  range: ChartRange;
  source: string;
  currentPrice: number | null;
  changePct: number | null;
  candles: Candle[];
};

const ranges: ChartRange[] = ["1D", "1W", "1M", "3M", "1Y"];

const assetMeta: Record<CryptoAsset, { color: string; soft: string; name: string }> = {
  BTC: { color: "#f59e0b", soft: "rgba(245, 158, 11, 0.16)", name: "Bitcoin" },
  ETH: { color: "#818cf8", soft: "rgba(129, 140, 248, 0.16)", name: "Ethereum" },
  BNB: { color: "#f0b90b", soft: "rgba(240, 185, 11, 0.16)", name: "BNB" },
  SOL: { color: "#14f195", soft: "rgba(20, 241, 149, 0.14)", name: "Solana" },
  XRP: { color: "#94a3b8", soft: "rgba(148, 163, 184, 0.14)", name: "XRP" },
  DOGE: { color: "#d4a84f", soft: "rgba(212, 168, 79, 0.14)", name: "Dogecoin" },
  ADA: { color: "#3b82f6", soft: "rgba(59, 130, 246, 0.14)", name: "Cardano" },
  AVAX: { color: "#ef4444", soft: "rgba(239, 68, 68, 0.14)", name: "Avalanche" },
  LINK: { color: "#2563eb", soft: "rgba(37, 99, 235, 0.14)", name: "Chainlink" },
  DOT: { color: "#ec4899", soft: "rgba(236, 72, 153, 0.14)", name: "Polkadot" },
  POL: { color: "#a855f7", soft: "rgba(168, 85, 247, 0.14)", name: "Polygon" },
  MATIC: { color: "#a855f7", soft: "rgba(168, 85, 247, 0.14)", name: "Polygon" },
  TRX: { color: "#ef4444", soft: "rgba(239, 68, 68, 0.14)", name: "TRON" },
  TON: { color: "#38bdf8", soft: "rgba(56, 189, 248, 0.14)", name: "Toncoin" },
  SHIB: { color: "#f97316", soft: "rgba(249, 115, 22, 0.14)", name: "Shiba Inu" },
  PEPE: { color: "#22c55e", soft: "rgba(34, 197, 94, 0.14)", name: "Pepe" },
  WIF: { color: "#facc15", soft: "rgba(250, 204, 21, 0.14)", name: "dogwifhat" },
  BONK: { color: "#fb923c", soft: "rgba(251, 146, 60, 0.14)", name: "Bonk" },
  RENDER: { color: "#f43f5e", soft: "rgba(244, 63, 94, 0.14)", name: "Render" },
  NEAR: { color: "#10b981", soft: "rgba(16, 185, 129, 0.14)", name: "NEAR" },
  SUI: { color: "#0ea5e9", soft: "rgba(14, 165, 233, 0.14)", name: "Sui" },
  APT: { color: "#a3e635", soft: "rgba(163, 230, 53, 0.14)", name: "Aptos" },
  ARB: { color: "#60a5fa", soft: "rgba(96, 165, 250, 0.14)", name: "Arbitrum" },
  OP: { color: "#ef4444", soft: "rgba(239, 68, 68, 0.14)", name: "Optimism" },
  UNI: { color: "#ff4ecd", soft: "rgba(255, 78, 205, 0.14)", name: "Uniswap" },
  LTC: { color: "#64748b", soft: "rgba(100, 116, 139, 0.14)", name: "Litecoin" },
  BCH: { color: "#16a34a", soft: "rgba(22, 163, 74, 0.14)", name: "Bitcoin Cash" },
};

const lowPriceAssets = new Set<CryptoAsset>(["DOGE", "ADA", "XRP", "SHIB", "PEPE", "WIF", "BONK", "TRX"])

function hasToken(text: string, token: string) {
  return new RegExp(`(^|[^a-z0-9])${token}([^a-z0-9]|$)`, "i").test(text);
}

function formatUsd(value?: number | null) {
  if (!Number.isFinite(value ?? NaN)) return "$--";
  const price = Number(value);
  if (price >= 1000) {
    return price.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  }
  if (price >= 1) {
    return price.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
  }
  return price.toLocaleString("en-US", { style: "currency", currency: "USD", maximumSignificantDigits: 4 });
}

function formatPct(value?: number | null) {
  if (!Number.isFinite(value ?? NaN)) return "--";
  const sign = Number(value) > 0 ? "+" : "";
  return `${sign}${Number(value).toFixed(2)}%`;
}

export function detectCryptoAsset(input: { title?: string; category?: string; description?: string }): CryptoAsset | null {
  const haystack = `${input.category ?? ""} ${input.title ?? ""} ${input.description ?? ""}`.toLowerCase();
  const candidates: Array<[CryptoAsset, Array<string | RegExp>]> = [
    ["BTC", ["bitcoin", /\bbtc\b/i]],
    ["ETH", ["ethereum", "ether", /\beth\b/i]],
    ["BNB", [/\bbnb\b/i, "binance coin"]],
    ["SOL", ["solana", /\bsol\b/i]],
    ["XRP", [/\bxrp\b/i, "ripple"]],
    ["DOGE", ["dogecoin", /\bdoge\b/i]],
    ["ADA", ["cardano", /\bada\b/i]],
    ["AVAX", ["avalanche", /\bavax\b/i]],
    ["LINK", ["chainlink", /\blink\b/i]],
    ["DOT", ["polkadot", /\bdot\b/i]],
    ["POL", ["polygon", /\bpol\b/i, /\bmatic\b/i]],
    ["TRX", ["tron", /\btrx\b/i]],
    ["TON", ["toncoin", /\bton\b/i]],
    ["SHIB", ["shiba", /\bshib\b/i]],
    ["PEPE", [/\bpepe\b/i]],
    ["WIF", ["dogwifhat", /\bwif\b/i]],
    ["BONK", [/\bbonk\b/i]],
    ["RENDER", ["render", /\brndr\b/i]],
    ["NEAR", ["near protocol", /\bnear\b/i]],
    ["SUI", [/\bsui\b/i]],
    ["APT", ["aptos", /\bapt\b/i]],
    ["ARB", ["arbitrum", /\barb\b/i]],
    ["OP", ["optimism"]],
    ["UNI", ["uniswap", /\buni\b/i]],
    ["LTC", ["litecoin", /\bltc\b/i]],
    ["BCH", ["bitcoin cash", /\bbch\b/i]],
  ];
  return (
    candidates.find(([, needles]) =>
      needles.some((needle) => (typeof needle === "string" ? hasToken(haystack, needle) : needle.test(haystack))),
    )?.[0] ?? null
  );
}

export function CryptoAssetChart({ asset, marketTitle }: { asset: CryptoAsset; marketTitle: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ReturnType<IChartApi["addCandlestickSeries"]> | null>(null);
  const [range, setRange] = useState<ChartRange>("1M");
  const [payload, setPayload] = useState<ChartPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const meta = assetMeta[asset];
  const isUp = (payload?.changePct ?? 0) >= 0;

  const chartOptions = useMemo(
    () => ({
      height: 360,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#8c8f96",
        fontFamily: "var(--font-inter)",
      },
      grid: {
        vertLines: { color: "rgba(148, 163, 184, 0.06)" },
        horzLines: { color: "rgba(148, 163, 184, 0.08)" },
      },
      crosshair: {
        mode: CrosshairMode.Magnet,
        vertLine: { color: "rgba(240, 185, 11, 0.26)" },
        horzLine: { color: "rgba(240, 185, 11, 0.26)" },
      },
      rightPriceScale: {
        borderColor: "rgba(148, 163, 184, 0.12)",
      },
      timeScale: {
        borderColor: "rgba(148, 163, 184, 0.12)",
        timeVisible: true,
      },
    }),
    [],
  );

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, chartOptions as any);
    chartRef.current = chart;
    const series = chart.addCandlestickSeries({
      upColor: "#22c55e",
      downColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
      borderVisible: false,
      priceFormat: {
        type: "price",
        precision: lowPriceAssets.has(asset) ? 4 : 2,
        minMove: lowPriceAssets.has(asset) ? 0.0001 : 0.01,
      },
    });
    seriesRef.current = series;

    const resize = () => {
      if (!containerRef.current) return;
      chart.applyOptions({ width: containerRef.current.clientWidth });
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [asset, chartOptions]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const url = new URL(`${API_BASE}/crypto/chart`);
        url.searchParams.set("asset", asset);
        url.searchParams.set("range", range);
        const res = await fetch(url.toString());
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "crypto_chart_unavailable");
        if (cancelled) return;
        setPayload(data);
        seriesRef.current?.setData(data.candles ?? []);
        chartRef.current?.timeScale().fitContent();
      } catch {
        if (!cancelled) {
          setError("Live crypto chart is unavailable right now.");
          setPayload(null);
          seriesRef.current?.setData([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [asset, range]);

  return (
    <section className="surface-card overflow-hidden rounded-2xl border-[oklch(0.22_0.015_255)]">
      <div className="relative border-b border-[oklch(0.22_0.015_255)] px-4 py-4 sm:px-5">
        <div
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{
            background: `radial-gradient(circle at 10% 0%, ${meta.soft}, transparent 38%), linear-gradient(180deg, rgba(255,255,255,0.025), transparent)`,
          }}
        />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10"
              style={{ background: meta.soft, color: meta.color }}
            >
              {asset === "BTC" ? <Bitcoin className="h-6 w-6" /> : <span className="text-sm font-black">{asset}</span>}
            </div>
            <div className="min-w-0">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-[oklch(0.78_0.16_82/0.22)] bg-[oklch(0.78_0.16_82/0.08)] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.22em] text-[oklch(0.78_0.16_82)]">
                  Crypto tape
                </span>
                <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  {payload?.source ?? "Live market"} spot feed
                </span>
              </div>
              <h2 className="text-lg font-bold leading-tight text-foreground sm:text-xl">
                {meta.name} market structure
              </h2>
              <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                Live {asset}/USDT spot price alongside this market's prediction odds.
              </p>
            </div>
          </div>

          <div className="grid w-full min-w-0 grid-cols-2 gap-2 sm:w-auto sm:min-w-[210px] sm:text-right">
            <div className="min-w-0 rounded-xl border border-[oklch(0.22_0.015_255)] bg-black/20 px-2.5 py-3">
              <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Spot</div>
              <div className="mt-1 max-w-full overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[clamp(0.95rem,1.2vw,1.125rem)] font-bold tabular-nums text-foreground">
                {formatUsd(payload?.currentPrice)}
              </div>
            </div>
            <div className="min-w-0 rounded-xl border border-[oklch(0.22_0.015_255)] bg-black/20 px-2.5 py-3">
              <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{range}</div>
              <div className={cn("mt-1 max-w-full overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[clamp(0.95rem,1.2vw,1.125rem)] font-bold tabular-nums", isUp ? "text-[oklch(0.68_0.18_155)]" : "text-[oklch(0.62_0.18_25)]")}>
                {formatPct(payload?.changePct)}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="px-4 pt-4 sm:px-5">
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
            <Activity className="h-3.5 w-3.5 text-[oklch(0.78_0.16_82)]" />
            <span className="truncate">{marketTitle}</span>
          </div>
          <div className="flex items-center gap-1 rounded-xl border border-[oklch(0.22_0.015_255)] bg-[oklch(0.12_0.012_255)] p-1">
            {ranges.map((item) => (
              <button
                key={item}
                onClick={() => setRange(item)}
                className={cn(
                  "h-8 min-w-10 rounded-lg px-2 text-[10px] font-bold transition-colors",
                  range === item
                    ? "bg-[oklch(0.78_0.16_82)] text-black"
                    : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground",
                )}
              >
                {item}
              </button>
            ))}
          </div>
        </div>
        <div className="relative min-h-[360px] overflow-hidden rounded-xl border border-[oklch(0.18_0.014_255)] bg-[oklch(0.09_0.01_255)]">
          <div ref={containerRef} className="h-[360px] w-full" />
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-[oklch(0.09_0.01_255/0.65)] text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading crypto tape
            </div>
          )}
          {!loading && error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[oklch(0.09_0.01_255)] text-center">
              <BarChart3 className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm font-semibold text-foreground">{error}</p>
              <p className="max-w-sm text-xs text-muted-foreground">
                The prediction market remains tradable. Refresh this panel or try another range.
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground sm:px-5">
        <span>External spot chart</span>
        <span>Prediction odds stay powered by Polymarket liquidity</span>
      </div>
    </section>
  );
}
