import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

/**
 * Inter is bundled by next/font at build time and served from our own origin —
 * no runtime request to fonts.googleapis.com (render-blocking + a third party
 * touching teacher traffic under PDPA).
 */
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "eRPH · Rancangan Pengajaran Harian",
  description:
    "Sistem Rancangan Pengajaran Harian Secara Dalam Talian bagi guru di sekolah bawah Kementerian Pendidikan Malaysia.",
  applicationName: "eRPH",
  manifest: "/manifest.webmanifest",
  // The school crest, not the "eR" mark — a teacher should recognise the tab
  // as their own school's before reading a word of it.
  icons: { icon: "/logo.png", apple: "/logo.png" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f7fa" },
    { media: "(prefers-color-scheme: dark)", color: "#0c111c" },
  ],
  width: "device-width",
  initialScale: 1,
};

/**
 * Applies the saved theme before React mounts. Runs as a blocking script so a
 * teacher in dark mode never sees a white flash on a slow connection.
 */
const themeInit = `(function(){try{var t=localStorage.getItem("erph-theme");if(t==="dark"||(!t&&matchMedia("(prefers-color-scheme: dark)").matches)){document.documentElement.setAttribute("data-theme","dark")}}catch(e){}})();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ms" className={inter.variable} suppressHydrationWarning>
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: themeInit is a
            build-time constant with no interpolation — this runs before hydration
            to avoid a white flash for teachers in dark mode. */}
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body>
        <Toaster
          position="bottom-center"
          toastOptions={{
            style: {
              background: "var(--color-ink)",
              color: "var(--color-surface)",
              border: "none",
              borderRadius: "11px",
              fontSize: "13px",
            },
          }}
        />
        {children}
      </body>
    </html>
  );
}
