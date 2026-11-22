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

  // The server-side archive PDF route reads the bundled font with
  // `fs.readFile`; without this Next's output tracing may leave it out of the
  // serverless function.
  outputFileTracingIncludes: {
    "/api/export/archive": ["./public/noto-sans-export.woff"],
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

  // Strict CSP + hardening (backend §10, PDPA).
  //
  // The signing keys live in localStorage (lib/signature/keys.ts) — readable
  // by any script on this origin — so "which scripts may run here" is the
  // boundary that matters, and it did not exist: the header block below set
  // everything around CSP without CSP itself. `script-src` keeps
  // `'unsafe-inline'` because the App Router inlines its flight data and there
  // is no nonce plumbing; that still bars every *other* origin except the
  // Google sign-in library, which only loads when the deployment configures it.
  // Fonts are bundled by next/font (self), images are same-origin optimized,
  // and the browser never calls Supabase directly — only the handlers do.
  async headers() {
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://accounts.google.com",
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self'",
      "img-src 'self' data: blob:",
      "connect-src 'self' https://accounts.google.com",
      "frame-src https://accounts.google.com",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; ");
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
