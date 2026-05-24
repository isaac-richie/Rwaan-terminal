import Link from "next/link";
import { Compass } from "lucide-react";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />
      <main className="flex-1 flex items-center justify-center px-4">
        <div className="surface-card rounded-2xl p-10 max-w-sm w-full flex flex-col items-center gap-5 text-center">
          <div className="w-12 h-12 rounded-xl bg-[oklch(0.78_0.16_82/0.1)] border border-[oklch(0.78_0.16_82/0.2)] flex items-center justify-center">
            <Compass className="w-6 h-6 text-[oklch(0.78_0.16_82)]" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-foreground">Page not found</h1>
            <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
              This page doesn't exist or the market was removed from the feed.
            </p>
          </div>
          <Link
            href="/"
            className="w-full h-10 rounded-xl bg-[oklch(0.78_0.16_82/0.12)] border border-[oklch(0.78_0.16_82/0.3)] text-[oklch(0.78_0.16_82)] text-sm font-semibold flex items-center justify-center hover:bg-[oklch(0.78_0.16_82/0.2)] transition-all"
          >
            Back to markets
          </Link>
        </div>
      </main>
      <Footer />
    </div>
  );
}
