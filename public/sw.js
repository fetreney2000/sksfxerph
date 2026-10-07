/**
 * eRPH service worker — hand-rolled rather than Serwist.
 *
 * Why not Serwist: its Turbopack integration is incomplete (GitHub #54), and
 * Next 16 defaults to Turbopack — the build friction documented in
 * erph-frontend-stack.md §7. This file is ~70 lines, has zero bundler coupling,
 * and does exactly what eRPH needs. Swapping in Serwist later is a drop-in if
 * richer runtime caching is ever required.
 *
 * Rules that matter for a lesson-plan app:
 *   • App shell is precached → the dashboard opens with no network.
 *   • Static assets are cache-first (they're content-hashed).
 *   • Navigations are network-first with an offline fallback.
 *   • Authenticated /api/* is NEVER cached — a stale RPH is a correctness bug,
 *     not just a slow screen.
 */

const VERSION = "erph-v1";
const SHELL = ["/minggu", "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== "GET") return;
  if (url.origin !== self.location.origin) return;
  // Never touch the API or auth callbacks.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) return;

  // Navigations: network first, fall back to the cached shell.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          void caches.open(VERSION).then((c) => c.put("/minggu", copy));
          return res;
        })
        .catch(async () => (await caches.match("/minggu")) ?? Response.error()),
    );
    return;
  }

  // Static assets: cache first (hashed filenames make this safe).
  if (url.pathname.startsWith("/_next/static/") || url.pathname === "/icon.svg") {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ??
          fetch(req).then((res) => {
            const copy = res.clone();
            void caches.open(VERSION).then((c) => c.put(req, copy));
            return res;
          }),
      ),
    );
  }
});
