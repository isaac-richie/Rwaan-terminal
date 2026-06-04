"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { polygon, bsc } from "viem/chains";
import { ReferralTracker } from "@/components/referral-tracker";
import { Toaster } from "@/components/ui/sonner";
import type { ReactNode } from "react";

const RawliPrivyLogo = (
  <img
    src="/rawli-brand.png"
    alt="Rawli Analytics"
    style={{ width: 96, height: 56, objectFit: "contain" }}
  />
);

export default function Providers({ children }: { children: ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";

  const content = (
    <>
      {children}
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: "oklch(0.18 0.014 255)",
            border: "1px solid oklch(0.24 0.016 255)",
            color: "oklch(0.92 0.008 255)",
            fontFamily: "var(--font-inter)",
          },
        }}
      />
    </>
  );

  if (!appId) return content;

  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["wallet", "email"],
        // Polygon is the CLOB signing chain; BNB is the funding/deposit chain.
        defaultChain: polygon,
        supportedChains: [polygon, bsc],
        appearance: {
          theme: "dark",
          accentColor: "#f0b90b",
          logo: RawliPrivyLogo,
          // ethereum-only suppresses Solana wallet connectors and their
          // large SDK chunks (@solana-program/token etc.)
          walletChainType: "ethereum-only",
          // Show only the most-used wallets to reduce WalletConnect explorer
          // prefetch surface area on first mount.
          walletList: ["metamask", "coinbase_wallet", "wallet_connect", "rainbow"],
        },
        embeddedWallets: {
          ethereum: {
            // Only create an embedded wallet when the user explicitly logs in
            // without an external wallet — avoids a round-trip on first render.
            createOnLogin: "users-without-wallets",
          },
        },
      }}
    >
      <>
        <ReferralTracker />
        {content}
      </>
    </PrivyProvider>
  );
}
