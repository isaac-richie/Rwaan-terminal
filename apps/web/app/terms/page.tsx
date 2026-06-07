import Link from "next/link"
import { ArrowLeft, Scale } from "lucide-react"

export const metadata = {
  title: "Terms of Service | Rawli Analytics",
  description: "Terms of Service for Rawli Analytics prediction market terminal.",
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
              By accessing or using Rawli Analytics (&quot;the Platform&quot;), you agree to be bound by these Terms of
              Service. If you do not agree to these terms, do not use the Platform.
            </p>
          </Section>

          <Section title="2. Description of Service">
            <p>
              Rawli Analytics is a non-custodial trading interface that routes prediction market orders through
              Polymarket&apos;s Central Limit Order Book (CLOB) protocol. The Platform does not custody funds, hold
              user assets, or act as a counterparty to any trade.
            </p>
            <p className="mt-3">
              All trades are executed on-chain via Polymarket&apos;s smart contracts. Rawli Analytics provides the
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
              jurisdiction. Rawli Analytics reserves the right to restrict access from any region at any time.
            </p>
            <p className="mt-3">
              You must be at least 18 years of age and not a restricted person under US law, OFAC sanctions, or the laws of your jurisdiction.
            </p>
          </Section>

          <Section title="4. Non-Custodial Nature">
            <p>
              Rawli Analytics is non-custodial. Your private keys and funds remain entirely under your control. The
              Platform cannot access, freeze, or recover your funds. You are solely responsible for the security of
              your wallet credentials.
            </p>
          </Section>

          <Section title="5. Tokenized Stocks and Securities Disclosure">
            <p>
              Stocks traded on Rawli are tokenized equity tokens (rTokens) issued by Ondo Finance and routed through
              PancakeSwap on BNB Chain. These tokens represent real US equities and are classified as securities under
              applicable law.
            </p>
            <ul className="mt-3 space-y-1.5 list-disc list-inside">
              <li>
                <span className="text-foreground font-medium">Ondo Finance</span> is the issuer of rTokens and has
                regulatory engagement with securities regulators.
              </li>
              <li>
                <span className="text-foreground font-medium">Rawli Analytics</span> is a non-custodial routing interface
                only. We do not issue, custody, or manage these tokens.
              </li>
              <li>
                <span className="text-foreground font-medium">PancakeSwap</span> is a decentralized exchange where rToken
                trading occurs on-chain.
              </li>
              <li>
                You hold price exposure only — you do not receive voting rights, dividends, or other shareholder benefits.
              </li>
              <li>
                All rToken transactions are final and irreversible once confirmed on-chain.
              </li>
            </ul>
            <p className="mt-3">
              By trading tokenized stocks on Rawli, you acknowledge that you understand the regulatory nature of these
              instruments and accept the terms set by Ondo Finance and PancakeSwap.
            </p>
          </Section>

          <Section title="7. Risks — Prediction Markets">
            <p>Prediction market trading involves substantial risk. You may lose all funds you trade. Specifically:</p>
            <ul className="mt-3 space-y-1.5 list-disc list-inside">
              <li>Prediction market outcomes are binary — you may lose 100% of your position.</li>
              <li>On-chain transactions are irreversible.</li>
              <li>Smart contract bugs, oracle failures, or liquidity issues may result in loss of funds.</li>
              <li>Market prices reflect crowd sentiment, not guaranteed outcomes.</li>
              <li>Events may resolve unexpectedly or be contested, resulting in delayed or disputed payouts.</li>
              <li>AI-generated analysis provided by the Platform is not financial advice and may be inaccurate.</li>
            </ul>
          </Section>

          <Section title="8. Risks — Tokenized Stocks">
            <p>Tokenized stock trading involves risks distinct from prediction markets:</p>
            <ul className="mt-3 space-y-1.5 list-disc list-inside">
              <li>Stock prices can move continuously, and you may experience unlimited losses if the company fails or the stock price falls to zero.</li>
              <li>Smart contract bugs in Ondo Finance or PancakeSwap may result in loss of funds or inability to withdraw.</li>
              <li>BNB Chain validator risks, network outages, or blockchain reorganization may prevent or delay transactions.</li>
              <li>rToken token redemption may be subject to conditions or delays set by Ondo Finance.</li>
              <li>You do not hold actual shares — you hold tokenized exposure only, which may differ in treatment from traditional stock ownership.</li>
              <li>Regulatory changes affecting tokenized securities may impact your ability to trade or the value of your holdings.</li>
              <li>Market liquidity for rTokens on PancakeSwap may be limited, resulting in wider spreads and slippage.</li>
            </ul>
          </Section>

          <Section title="9. Fees">
            <p>
              The Platform charges a platform fee on trades (currently 0.5%, subject to change). Premium intelligence
              reports are free during the current testing phase. If pricing returns later, all fees will be disclosed
              prior to any transaction.
            </p>
          </Section>

          <Section title="10. KYC / AML and Compliance">
            <p>
              Rawli Analytics does not directly perform Know-Your-Customer (KYC) or Anti-Money-Laundering (AML) screening.
              However:
            </p>
            <ul className="mt-3 space-y-1.5 list-disc list-inside">
              <li>
                <span className="text-foreground font-medium">Polymarket</span> performs geoblock checks and applies
                restrictions to certain regions.
              </li>
              <li>
                <span className="text-foreground font-medium">PancakeSwap</span> (for tokenized stock trading) may have
                its own compliance and access restrictions.
              </li>
              <li>
                You are responsible for understanding and complying with the laws of your jurisdiction regarding prediction
                market and securities trading.
              </li>
              <li>
                Rawli reserves the right to restrict access or suspend accounts that appear to violate sanctions, OFAC
                rules, or applicable securities laws.
              </li>
            </ul>
          </Section>

          <Section title="11. Intellectual Property">
            <p>
              All Platform content, design, code, and branding are proprietary to Rawli Analytics. You may not
              reproduce, distribute, or create derivative works without express written permission.
            </p>
          </Section>

          <Section title="12. Disclaimer of Warranties">
            <p>
              THE PLATFORM IS PROVIDED &quot;AS IS&quot; WITHOUT WARRANTIES OF ANY KIND. RAWLI ANALYTICS MAKES NO
              WARRANTY THAT THE PLATFORM WILL BE UNINTERRUPTED, ERROR-FREE, OR SECURE. MARKET DATA IS PROVIDED FOR
              INFORMATIONAL PURPOSES ONLY AND MAY NOT BE ACCURATE OR TIMELY. RAWLI ASSUMES NO LIABILITY FOR LOSSES
              ARISING FROM TRADING DECISIONS BASED ON PLATFORM DATA OR ANALYSIS.
            </p>
          </Section>

          <Section title="13. Limitation of Liability">
            <p>
              TO THE MAXIMUM EXTENT PERMITTED BY LAW, RAWLI ANALYTICS SHALL NOT BE LIABLE FOR ANY INDIRECT,
              INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES ARISING FROM YOUR USE OF THE PLATFORM, ANY
              PREDICTION MARKET TRADING ACTIVITY, OR TOKENIZED STOCK TRADING.
            </p>
          </Section>

          <Section title="14. Modifications">
            <p>
              We reserve the right to modify these Terms at any time. Continued use of the Platform after changes
              constitutes acceptance of the revised Terms. Material changes will be communicated via the Platform
              interface.
            </p>
          </Section>

          <Section title="15. Governing Law">
            <p>
              These Terms shall be governed by and construed in accordance with applicable international commercial law,
              without regard to any specific jurisdiction&apos;s conflict of law provisions.
            </p>
          </Section>

          <div className="pt-4 border-t border-[oklch(0.18_0.014_255)]">
            <p className="text-[12px] text-muted-foreground/60">
              By using Rawli Analytics, you acknowledge that you have read, understood, and agree to these Terms of
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
