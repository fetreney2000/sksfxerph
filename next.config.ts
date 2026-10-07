import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Keep the JS budget honest (erph-frontend-stack.md §9: ≤170 KB First Load JS).
  // Experimental package optimisation strips unused exports from lucide-react etc.
  experimental: {
    optimizePackageImports: ["lucide-react", "@tanstack/react-table"],
  },

  // Hobby bandwidth: serve AVIF/WebP only, never upscale.
  images: {
    formats: ["image/avif", "image/webp"],
    qualities: [75],
    // No remote images at all in this app — everything is local icons/SVG.
    remotePatterns: [],
  },

  // Strict CSP + SW hardening (backend §10, PDPA).
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
