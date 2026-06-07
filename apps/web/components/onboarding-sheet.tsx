"use client"

import { useEffect, useRef, useState, type TouchEvent } from "react"
import { TrendingUp, CheckCircle2, ShieldCheck, Sparkles, X, ArrowRight } from "lucide-react"
import { cn } from "@/lib/utils"

const STORAGE_KEY = "rawli_onboarded_v1"

const STEPS = [
  {
    icon: TrendingUp,
    iconColor: "oklch(0.78 0.16 82)",
    iconBg: "oklch(0.78 0.16 82 / 0.12)",
    badge: "Step 1 of 4",
    title: "Pick an event",
    body: "Browse live markets in sports, crypto, politics, and more. Each market asks one simple Yes or No question.",
    hint: null,
  },
  {
    icon: Sparkles,
    iconColor: "oklch(0.72 0.16 250)",
    iconBg: "oklch(0.72 0.16 250 / 0.12)",
    badge: "Step 2 of 4",
    title: "Buy YES or NO",
    body: "Shares trade between 0¢ and 100¢. The price reflects what the crowd thinks will happen. You decide if they're right or wrong.",
    hint: "Example: YES at 35¢ means the crowd gives it a 35% chance.",
  },
  {
    icon: CheckCircle2,
    iconColor: "oklch(0.68 0.18 155)",
    iconBg: "oklch(0.68 0.18 155 / 0.12)",
    badge: "Step 3 of 4",
    title: "Win $1 if you're right",
    body: "When the event resolves, each winning share pays exactly $1. Your profit is the difference between $1 and what you paid.",
    hint: "Example: Buy YES at 40¢ → event happens → collect $1. That's 60¢ profit.",
  },
  {
    icon: ShieldCheck,
    iconColor: "oklch(0.74 0.14 25)",
    iconBg: "oklch(0.74 0.14 25 / 0.12)",
    badge: "Step 4 of 4",
    title: "Your money stays yours",
    body: "Rawli never holds your funds. Your wallet keeps control of every asset and every signature.",
    hint: null,
  },
]

