"use client"

import { useEffect, useMemo, useState } from "react"
import { useActiveWallet, usePrivy, useWallets } from "@privy-io/react-auth"
import type { ConnectedWallet } from "@privy-io/react-auth"

const ACTIVE_WALLET_KEY = "smartmarket.wallet"

function isEthereumWallet(wallet: unknown): wallet is ConnectedWallet {
  return Boolean(
    wallet &&
      typeof wallet === "object" &&
      "type" in wallet &&
      (wallet as { type?: unknown }).type === "ethereum" &&
      "address" in wallet &&
      typeof (wallet as { address?: unknown }).address === "string" &&
      "getEthereumProvider" in wallet
  )
}

function sameAddress(a?: string | null, b?: string | null) {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase())
}

export function useActivePrivyWallet() {
  const { ready: authReady, authenticated } = usePrivy()
  const { wallets, ready: walletsReady } = useWallets()
  const { wallet: activeWallet, setActiveWallet } = useActiveWallet()
  const [storedAddress, setStoredAddress] = useState<string | null>(null)
  const ready = authReady && (!authenticated || walletsReady)

  useEffect(() => {
    setStoredAddress(window.localStorage.getItem(ACTIVE_WALLET_KEY))
  }, [])

  const wallet = useMemo(() => {
    if (!ready || !authenticated) return null

    const ethereumWallets = wallets.filter(isEthereumWallet)
    const activeEthereumWallet = isEthereumWallet(activeWallet)
      ? ethereumWallets.find((candidate) => sameAddress(candidate.address, activeWallet.address))
      : null
    const storedWallet = storedAddress
      ? ethereumWallets.find((candidate) => sameAddress(candidate.address, storedAddress))
      : null
    const linkedWallet = ethereumWallets.find((candidate) => candidate.linked)

    return activeEthereumWallet ?? storedWallet ?? linkedWallet ?? ethereumWallets[0] ?? null
  }, [activeWallet, authenticated, ready, storedAddress, wallets])

  useEffect(() => {
    if (!ready || !authenticated || !wallet) return

    window.localStorage.setItem(ACTIVE_WALLET_KEY, wallet.address)
    if (!isEthereumWallet(activeWallet) || !sameAddress(activeWallet.address, wallet.address)) {
      setActiveWallet(wallet)
    }
  }, [activeWallet, authenticated, ready, setActiveWallet, wallet])

  const rememberWallet = (nextWallet: ConnectedWallet | null) => {
    if (!nextWallet) return
    window.localStorage.setItem(ACTIVE_WALLET_KEY, nextWallet.address)
    setStoredAddress(nextWallet.address)
    setActiveWallet(nextWallet)
  }

  return {
    ready,
    authenticated,
    wallet,
    walletAddress: wallet?.address ?? null,
    rememberWallet,
    wallets,
  }
}
