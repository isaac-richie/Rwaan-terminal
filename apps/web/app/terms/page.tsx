import Link from "next/link"
import { ArrowLeft, Scale } from "lucide-react"

export const metadata = {
  title: "Terms of Service | Rawli Analytic",
  description: "Terms of Service for Rawli Analytic prediction market terminal.",
}

const LAST_UPDATED = "May 2025"

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16">
        {/* Back */}
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-[12px] text-muted-foreground hover:text-foreground transition-colors mb-10"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to terminal
        </Link>

        {/* Header */}
        <div className="flex items-start gap-4 mb-10">
          <div className="w-12 h-12 rounded-2xl bg-[oklch(0.78_0.16_82/0.1)] border border-[oklch(0.78_0.16_82/0.2)] flex items-center justify-center shrink-0">
            <Scale className="w-5 h-5 text-[oklch(0.78_0.16_82)]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Terms of Service</h1>
            <p className="text-[12px] text-muted-foreground mt-1">Last updated: {LAST_UPDATED}</p>
          </div>
        </div>

        <div className="prose-dark space-y-8 text-[14px] leading-7 text-muted-foreground">

          <Section title="1. Acceptance of Terms">
            <p>
              By accessing or using Rawli Analytic (&quot;the Platform&quot;), you agree to be bound by these Terms of
              Service. If you do not agree to these terms, do not use the Platform.
            </p>
          </Section>

          <Section title="2. Description of Service">
            <p>
              Rawli Analytic is a non-custodial trading interface that routes prediction market orders through
              Polymarket&apos;s Central Limit Order Book (CLOB) protocol. The Platform does not custody funds, hold
              user assets, or act as a counterparty to any trade.
            </p>
            <p className="mt-3">
              All trades are executed on-chain via Polymarket&apos;s smart contracts. Rawli Analytic provides the
              interface and routing infrastructure only.
            </p>
          </Section>

          <Section title="3. Eligibility and Restricted Regions">
            <p>
              You may only use the Platform if you are not located in, and are not a citizen or resident of, any
              jurisdiction where prediction market trading is prohibited or restricted by applicable law. This includes,
              but is not limited to:
            </p>
            <ul className="mt-3 space-y-1.5 list-disc list-inside">
              <li>The United States of America and its territories</li>
              <li>The United Kingdom</li>
              <li>Any jurisdiction subject to OFAC sanctions</li>
              <li>Any other jurisdiction where Polymarket has applied restrictions</li>
            </ul>
            <p className="mt-3">
              By using the Platform, you represent and warrant that you are eligible to do so under the laws of your
              jurisdiction. Rawli Analytic reserves the right to restrict access from any region at any time.
            </p>
          </Section>

          <Section title="4. Non-Custodial Nature">
            <p>
              Rawli Analytic is non-custodial. Your private keys and funds remain entirely under your control. The
              Platform cannot access, freeze, or recover your funds. You are solely responsible for the security of
              your wallet credentials.
            </p>
          </Section>

          <Section title="5. Risk Disclosure">
            <p>Prediction market trading involves substantial risk. You may lose all funds you trade. Specifically:</p>
            <ul className="mt-3 space-y-1.5 list-disc list-inside">
              <li>Prediction market outcomes are binary — you may lose 100% of your position.</li>
              <li>On-chain transactions are irreversible.</li>
              <li>Smart contract bugs, oracle failures, or liquidity issues may result in loss.</li>
              <li>Market prices reflect crowd sentiment, not guaranteed outcomes.</li>
              <li>AI-generated analysis provided by the Platform is not financial advice.</li>
            </ul>
          </Section>

          <Section title="6. Fees">
            <p>
              The Platform charges a platform fee on trades (currently 0.5%, subject to change). Premium intelligence
              reports are priced at $1 USDT per report, paid on-chain. All fees are disclosed prior to any transaction.
            </p>
          </Section>

          <Section title="7. Intellectual Property">
            <p>
              All Platform content, design, code, and branding are proprietary to Rawli Analytic. You may not
              reproduce, distribute, or create derivative works without express written permission.
            </p>
          </Section>

          <Section title="8. Disclaimer of Warranties">
            <p>
              THE PLATFORM IS PROVIDED &quot;AS IS&quot; WITHOUT WARRANTIES OF ANY KIND. RAWLI ANALYTIC MAKES NO
              WARRANTY THAT THE PLATFORM WILL BE UNINTERRUPTED, ERROR-FREE, OR SECURE. MARKET DATA IS PROVIDED FOR
              INFORMATIONAL PURPOSES ONLY AND MAY NOT BE ACCURATE OR TIMELY.
            </p>
          </Section>

          <Section title="9. Limitation of Liability">
            <p>
              TO THE MAXIMUM EXTENT PERMITTED BY LAW, RAWLI ANALYTIC SHALL NOT BE LIABLE FOR ANY INDIRECT,
              INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES ARISING FROM YOUR USE OF THE PLATFORM OR ANY
              PREDICTION MARKET TRADING ACTIVITY.
            </p>
          </Section>

          <Section title="10. Modifications">
            <p>
              We reserve the right to modify these Terms at any time. Continued use of the Platform after changes
              constitutes acceptance of the revised Terms. Material changes will be communicated via the Platform
              interface.
            </p>
          </Section>

          <Section title="11. Governing Law">
            <p>
              These Terms shall be governed by and construed in accordance with applicable international commercial law,
              without regard to any specific jurisdiction&apos;s conflict of law provisions.
            </p>
          </Section>

          <div className="pt-4 border-t border-[oklch(0.18_0.014_255)]">
            <p className="text-[12px] text-muted-foreground/60">
              By using Rawli Analytic, you acknowledge that you have read, understood, and agree to these Terms of
              Service. See also our{" "}
              <Link href="/privacy" className="text-[oklch(0.78_0.16_82)] hover:underline">
                Privacy Policy
              </Link>
              .
            </p>
          </div>
        </div>
      </div>
    </main>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-[15px] font-semibold text-foreground mb-3">{title}</h2>
      {children}
    </section>
  )
}