export function OnboardingSheet() {
  const [visible, setVisible] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [step, setStep] = useState(0)
  const [animating, setAnimating] = useState(false)
  const touchStartX = useRef<number | null>(null)
  const touchStartY = useRef<number | null>(null)

  useEffect(() => {
    // Only show if not already onboarded
    try {
      if (!localStorage.getItem(STORAGE_KEY)) {
        // Small delay so the page loads first
        const t = setTimeout(() => setVisible(true), 900)
        return () => clearTimeout(t)
      }
    } catch {
      // localStorage blocked (incognito strict mode etc.) — just don't show
    }
  }, [])

  // Animate sheet in after visibility flag
  useEffect(() => {
    if (visible) {
      const t = setTimeout(() => setMounted(true), 30)
      return () => clearTimeout(t)
    }
  }, [visible])

  function dismiss() {
    setMounted(false)
    setTimeout(() => {
      setVisible(false)
      try { localStorage.setItem(STORAGE_KEY, "1") } catch { /* noop */ }
    }, 350)
  }

  function goNext() {
    if (step < STEPS.length - 1) {
      setAnimating(true)
      setTimeout(() => {
        setStep((s) => s + 1)
        setAnimating(false)
      }, 150)
    } else {
      dismiss()
    }
  }

  function goPrevious() {
    if (step <= 0 || animating) return
    setAnimating(true)
    setTimeout(() => {
      setStep((s) => s - 1)
      setAnimating(false)
    }, 150)
  }

  function goTo(i: number) {
    if (i === step || animating) return
    setAnimating(true)
    setTimeout(() => {
      setStep(i)
      setAnimating(false)
    }, 150)
  }

  function handleTouchStart(event: TouchEvent<HTMLDivElement>) {
    const touch = event.touches[0]
    touchStartX.current = touch.clientX
    touchStartY.current = touch.clientY
  }

  function handleTouchEnd(event: TouchEvent<HTMLDivElement>) {
    const startX = touchStartX.current
    const startY = touchStartY.current
    touchStartX.current = null
    touchStartY.current = null
    if (startX === null || startY === null) return

    const touch = event.changedTouches[0]
    const deltaX = touch.clientX - startX
    const deltaY = touch.clientY - startY
    if (Math.abs(deltaX) < 48 || Math.abs(deltaX) < Math.abs(deltaY)) return

    if (deltaX < 0) goNext()
    else goPrevious()
  }

  if (!visible) return null

  const current = STEPS[step]
  const Icon = current.icon
  const isLast = step === STEPS.length - 1

  return (
    <div className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center">
      {/* Backdrop */}
      <div
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        className={cn(
          "absolute inset-0 bg-black/60 transition-opacity duration-350 sm:backdrop-blur-sm",
          mounted ? "opacity-100" : "opacity-0"
        )}
        onClick={dismiss}
      />

      {/* Sheet */}
      <div
        className={cn(
          "relative z-10 w-full sm:max-w-md flex flex-col rounded-t-3xl sm:rounded-2xl overflow-hidden",
          "border border-[oklch(0.22_0.015_255)] bg-[oklch(0.09_0.010_260)] shadow-2xl",
          "transition-transform duration-350 ease-out",
          mounted ? "translate-y-0" : "translate-y-full sm:translate-y-8 sm:opacity-0"
        )}
      >
        {/* Drag handle (mobile) */}
        <div className="flex justify-center pt-3 pb-1 sm:hidden">
          <div className="w-10 h-1 rounded-full bg-[oklch(0.28_0.015_255)]" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-2 sm:pt-5">
          <div className="flex items-center gap-2">
            <div
              className="rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest"
              style={{
                background: current.iconBg,
                color: current.iconColor,
              }}
            >
              {current.badge}
            </div>
          </div>
          <button
            onClick={dismiss}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-[oklch(0.16_0.013_260)] text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Content */}
        <div
          className={cn(
            "px-5 pt-4 pb-6 transition-opacity duration-150",
            animating ? "opacity-0" : "opacity-100"
          )}
        >
          {/* Icon */}
          <div
            className="mb-5 inline-flex h-14 w-14 items-center justify-center rounded-2xl"
            style={{ background: current.iconBg }}
          >
            <Icon className="h-7 w-7" style={{ color: current.iconColor }} />
          </div>

          {/* Title */}
          <h2 className="text-[22px] font-bold leading-tight text-foreground mb-3">
            {current.title}
          </h2>

          {/* Body */}
          <p className="text-[14px] leading-6 text-muted-foreground">
            {current.body}
          </p>

          {/* Hint box */}
          {current.hint && (
            <div className="mt-4 rounded-xl border border-[oklch(0.22_0.015_255)] bg-[oklch(0.13_0.012_260)] px-4 py-3">
              <p className="text-[12px] leading-5 text-muted-foreground/80">
                <span className="font-semibold text-[oklch(0.78_0.16_82)]">Example: </span>
                {current.hint.replace("Example: ", "")}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-[oklch(0.16_0.013_260)] px-5 py-4 pb-safe-bottom">
          <div className="flex items-center justify-between">
            {/* Step dots */}
            <div className="flex items-center gap-2">
              {STEPS.map((_, i) => (
                <button
                  key={i}
                  onClick={() => goTo(i)}
                  className={cn(
                    "rounded-full transition-all duration-300",
                    i === step
                      ? "w-5 h-2 bg-[oklch(0.78_0.16_82)]"
                      : "w-2 h-2 bg-[oklch(0.28_0.015_255)] hover:bg-[oklch(0.38_0.015_255)]"
                  )}
                />
              ))}
            </div>

            {/* CTA button */}
            <button
              onClick={goNext}
              className={cn(
                "flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-bold transition-all duration-200 active:scale-95",
                isLast
                  ? "bg-[oklch(0.78_0.16_82)] text-black hover:bg-[oklch(0.82_0.16_82)]"
                  : "bg-[oklch(0.16_0.013_260)] text-foreground border border-[oklch(0.24_0.015_255)] hover:bg-[oklch(0.20_0.014_260)]"
              )}
            >
              {isLast ? (
                <>Let me explore</>
              ) : (
                <>
                  Next
                  <ArrowRight className="h-3.5 w-3.5" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
