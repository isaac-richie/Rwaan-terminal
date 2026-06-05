"use client"

import { Component, type ReactNode } from "react"
import { AlertTriangle, RefreshCw } from "lucide-react"

interface Props {
  children: ReactNode
  /** Optional: custom fallback UI */
  fallback?: ReactNode
  /** Optional: compact single-line fallback for embedded components */
  compact?: boolean
  /** Called when user clicks retry */
  onReset?: () => void
}

interface State {
  error: Error | null
}

/**
 * ComponentErrorBoundary — local error boundary for modals, panels, and
 * feature sections. Catches render-time errors that would otherwise propagate
 * to the Next.js page-level boundary and nuke the whole screen.
 *
 * Usage:
 *   <ComponentErrorBoundary compact>
 *     <SomeRiskyModal />
 *   </ComponentErrorBoundary>
 */
export class ComponentErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    // Surface to monitoring in production
    console.error("[Rawli] Component error caught by boundary:", error, info?.componentStack)
  }

  reset = () => {
    this.setState({ error: null })
    this.props.onReset?.()
  }

  render() {
    if (!this.state.error) return this.props.children

    if (this.props.fallback) return this.props.fallback

    if (this.props.compact) {
      return (
        <div className="flex items-center gap-2 rounded-xl border border-[oklch(0.58_0.2_25/0.30)] bg-[oklch(0.58_0.2_25/0.07)] p-3 text-xs text-[oklch(0.72_0.18_25)]">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>Something went wrong loading this section.</span>
          <button
            type="button"
            onClick={this.reset}
            className="ml-auto flex items-center gap-1 rounded-lg border border-[oklch(0.58_0.2_25/0.30)] px-2 py-1 text-[10px] font-semibold transition-colors hover:bg-[oklch(0.58_0.2_25/0.12)]"
          >
            <RefreshCw className="h-2.5 w-2.5" />
            Retry
          </button>
        </div>
      )
    }

    return (
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-[oklch(0.22_0.015_255)] bg-[oklch(0.11_0.012_260)] p-8 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-[oklch(0.58_0.2_25/0.30)] bg-[oklch(0.58_0.2_25/0.08)]">
          <AlertTriangle className="h-6 w-6 text-[oklch(0.62_0.18_25)]" />
        </div>
        <div>
          <p className="font-semibold text-foreground">Something went wrong</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Your wallet and positions are safe. This section failed to load.
          </p>
        </div>
        <button
          type="button"
          onClick={this.reset}
          className="flex items-center gap-2 rounded-xl border border-[oklch(0.22_0.015_255)] bg-[oklch(0.16_0.014_255)] px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-[oklch(0.20_0.014_255)]"
        >
          <RefreshCw className="h-4 w-4" />
          Try again
        </button>
      </div>
    )
  }
}
