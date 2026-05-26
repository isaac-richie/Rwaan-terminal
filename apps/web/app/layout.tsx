import type { Metadata, Viewport } from "next";
import { Inter, Space_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import Providers from "./providers";
import { MobileNav } from "@/components/mobile-nav";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const spaceMono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-space-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Rawli Analytic — Prediction Terminal",
  description:
    "BNB-native prediction terminal routing live Polymarket markets, liquidity, and trading data.",
  keywords: ["prediction terminal", "rawli analytic", "polymarket", "bnb", "trading"],
  openGraph: {
    title: "Rawli Analytic — Prediction Terminal",
    description: "BNB-native prediction terminal for live markets, liquidity, and trading data.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#0E0E12",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",   // enables safe-area-inset for iOS home bar
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${spaceMono.variable} dark`}>
      <body className="font-sans antialiased">
        <Providers>
          {children}
          <MobileNav />
        </Providers>
        <Analytics />
      </body>
    </html>
  );
}
