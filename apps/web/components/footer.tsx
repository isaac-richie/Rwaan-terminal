import Link from "next/link"
import { ArrowUpRight } from "lucide-react"

const NAV_COLUMNS = [
  {
    title: "Terminal",
    links: [
      { label: "Markets", href: "/" },
      { label: "Portfolio", href: "/portfolio" },
      { label: "Funding", href: "/portfolio" },
    ],
  },
  {
    title: "Infrastructure",
    links: [
      { label: "Polymarket Liquidity", href: "/" },
      { label: "BNB Routing", href: "/" },
      { label: "CLOB V2 Data", href: "/" },
    ],
  },
  {
    title: "Risk & Compliance",
    links: [
      { label: "Geoblock Checks", href: "/" },
      { label: "Order Validation", href: "/" },
      { label: "Non-Custodial Flow", href: "/" },
    ],
  },
]

const ECOSYSTEM = [
  { label: "Polymarket", sub: "Liquidity layer" },
  { label: "BNB Chain", sub: "Execution network" },
  { label: "Privy", sub: "Wallet infrastructure" },
  { label: "CLOB V2", sub: "Order book protocol" },
]

export function Footer() {
  return (
    <footer className="relative mt-24 overflow-hidden">
      {/* Top gradient separator */}
      <div className="h-px gold-line" />

      {/* Ambient underlay */}
      <div
        className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[300px] pointer-events-none"
        style={{
          background: "radial-gradient(ellipse at 50% 0%, oklch(0.78 0.16 82 / 0.04) 0%, transparent 70%)",
        }}
      />

      <div className="relative bg-[oklch(0.09_0.011_260)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-14 pb-10">

          {/* Main grid */}
          <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-12 lg:gap-16">

            {/* Left — brand */}
            <div className="space-y-6">
              <Link href="/" className="inline-flex items-center gap-3 group">
                <div className="relative flex h-10 w-16 items-center justify-center">
                  <img src="/rawali-brand.png" alt="Rawali Analytic" className="h-full w-full object-contain transition-transform duration-300 group-hover:scale-105" />
                </div>
                <div className="leading-none">
                  <p className="text-[15px] font-bold tracking-tight text-foreground">
                    Rawali <span className="text-[oklch(0.78_0.16_82)]">Analytic</span>
                  </p>
                  <p className="mt-1 text-[9px] uppercase tracking-[0.22em] text-muted-foreground">
                    prediction terminal
                  </p>
                </div>
              </Link>

              <p className="max-w-sm text-[13px] leading-6 text-muted-foreground">
                A BNB-native trading interface routing Polymarket liquidity through a professional prediction market terminal — non-custodial, live data, clean execution.
              </p>

              {/* Ecosystem strip */}
              <div>
                <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-muted-foreground/50 mb-3">
                  Powered by
                </p>
                <div className="flex flex-wrap gap-2">
                  {ECOSYSTEM.map((item) => (
                    <div
                      key={item.label}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[oklch(0.13_0.013_255)] border border-[oklch(0.20_0.014_255)] hover:border-[oklch(0.28_0.016_255)] transition-colors"
                    >
                      <div className="w-1.5 h-1.5 rounded-full bg-[oklch(0.78_0.16_82/0.6)]" />
                      <div>
                        <p className="text-[11px] font-semibold text-foreground leading-none">{item.label}</p>
                        <p className="text-[9px] text-muted-foreground/60 mt-0.5">{item.sub}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Right — columns */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
              {NAV_COLUMNS.map((col) => (
                <div key={col.title}>
                  <h3 className="text-[9px] font-bold uppercase tracking-[0.22em] text-[oklch(0.78_0.16_82)]">
                    {col.title}
                  </h3>
                  <ul className="mt-4 space-y-3">
                    {col.links.map((link) => (
                      <li key={link.label}>
                        <Link
                          href={link.href}
                          className="group/l flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <span>{link.label}</span>
                          <ArrowUpRight className="w-3 h-3 opacity-0 -translate-y-0.5 translate-x-0 group-hover/l:opacity-60 group-hover/l:-translate-y-0.5 group-hover/l:translate-x-0.5 transition-all duration-150" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>

          {/* Bottom bar */}
          <div className="mt-12 pt-6 border-t border-[oklch(0.18_0.014_255)] flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <p className="text-[11px] text-muted-foreground/60">
              © {new Date().getFullYear()} Rawali Analytic.{" "}
              <span className="text-muted-foreground/40">
                Prediction markets routing. Not financial advice.
              </span>
            </p>

            <div className="flex items-center gap-4">
              {/* Chain status */}
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[oklch(0.68_0.18_155)] pulse-dot" />
                <span className="text-[10px] font-mono font-semibold text-muted-foreground/50 uppercase tracking-widest">
                  BNB · Polygon · Live
                </span>
              </div>
            </div>
          </div>

        </div>
      </div>
    </footer>
  )
}
