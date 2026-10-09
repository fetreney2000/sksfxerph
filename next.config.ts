import type { NextConfig } from "next";

/**
 * The school's logo lives in the deployment's own Supabase storage bucket, so
 * `next/image` has to be allowed to optimise it. The host is per-project, so
 * it is derived from `NEXT_PUBLIC_SUPABASE_URL` rather than hard-coded — and
 * narrowed to the public-object path so this cannot become a general
 * allow-list for whatever else happens to share the host.
 *
 * Empty in local mode, where there is no bucket and the crest is `/logo.png`.
 */
const storageHost = (() => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
})();

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
    remotePatterns: storageHost
      ? [
          {
            protocol: "https",
            hostname: storageHost,
            pathname: "/storage/v1/object/public/**",
          },
        ]
      : [],
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
