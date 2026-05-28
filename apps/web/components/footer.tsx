"use client"

import Link from "next/link"
import { useState } from "react"
import {
  X,
  Scale,
  Shield,
  Zap,
  BarChart3,
  Brain,
  Coins,
  ArrowUpRight,
  TrendingUp,
  Lock,
} from "lucide-react"

// ─── Legal sheet (Terms / Privacy) ───────────────────────────────────────────

function LegalSheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />
      {/* Sheet */}
      <div className="relative z-10 w-full sm:max-w-2xl max-h-[92dvh] sm:max-h-[88vh] flex flex-col rounded-t-3xl sm:rounded-2xl bg-[oklch(0.11_0.012_260)] border border-[oklch(0.22_0.015_255)] shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[oklch(0.18_0.014_255)] shrink-0">
          <span className="text-sm font-semibold text-foreground">{title}</span>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-[oklch(0.18_0.014_255)] text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        {/* Scrollable body */}
        <div className="overflow-y-auto overscroll-contain px-5 py-6 text-[13px] leading-7 text-muted-foreground space-y-6">
          {children}
        </div>
        {/* Bottom safe area */}
        <div className="h-safe-bottom shrink-0" />
      </div>
    </div>
  )
}

function LegalSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-[13px] font-semibold text-foreground mb-2">{title}</h3>
      {children}
    </section>
  )
}

const TERMS_CONTENT = (
  <div className="space-y-6">
    <p className="text-[11px] text-muted-foreground/50 uppercase tracking-widest">Last updated: May 2026</p>

    <LegalSection title="1. Acceptance of Terms">
      <p>By accessing or using Rawli Analytics ("the Platform"), you agree to be bound by these Terms of Service. If you do not agree to these terms, do not use the Platform.</p>
    </LegalSection>

    <LegalSection title="2. What Rawli Analytics Is">
      <p>Rawli Analytics is a non-custodial prediction market terminal. It provides a professional trading interface, AI-powered market analysis, and real-time data aggregation. The Platform routes order execution through Polymarket's Central Limit Order Book (CLOB) protocol on Polygon. Rawli Analytics does not hold user funds, act as a counterparty to trades, or provide financial advice of any kind.</p>
    </LegalSection>

    <LegalSection title="3. Eligibility">
      <p>You may only use the Platform if you are legally permitted to participate in prediction markets in your jurisdiction. Restricted jurisdictions include, but are not limited to:</p>
      <ul className="mt-2 space-y-1.5 list-disc list-inside text-muted-foreground/80">
        <li>The United States of America and its territories</li>
        <li>The United Kingdom</li>
        <li>Any jurisdiction subject to OFAC sanctions</li>
        <li>Any other jurisdiction where prediction market trading is prohibited</li>
      </ul>
      <p className="mt-3">By using the Platform, you represent that you are eligible under your local laws. Rawli Analytics may restrict access from any region at any time without notice.</p>
    </LegalSection>

    <LegalSection title="4. Non-Custodial & Self-Sovereign">
      <p>Your private keys and funds remain entirely under your control at all times. Rawli Analytics has no ability to access, freeze, move, or recover your funds. You are solely responsible for the security of your wallet. Lost private keys cannot be recovered through this Platform.</p>
    </LegalSection>

    <LegalSection title="5. Risk Disclosure">
      <p>Prediction market trading carries substantial financial risk. By using this Platform, you acknowledge:</p>
      <ul className="mt-2 space-y-1.5 list-disc list-inside text-muted-foreground/80">
        <li>Prediction market outcomes are binary — you may lose 100% of any position</li>
        <li>On-chain transactions are irreversible once submitted</li>
        <li>Smart contract bugs, oracle failures, or liquidity gaps may cause losses</li>
        <li>Market prices reflect crowd probability estimates, not guaranteed outcomes</li>
        <li>AI analysis on this Platform is for informational purposes only — not financial advice</li>
        <li>Gas fees and platform fees are non-refundable</li>
      </ul>
    </LegalSection>

    <LegalSection title="6. Fees">
      <p>The Platform charges a platform fee on executed trades (currently 0.5%). Premium Intelligence Reports are priced at $1 USDT per report, paid on-chain via BNB Chain. All fees are shown to you before any transaction is signed. Fees are non-refundable.</p>
    </LegalSection>

    <LegalSection title="7. AI-Generated Content">
      <p>Premium analysis and market intelligence generated by the Platform uses large language models and live data. This content is provided for informational purposes only. It is not financial advice, investment advice, or a recommendation to buy or sell any asset. Past AI accuracy does not guarantee future performance.</p>
    </LegalSection>

    <LegalSection title="8. Intellectual Property">
      <p>All Platform content, design, code, branding, and AI-generated analysis are proprietary to Rawli Analytics. You may not reproduce, distribute, modify, or create derivative works without express written permission.</p>
    </LegalSection>

    <LegalSection title="9. Disclaimer of Warranties">
      <p className="uppercase text-[11px] tracking-wide">The platform is provided "as is" without warranties of any kind, express or implied. Rawli Analytics makes no warranty that the platform will be uninterrupted, error-free, or secure. Market data is provided for informational purposes only and may not be accurate or timely.</p>
    </LegalSection>

    <LegalSection title="10. Limitation of Liability">
      <p className="uppercase text-[11px] tracking-wide">To the maximum extent permitted by applicable law, Rawli Analytics shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising from your use of the platform or any prediction market trading activity conducted through it.</p>
    </LegalSection>

    <LegalSection title="11. Modifications">
      <p>We reserve the right to modify these Terms at any time. Continued use of the Platform after changes constitutes acceptance of the revised Terms. Material changes will be communicated via the Platform interface.</p>
    </LegalSection>

    <LegalSection title="12. Governing Law">
      <p>These Terms are governed by applicable international commercial law, without regard to any specific jurisdiction's conflict of law provisions. Any disputes shall be resolved by binding arbitration.</p>
    </LegalSection>

    <div className="pt-4 border-t border-[oklch(0.18_0.014_255)] text-[11px] text-muted-foreground/50">
      By using Rawli Analytics, you acknowledge that you have read, understood, and agree to these Terms of Service.
    </div>
  </div>
)

