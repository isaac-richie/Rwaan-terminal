"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createChart, ColorType, CrosshairMode, IChartApi } from "lightweight-charts";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

type PricePoint = { t: number; p: number };

type Timeframe = {
  id: "1H" | "6H" | "1D" | "1W" | "1M";
  minutes: number;
  interval: string; // Polymarket CLOB interval param
  fidelity: number; // data points per interval
};

const timeframes: Timeframe[] = [
  { id: "1H", minutes: 1,   interval: "1h",  fidelity: 60  },
  { id: "6H", minutes: 5,   interval: "6h",  fidelity: 60  },
  { id: "1D", minutes: 15,  interval: "1d",  fidelity: 60  },
  { id: "1W", minutes: 60,  interval: "1w",  fidelity: 60  },
  { id: "1M", minutes: 240, interval: "max", fidelity: 30  },
];

function normalizePoints(raw: any): PricePoint[] {
  if (!raw) return [];
  // Polymarket wraps history in { history: [...] }
  if (raw && typeof raw === "object" && Array.isArray(raw.history)) raw = raw.history;
  if (Array.isArray(raw)) {
    if (raw.length === 0) return [];
    if (typeof raw[0] === "object") {
      return raw
        .map((p) => {
          const t = p.t ?? p.time ?? p.timestamp;
          const price = p.p ?? p.price ?? p.value;
          if (t === undefined || price === undefined) return null;
          return { t: Number(t), p: Number(price) };
        })
        .filter(Boolean) as PricePoint[];
    }
  }
  if (raw.t && raw.p && Array.isArray(raw.t) && Array.isArray(raw.p)) {
    return raw.t.map((t: number, idx: number) => ({ t: Number(t), p: Number(raw.p[idx]) }));
  }
  if (raw.timestamps && raw.prices && Array.isArray(raw.timestamps) && Array.isArray(raw.prices)) {
    return raw.timestamps.map((t: number, idx: number) => ({ t: Number(t), p: Number(raw.prices[idx]) }));
  }
  return [];
}

function toCandle(points: PricePoint[], bucketMinutes: number) {
  const bucketMs = bucketMinutes * 60 * 1000;
  const buckets = new Map<number, PricePoint[]>();
  for (const pt of points) {
    let ts = pt.t;
    if (ts > 1e12) ts = Math.floor(ts / 1000);
    const ms = ts * 1000;
    const bucket = Math.floor(ms / bucketMs) * bucketMs;
    const list = buckets.get(bucket) ?? [];
    list.push({ t: Math.floor(bucket / 1000), p: pt.p });
    buckets.set(bucket, list);
  }

  const candles = Array.from(buckets.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([bucket, list]) => {
      const open = list[0].p;
      const close = list[list.length - 1].p;
      let high = open;
      let low = open;
      for (const l of list) {
        if (l.p > high) high = l.p;
        if (l.p < low) low = l.p;
      }
      return {
        time: Math.floor(bucket / 1000) as any,
        open,
        high,
        low,
        close,
      };
    });
  return candles;
}

export function TradingChart({ tokenId, height = 320 }: { tokenId: string; height?: number }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [loading, setLoading] = useState(true);
  const [timeframe, setTimeframe] = useState<Timeframe>(timeframes[2]);
  const [hasData, setHasData] = useState(true);

  const chartOptions = useMemo(
    () => ({
      height,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#9ca3af",
        fontFamily: "var(--font-inter)",
      },
      grid: {
        vertLines: { color: "rgba(148, 163, 184, 0.08)" },
        horzLines: { color: "rgba(148, 163, 184, 0.08)" },
      },
      crosshair: {
        mode: CrosshairMode.Magnet,
        vertLine: { color: "rgba(240, 185, 11, 0.3)" },
        horzLine: { color: "rgba(240, 185, 11, 0.3)" },
      },
      rightPriceScale: {
        borderColor: "rgba(148, 163, 184, 0.12)",
      },
      timeScale: {
        borderColor: "rgba(148, 163, 184, 0.12)",
      },
    }),
    [height]
  );

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, chartOptions as any);
    chartRef.current = chart;
    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [chartOptions]);

  useEffect(() => {
    const load = async () => {
      if (!tokenId || !chartRef.current) return;
      setLoading(true);
      try {
        const url = new URL(`${API_BASE}/clob/prices-history`);
        // Polymarket CLOB expects: market=<tokenId>&interval=<1h|6h|1d|1w|max>&fidelity=<n>
        url.searchParams.set("market", tokenId);
        url.searchParams.set("interval", timeframe.interval);
        url.searchParams.set("fidelity", String(timeframe.fidelity));
        const res = await fetch(url.toString());
        if (!res.ok) throw new Error("prices-history error");
        const raw = await res.json();
        const points = normalizePoints(raw);
        if (!points.length) {
          setHasData(false);
          return;
        }
        setHasData(true);
        const candles = toCandle(points, timeframe.minutes);
        const series = chartRef.current.addCandlestickSeries({
          upColor: "#22c55e",
          downColor: "#ef4444",
          wickUpColor: "#22c55e",
          wickDownColor: "#ef4444",
          borderVisible: false,
        });
        series.setData(candles);
        chartRef.current.timeScale().fitContent();
      } catch {
        setHasData(false);
      } finally {
        setLoading(false);
      }
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenId, timeframe]);

  return (
    <div className="w-full h-full rounded-xl bg-[oklch(0.12_0.01_255)] border border-[oklch(0.22_0.015_255)] relative overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[oklch(0.22_0.015_255)]">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Price</div>
        <div className="flex items-center gap-2">
          {timeframes.map((tf) => (
            <button
              key={tf.id}
              onClick={() => setTimeframe(tf)}
              className={`text-[10px] px-2 py-1 rounded-md border transition-colors ${
                timeframe.id === tf.id
                  ? "bg-[oklch(0.22_0.04_82)] text-[oklch(0.78_0.16_82)] border-[oklch(0.78_0.16_82/0.4)]"
                  : "bg-[oklch(0.16_0.014_255)] text-muted-foreground border-[oklch(0.22_0.015_255)]"
              }`}
            >
              {tf.id}
            </button>
          ))}
        </div>
      </div>
      <div ref={containerRef} style={{ height }} className="w-full" />
      {!loading && !hasData && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
          No chart data
        </div>
      )}
    </div>
  );
}
