"use client"

import { useEffect, useRef, useState } from "react"
import { ArrowUpRight, TrendingUp, DollarSign, Activity, Users } from "lucide-react"

const tickerItems = [
  { label: "BTC Price > $100k by EOY", yes: 72, vol: "$4.2M" },
  { label: "Trump 2024 Election Win", yes: 55, vol: "$28.3M" },
  { label: "ETH Merge Before Q3", yes: 88, vol: "$1.9M" },
  { label: "Fed Rate Cut in March", yes: 34, vol: "$6.7M" },
  { label: "SpaceX Starship Orbit", yes: 91, vol: "$840K" },
  { label: "AI Surpasses Human IQ Test", yes: 23, vol: "$2.1M" },
  { label: "Apple $4T Market Cap", yes: 44, vol: "$3.5M" },
  { label: "World Cup Host 2026", yes: 97, vol: "$520K" },
  { label: "BNB Chain #1 DeFi TVL", yes: 18, vol: "$1.2M" },
  { label: "Solana Overtakes ETH TPS", yes: 61, vol: "$890K" },
]

const stats = [
  { label: "Total Volume", value: "$1.24B", sub: "+12.4% this week", icon: DollarSign, up: true },
  { label: "Open Markets", value: "3,847", sub: "across 6 focus lanes", icon: Activity, up: true },
  { label: "Liquidity Pools", value: "$284M", sub: "+$8.2M today", icon: TrendingUp, up: true },
  { label: "Active Traders", value: "142K", sub: "24h unique wallets", icon: Users, up: false },
]

function StatCard({ stat, delay }: { stat: typeof stats[0]; delay: number }) {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), delay)
    return () => clearTimeout(t)
  }, [delay])

  return (
    <div
      className="surface-card rounded-xl p-4 transition-all duration-700"
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(16px)",
      }}
    >
      <div className="flex items-start justify-between mb-2">
        <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
          {stat.label}
        </span>
        <div className="w-7 h-7 rounded-lg bg-[oklch(0.22_0.04_82)] flex items-center justify-center">
          <stat.icon className="w-3.5 h-3.5 text-[oklch(0.78_0.16_82)]" />
        </div>
      </div>
      <div className="text-2xl font-bold font-mono text-foreground tracking-tight">{stat.value}</div>
      <div className={`text-xs mt-1 font-medium ${stat.up ? "text-[oklch(0.68_0.18_155)]" : "text-muted-foreground"}`}>
        {stat.sub}
      </div>
    </div>
  )
}