const PRIVACY_CONTENT = (
  <div className="space-y-6">
    <p className="text-[11px] text-muted-foreground/50 uppercase tracking-widest">Last updated: May 2026</p>

    <LegalSection title="1. What We Collect">
      <p>Rawli Analytics collects minimal data to operate the Platform:</p>
      <ul className="mt-2 space-y-1.5 list-disc list-inside text-muted-foreground/80">
        <li>Wallet addresses (public on-chain identifiers — never private keys)</li>
        <li>Trading activity you initiate through the Platform (logged for rewards tracking)</li>
        <li>Referral codes you use or share</li>
        <li>Premium analysis purchase records (tx hash + market ID)</li>
      </ul>
    </LegalSection>

    <LegalSection title="2. What We Do Not Collect">
      <ul className="mt-2 space-y-1.5 list-disc list-inside text-muted-foreground/80">
        <li>Name, email, or any personally identifiable information unless you volunteer it</li>
        <li>Private keys or wallet seed phrases — ever</li>
        <li>IP addresses stored long-term</li>
        <li>Browser fingerprints or device identifiers</li>
      </ul>
    </LegalSection>

    <LegalSection title="3. Wallet Connection">
      <p>Wallet connections are managed by Privy, a third-party wallet infrastructure provider. Privy's own privacy policy applies to authentication data. Rawli Analytics only receives your public wallet address from this process.</p>
    </LegalSection>

    <LegalSection title="4. On-Chain Data">
      <p>All trades executed through the Platform are recorded on public blockchains (Polygon, BNB Chain). This data is publicly visible and cannot be deleted. Rawli Analytics does not control on-chain data.</p>
    </LegalSection>

    <LegalSection title="5. Data Use">
      <p>Data collected is used solely to: operate the Platform, calculate and distribute reward points, prevent duplicate premium analysis purchases, and improve Platform performance. We do not sell, rent, or share your data with third parties for marketing purposes.</p>
    </LegalSection>

    <LegalSection title="6. Cookies & Local Storage">
      <p>The Platform uses browser local storage to cache market data, your premium analysis results, and UI preferences. No persistent tracking cookies are used. You may clear local storage at any time through your browser settings.</p>
    </LegalSection>

    <LegalSection title="7. Third-Party Services">
      <p>The Platform integrates with Polymarket (market data), Binance (price feeds), Privy (wallet auth), and OpenAI (AI analysis). Each of these services has its own privacy policy. We recommend reviewing them.</p>
    </LegalSection>

    <LegalSection title="8. Changes">
      <p>We may update this Privacy Policy as the Platform evolves. Material changes will be announced through the Platform interface. Continued use constitutes acceptance.</p>
    </LegalSection>

    <div className="pt-4 border-t border-[oklch(0.18_0.014_255)] text-[11px] text-muted-foreground/50">
      Questions? The Platform is non-custodial and collects minimal data by design.
    </div>
  </div>
)

