"use client";

import { useActivePrivyWallet } from "@/hooks/use-active-privy-wallet";
import { useReferral } from "@/hooks/use-referral";

export function ReferralTracker() {
  const { walletAddress } = useActivePrivyWallet();
  useReferral(walletAddress);
  return null;
}
