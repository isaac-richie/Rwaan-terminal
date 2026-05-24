"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface to monitoring (Sentry/Vercel) when wired up
    console.error("[Rawali] Unhandled error:", error);
  }, [error]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="surface-card rounded-2xl p-8 max-w-md w-full flex flex-col items-center gap-5 text-center">
        <div className="w-12 h-12 rounded-xl bg-[oklch(0.58_0.2_25/0.12)] border border-[oklch(0.58_0.2_25/0.3)] flex items-center justify-center">
          <AlertTriangle className="w-6 h-6 text-[oklch(0.62_0.18_25)]" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-foreground">Something went wrong</h1>
          <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
            An unexpected error occurred. Your wallet and positions are safe — this is a display issue only.
          </p>
          {error?.digest && (
            <p className="text-[10px] font-mono text-muted-foreground/50 mt-2">
              ref: {error.digest}
            </p>
          )}
        </div>
        <div className="flex gap-3 w-full">
          <Button
            variant="secondary"
            className="flex-1 gap-2"
            onClick={reset}
          >
            <RefreshCw className="w-4 h-4" />
            Try again
          </Button>
          <Button
            variant="secondary"
            className="flex-1"
            onClick={() => (window.location.href = "/")}
          >
            Go home
          </Button>
        </div>
      </div>
    </div>
  );
}
