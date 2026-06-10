"use client"

import { useEffect, useState } from "react"
import type { ConnectedWallet } from "@privy-io/react-auth"

const POLYGON_CHAIN_ID = 137
const DEFAULT_RELAYER_URL = "https://relayer-v2.polymarket.com"

type DepositWalletState = {
  address: string | null
  loading: boolean
  error: string | null
  refresh: () => Promise<string | null>
}

export function usePolymarketDepositWallet(wallet?: ConnectedWallet | null): DepositWalletState {
  const [address, setAddress] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = async () => {
    if (!wallet?.address) {
      setAddress(null)
      setError(null)
      return null
    }

    setLoading(true)
    setError(null)
    try {
      // Runtime imports: @polymarket/builder-relayer-client carries its own
      // ethers v5 dependency (~1.7MB raw JS). The navbar mounts this hook on
      // every page, so importing eagerly would ship that bundle to every
      // visitor — including ones who never connect a wallet. Deferring the
      // import means it only downloads once a wallet address is present.
      const [{ RelayClient }, { createWalletClient, custom }, { polygon }] = await Promise.all([
        import("@polymarket/builder-relayer-client"),
        import("viem"),
        import("viem/chains"),
      ])
      const provider = await wallet.getEthereumProvider()
      const walletClient = createWalletClient({
        account: wallet.address as `0x${string}`,
        chain: polygon,
        transport: custom(provider as any),
      })
      const relayerUrl = process.env.NEXT_PUBLIC_POLYMARKET_RELAYER_URL || DEFAULT_RELAYER_URL
      const relayClient = new RelayClient(relayerUrl, POLYGON_CHAIN_ID, walletClient as any)
      const derived = await relayClient.deriveDepositWalletAddress()
      setAddress(derived)
      return derived
    } catch (err: any) {
      const message = err?.message ?? "Unable to derive Polymarket deposit wallet."
      setAddress(null)
      setError(message)
      return null
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet?.address])

  return { address, loading, error, refresh }
}