export function HeroHeader() {
  const [titleVisible, setTitleVisible] = useState(false)
  const [badgeVisible, setBadgeVisible] = useState(false)

  useEffect(() => {
    const b = setTimeout(() => setBadgeVisible(true), 100)
    const t = setTimeout(() => setTitleVisible(true), 300)
    return () => { clearTimeout(b); clearTimeout(t) }
  }, [])

  // Double ticker items for seamless loop
  const doubled = [...tickerItems, ...tickerItems]

  return (
    <section className="relative pt-16 overflow-hidden min-h-[70vh] flex flex-col">
      {/* Background grid */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: `
            linear-gradient(oklch(0.22 0.015 255 / 0.15) 1px, transparent 1px),
            linear-gradient(90deg, oklch(0.22 0.015 255 / 0.15) 1px, transparent 1px)
          `,
          backgroundSize: "60px 60px",
        }}
      />
      {/* Radial ambient glow */}
      <div
        className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[500px] pointer-events-none"
        style={{
          background: "radial-gradient(ellipse at center top, oklch(0.78 0.16 82 / 0.07) 0%, transparent 70%)",
        }}
      />

      {/* Hero content */}
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 pb-8 flex-1 flex flex-col justify-center">
        {/* Announcement badge */}
        <div
          className="flex justify-center mb-6 transition-all duration-500"
          style={{ opacity: badgeVisible ? 1 : 0, transform: badgeVisible ? "translateY(0)" : "translateY(-8px)" }}
        >
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[oklch(0.22_0.04_82)] border border-[oklch(0.78_0.16_82/0.25)] text-[oklch(0.78_0.16_82)] text-xs font-semibold">
            <span className="w-1.5 h-1.5 rounded-full bg-[oklch(0.78_0.16_82)] pulse-dot" />
            Live markets. $1.24B+ Total Volume Traded
            <ArrowUpRight className="w-3 h-3" />
          </div>
        </div>

        {/* Title */}
        <div className="text-center max-w-4xl mx-auto mb-6">
          <h1
            className="text-5xl sm:text-6xl lg:text-7xl font-bold leading-[1.05] tracking-tight text-balance transition-all duration-700"
            style={{ opacity: titleVisible ? 1 : 0, transform: titleVisible ? "translateY(0)" : "translateY(24px)" }}
          >
            <span className="text-foreground">Predict the</span>{" "}
            <span
              className="relative inline-block"
              style={{
                WebkitTextStroke: "1px transparent",
                background: "linear-gradient(135deg, oklch(0.85 0.18 82) 0%, oklch(0.72 0.14 75) 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              Future.
            </span>
            <br />
            <span className="text-foreground">Trade the</span>{" "}
            <span
              style={{
                background: "linear-gradient(135deg, oklch(0.85 0.18 82) 0%, oklch(0.72 0.14 75) 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              Outcome.
            </span>
          </h1>

          <p
            className="mt-5 text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed text-pretty transition-all duration-700"
            style={{
              opacity: titleVisible ? 1 : 0,
              transform: titleVisible ? "translateY(0)" : "translateY(16px)",
              transitionDelay: "100ms",
            }}
          >
            The most liquid decentralized prediction market protocol for real-world outcomes.
            Trade on real-world events with deep liquidity, instant settlement, and zero-fee deposits.
          </p>

          <div
            className="flex flex-col sm:flex-row items-center justify-center gap-3 mt-8 transition-all duration-700"
            style={{
              opacity: titleVisible ? 1 : 0,
              transform: titleVisible ? "translateY(0)" : "translateY(16px)",
              transitionDelay: "200ms",
            }}
          >
            <button className="flex items-center gap-2 px-6 py-3 rounded-xl bg-[oklch(0.78_0.16_82)] text-[oklch(0.12_0.01_255)] font-semibold text-sm hover:bg-[oklch(0.82_0.16_82)] transition-all duration-200 shadow-[0_0_24px_oklch(0.78_0.16_82/0.3)] hover:shadow-[0_0_40px_oklch(0.78_0.16_82/0.5)] active:scale-95">
              <TrendingUp className="w-4 h-4" />
              Explore Markets
            </button>
            <button className="flex items-center gap-2 px-6 py-3 rounded-xl bg-transparent border border-[oklch(0.28_0.018_255)] text-[oklch(0.75_0.01_90)] font-semibold text-sm hover:border-[oklch(0.78_0.16_82/0.5)] hover:text-foreground transition-all duration-200">
              How It Works
              <ArrowUpRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Stats row */}
        <div
          className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-10 transition-all duration-700"
          style={{
            opacity: titleVisible ? 1 : 0,
            transitionDelay: "400ms",
          }}
        >
          {stats.map((stat, i) => (
            <StatCard key={stat.label} stat={stat} delay={500 + i * 80} />
          ))}
        </div>
      </div>

      {/* Live Ticker */}
      <div className="relative border-t border-b border-[oklch(0.22_0.015_255)] bg-[oklch(0.13_0.013_255)] py-2.5 overflow-hidden mt-4">
        <div className="absolute left-0 top-0 bottom-0 w-16 z-10 pointer-events-none" style={{ background: "linear-gradient(90deg, oklch(0.13 0.013 255) 0%, transparent 100%)" }} />
        <div className="absolute right-0 top-0 bottom-0 w-16 z-10 pointer-events-none" style={{ background: "linear-gradient(270deg, oklch(0.13 0.013 255) 0%, transparent 100%)" }} />

        <div className="flex ticker-scroll" style={{ width: "max-content" }}>
          {doubled.map((item, i) => (
            <div key={i} className="flex items-center gap-2 px-6 whitespace-nowrap">
              <span className="w-1.5 h-1.5 rounded-full bg-[oklch(0.78_0.16_82)]" />
              <span className="text-xs text-muted-foreground font-medium">{item.label}</span>
              <span className="text-xs font-mono font-bold text-[oklch(0.78_0.16_82)]">{item.yes}% YES</span>
              <span className="text-xs font-mono text-[oklch(0.45_0.01_90)]">{item.vol}</span>
              <span className="text-[oklch(0.28_0.018_255)] mx-2">|</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