// ─── Docs feature cards ───────────────────────────────────────────────────────

const DOCS = [
  {
    icon: BarChart3,
    color: "oklch(0.78 0.16 82)",
    title: "Prediction Markets",
    body: "Trade on real-world event outcomes. Every market resolves YES or NO — you buy shares at 0–100¢ and collect $1 if you're right. Rawli routes your orders through Polymarket's professional order book.",
  },
  {
    icon: Brain,
    color: "oklch(0.68 0.18 230)",
    title: "AI Intelligence Engine",
    body: "Unlock a $1 deep-research report on any market. Our engine pulls live news, runs a 16-signal quant model for crypto or a 5-factor fundamental model for other events, and delivers a definitive YES/NO verdict with full rationale.",
  },
  {
    icon: Coins,
    color: "oklch(0.68 0.18 155)",
    title: "BNB-Native Funding",
    body: "Fund your trading wallet with USDT on BNB Chain. Our bridge routes it to Polygon where Polymarket trades happen — no manual bridging needed. Gas fees on Polygon are covered by the gas assist system for qualifying wallets.",
  },
  {
    icon: Lock,
    color: "oklch(0.74 0.14 25)",
    title: "Non-Custodial & Self-Sovereign",
    body: "Your keys, your funds. Every order is signed locally in your wallet — Rawli never touches your private key or holds assets. Orders go directly to Polymarket's on-chain CLOB. You can verify every transaction on-chain.",
  },
  {
    icon: TrendingUp,
    color: "oklch(0.72 0.18 45)",
    title: "Rawli Points & Rewards",
    body: "Earn points on every trade. Bonus multipliers for 24h markets, crypto markets, and Premium Analysis-backed trades. Points track your platform activity and unlock future rewards.",
  },
  {
    icon: Zap,
    color: "oklch(0.78 0.16 82)",
    title: "Live Market Feed",
    body: "Browse hundreds of active prediction markets filtered by Africa 🌍, Crypto, Sports, News, and Geopolitics. The smart feed surfaces 24h crypto markets and high-liquidity opportunities first.",
  },
]

// ─── Main footer ──────────────────────────────────────────────────────────────

