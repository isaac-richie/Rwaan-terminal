"use client"

import { useEffect } from "react"

const MOBILE_QUERY = "(max-width: 639px)"

function patchPrivyBackdrop() {
  const backdrop = document.getElementById("privy-dialog-backdrop")
  if (!backdrop) return

  if (!window.matchMedia(MOBILE_QUERY).matches) {
    backdrop.style.removeProperty("background")
    backdrop.style.removeProperty("backdrop-filter")
    backdrop.style.removeProperty("-webkit-backdrop-filter")
    backdrop.style.removeProperty("transition")
    return
  }

  backdrop.style.setProperty("background", "oklch(0.04 0.01 260 / 0.72)", "important")
  backdrop.style.setProperty("backdrop-filter", "blur(0px)", "important")
  backdrop.style.setProperty("-webkit-backdrop-filter", "blur(0px)", "important")
  backdrop.style.setProperty("transition", "opacity 120ms ease", "important")
}

export function PrivyBackdropPatch() {
  useEffect(() => {
    const media = window.matchMedia(MOBILE_QUERY)
    const run = () => {
      window.requestAnimationFrame(() => {
        patchPrivyBackdrop()
        window.setTimeout(patchPrivyBackdrop, 80)
      })
    }

    run()

    const observer = new MutationObserver(run)
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "id", "style"],
    })

    media.addEventListener("change", run)

    return () => {
      observer.disconnect()
      media.removeEventListener("change", run)
    }
  }, [])

  return null
}
