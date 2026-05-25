const path = require("path");

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    root: path.join(__dirname, "..", "..")
  },
  images: {
    // Allow Next.js Image optimisation for any HTTPS source
    // (Polymarket serves images from multiple CDNs: S3, Cloudflare, IPFS gateways)
    remotePatterns: [
      { protocol: "https", hostname: "**" },
    ],
    // Serve modern formats — WebP/AVIF are ~30-50% smaller and visually sharper
    formats: ["image/avif", "image/webp"],
    // Card thumbnails: 44px @1x → need 88px, 132px for HiDPI.
    // Hero panel: ~900px wide. Pre-declare common sizes to avoid layout-shift.
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
    imageSizes: [48, 64, 96, 128, 256],
  },
};

module.exports = nextConfig;