export function Footer() {
  const [termsOpen, setTermsOpen] = useState(false)
  const [privacyOpen, setPrivacyOpen] = useState(false)

  return (
    <>
      <LegalSheet open={termsOpen} onClose={() => setTermsOpen(false)} title="Terms of Service">
        {TERMS_CONTENT}
      </LegalSheet>
      <LegalSheet open={privacyOpen} onClose={() => setPrivacyOpen(false)} title="Privacy Policy">
        {PRIVACY_CONTENT}
      </LegalSheet>

      <footer className="relative mt-24 overflow-hidden">
        {/* Top separator */}
        <div className="h-px gold-line" />

        {/* Ambient glow */}
        <div
          className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[300px] pointer-events-none"
          style={{ background: "radial-gradient(ellipse at 50% 0%, oklch(0.78 0.16 82 / 0.04) 0%, transparent 70%)" }}
        />

        <div className="relative bg-[oklch(0.09_0.011_260)]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-14 pb-10">

            {/* ── How it works / Docs section ── */}
            <div className="mb-14">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-8 h-px bg-[oklch(0.78_0.16_82/0.4)]" />
                <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[oklch(0.78_0.16_82)]">
                  How Rawli Works
                </span>
                <div className="flex-1 h-px bg-[oklch(0.20_0.014_255)]" />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {DOCS.map((d) => {
                  const Icon = d.icon
                  return (
                    <div
                      key={d.title}
                      className="rounded-xl border border-[oklch(0.18_0.014_255)] bg-[oklch(0.11_0.012_260)] p-4 hover:border-[oklch(0.26_0.016_255)] transition-colors"
                    >
                      <div
                        className="mb-3 inline-flex h-8 w-8 items-center justify-center rounded-lg"
                        style={{ background: `${d.color.replace(")", " / 0.12)")}`}}
                      >
                        <Icon className="h-4 w-4" style={{ color: d.color }} />
                      </div>
                      <h3 className="text-[13px] font-semibold text-foreground mb-1.5">{d.title}</h3>
                      <p className="text-[12px] leading-5.5 text-muted-foreground/70">{d.body}</p>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* ── Main footer grid ── */}
            <div className="grid grid-cols-1 sm:grid-cols-[1.6fr_1fr] gap-10">

              {/* Brand */}
              <div className="space-y-5">
                <Link href="/" className="inline-flex items-center gap-3 group">
                  <div className="relative flex h-9 w-14 items-center justify-center">
                    <img
                      src="/rawli-brand.png"
                      alt="Rawli Analytics"
                      className="h-full w-full object-contain transition-transform duration-300 group-hover:scale-105"
                    />
                  </div>
                  <div className="leading-none">
                    <p className="text-[14px] font-bold tracking-tight text-foreground">
                      Rawli <span className="text-[oklch(0.78_0.16_82)]">Analytics</span>
                    </p>
                    <p className="mt-1 text-[9px] uppercase tracking-[0.22em] text-muted-foreground">
                      prediction terminal
                    </p>
                  </div>
                </Link>

                <p className="max-w-sm text-[12px] leading-6 text-muted-foreground/70">
                  Professional prediction market terminal — live market feed, AI-powered intelligence, non-custodial order execution, and BNB-native funding.
                </p>

                <div className="flex items-center gap-1.5 pt-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-[oklch(0.68_0.18_155)] pulse-dot" />
                  <span className="text-[10px] font-mono font-semibold text-muted-foreground/40 uppercase tracking-widest">
                    Live · Non-custodial · On-chain
                  </span>
                </div>
              </div>

              {/* Nav columns */}
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <h3 className="text-[9px] font-bold uppercase tracking-[0.22em] text-[oklch(0.78_0.16_82)] mb-4">
                    Platform
                  </h3>
                  <ul className="space-y-3">
                    {[
                      { label: "Markets", href: "/" },
                      { label: "Portfolio", href: "/portfolio" },
                      { label: "Points", href: "/portfolio" },
                    ].map((l) => (
                      <li key={l.label}>
                        <Link
                          href={l.href}
                          className="group/l flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground transition-colors"
                        >
                          {l.label}
                          <ArrowUpRight className="w-3 h-3 opacity-0 group-hover/l:opacity-60 transition-opacity" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <h3 className="text-[9px] font-bold uppercase tracking-[0.22em] text-[oklch(0.78_0.16_82)] mb-4">
                    Legal
                  </h3>
                  <ul className="space-y-3">
                    <li>
                      <button
                        onClick={() => setTermsOpen(true)}
                        className="flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground transition-colors"
                      >
                        Terms of Service
                        <Scale className="w-3 h-3 opacity-40" />
                      </button>
                    </li>
                    <li>
                      <button
                        onClick={() => setPrivacyOpen(true)}
                        className="flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground transition-colors"
                      >
                        Privacy Policy
                        <Shield className="w-3 h-3 opacity-40" />
                      </button>
                    </li>
                  </ul>
                </div>
              </div>
            </div>

            {/* ── Bottom bar ── */}
            <div className="mt-10 pt-5 border-t border-[oklch(0.16_0.013_260)] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <p className="text-[11px] text-muted-foreground/40">
                © {new Date().getFullYear()} Rawli Analytics. Not financial advice. Trade responsibly.
              </p>
              <div className="flex items-center gap-3 text-[10px] text-muted-foreground/30">
                <button onClick={() => setTermsOpen(true)} className="hover:text-muted-foreground transition-colors">Terms</button>
                <span>·</span>
                <button onClick={() => setPrivacyOpen(true)} className="hover:text-muted-foreground transition-colors">Privacy</button>
              </div>
            </div>

          </div>
        </div>
      </footer>
    </>
  )
}
