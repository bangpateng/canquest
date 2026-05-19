import type { NextConfig } from "next";

/**
 * Dev webpack cache: `memory` avoids the giant filesystem cache on low‑RAM setups while
 * still keeping a consistent chunk graph — `cache: false` can leave a broken `.next` on
 * Windows (e.g. `Cannot find module './331.js'` + GET 500 until you delete `.next`).
 *
 * Escape hatch if you truly need zero cache: `NEXT_WEBPACK_DISABLE_CACHE=true npm run dev`
 */
const nextConfig: NextConfig = {
  // Allow Next.js Image Optimization to serve images from the API CDN
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "api.canquest.cc",
        pathname: "/quest-media/**",
      },
    ],
  },

  // Vercel multi-domain: both canquest.cc and app.canquest.cc point to this app.
  // Middleware (middleware.ts) handles hostname-based routing between them.

  webpack: (config, { dev }) => {
    if (dev) {
      if (process.env.NEXT_WEBPACK_DISABLE_CACHE === "true") {
        config.cache = false;
      } else {
        config.cache = { type: "memory" };
      }
    }
    return config;
  },
};

export default nextConfig;
