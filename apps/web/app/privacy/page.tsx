import Link from "next/link"
import { ArrowLeft, ShieldCheck } from "lucide-react"

export const metadata = {
  title: "Privacy Policy | Rawli Analytics",
  description: "Privacy Policy for Rawli Analytics prediction market terminal.",
}

const LAST_UPDATED = "May 2025"

export default function PrivacyPage() {
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
          <div className="w-12 h-12 rounded-2xl bg-[oklch(0.68_0.18_155/0.1)] border border-[oklch(0.68_0.18_155/0.2)] flex items-center justify-center shrink-0">
            <ShieldCheck className="w-5 h-5 text-[oklch(0.68_0.18_155)]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Privacy Policy</h1>
            <p className="text-[12px] text-muted-foreground mt-1">Last updated: {LAST_UPDATED}</p>
          </div>
        </div>

        <div className="space-y-8 text-[14px] leading-7 text-muted-foreground">

          <Section title="1. Overview">
            <p>
              Rawli Analytics is a non-custodial prediction market interface. We are committed to minimizing data
              collection and protecting user privacy. This policy explains what data we collect, how we use it, and
              your rights.
            </p>
          </Section>

          <Section title="2. Data We Collect">
            <p>We collect the minimum data necessary to operate the Platform:</p>
            <ul className="mt-3 space-y-2 list-disc list-inside">
              <li>
                <span className="text-foreground font-medium">Wallet addresses</span> — Public EVM addresses you
                connect to the Platform. These are public on-chain identifiers.
              </li>
              <li>
                <span className="text-foreground font-medium">Trading profile data</span> — Deposit address mappings
                and trading wallet configuration required for CLOB order routing.
              </li>
              <li>
                <span className="text-foreground font-medium">Reward/points events</span> — Trade activity recorded for
                the points programme (wallet, amount, timestamp). No personal identification.
              </li>
              <li>
                <span className="text-foreground font-medium">Referral links</span> — If you use a referral link, we
                record the referring and referred wallet addresses.
              </li>
              <li>
                <span className="text-foreground font-medium">Analysis generation</span> — Market IDs and timestamps
                for generated premium intelligence reports. When report fees are enabled, transaction hashes may also be
                stored to prevent replay.
              </li>
            </ul>
          </Section>

          <Section title="3. Data We Do Not Collect">
            <ul className="mt-2 space-y-1.5 list-disc list-inside">
              <li>No names, email addresses, or government identifiers</li>
              <li>No IP addresses stored persistently</li>
              <li>No browser fingerprints or cross-site tracking</li>
              <li>No private keys — ever</li>
              <li>No payment card data</li>
            </ul>
          </Section>

          <Section title="4. Third-Party Services">
            <p>The Platform integrates with the following third-party services:</p>
            <div className="mt-3 space-y-3">
              <ThirdParty
                name="Polymarket"
                purpose="Liquidity, order routing, and geoblock checks. Polymarket may process your IP address to determine eligibility."
                url="https://polymarket.com/privacy-policy"
              />
              <ThirdParty
                name="Privy"
                purpose="Wallet connection and embedded wallet infrastructure. Subject to Privy's privacy policy."
                url="https://privy.io/privacy-policy"
              />
              <ThirdParty
                name="BNB Chain / Polygon"
                purpose="Public blockchains. All on-chain activity is publicly visible by nature."
                url={null}
              />
            </div>
          </Section>

          <Section title="5. Geoblock Checks">
            <p>
              When you access the Platform, we proxy a geoblock check to Polymarket by forwarding your IP address.
              This is required to comply with Polymarket&apos;s regional restrictions. Your IP is forwarded to
              Polymarket but is not stored by Rawli Analytics.
            </p>
          </Section>

          <Section title="6. Cookies and Local Storage">
            <p>
              The Platform uses browser localStorage to cache the following data locally on your device:
            </p>
            <ul className="mt-2 space-y-1.5 list-disc list-inside">
              <li>Generated premium analysis reports (keyed by market ID)</li>
              <li>UI preferences (theme, sort order)</li>
            </ul>
            <p className="mt-3">
              We do not use tracking cookies or third-party analytics cookies.
            </p>
          </Section>

          <Section title="7. Data Retention">
            <p>
              Wallet-linked data (trading profiles, reward events, referrals) is retained for the lifetime of your
              account or until you request deletion. Analysis generation records are retained to operate caching,
              rewards, and product reliability. When report fees are enabled, payment verification hashes are retained
              to prevent replay attacks.
            </p>
          </Section>

          <Section title="8. Your Rights">
            <p>You have the right to:</p>
            <ul className="mt-2 space-y-1.5 list-disc list-inside">
              <li>Request deletion of your profile data</li>
              <li>Request a copy of data associated with your wallet address</li>
              <li>Disconnect your wallet at any time</li>
            </ul>
            <p className="mt-3">
              Since we do not collect email addresses, deletion requests must be submitted via the Platform interface or
              by contacting us with a signed message from your wallet.
            </p>
          </Section>

          <Section title="9. Security">
            <p>
              All API communications use HTTPS. Database access is restricted to application servers. We do not store
              private keys or seed phrases under any circumstances. The Platform is non-custodial by design.
            </p>
          </Section>

          <Section title="10. Changes to This Policy">
            <p>
              We may update this Privacy Policy from time to time. Material changes will be communicated via the
              Platform interface. Continued use of the Platform constitutes acceptance of the updated Policy.
            </p>
          </Section>

          <div className="pt-4 border-t border-[oklch(0.18_0.014_255)]">
            <p className="text-[12px] text-muted-foreground/60">
              See also our{" "}
              <Link href="/terms" className="text-[oklch(0.78_0.16_82)] hover:underline">
                Terms of Service
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

function ThirdParty({ name, purpose, url }: { name: string; purpose: string; url: string | null }) {
  return (
    <div className="rounded-xl border border-[oklch(0.22_0.015_255)] bg-[oklch(0.13_0.013_255)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[13px] font-semibold text-foreground">{name}</p>
          <p className="text-[12px] text-muted-foreground mt-1">{purpose}</p>
        </div>
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-[oklch(0.78_0.16_82)] hover:underline whitespace-nowrap shrink-0"
          >
            Privacy policy ↗
          </a>
        )}
      </div>
    </div>
  )
}
