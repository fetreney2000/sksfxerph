/**
 * Session-expiry handling for client fetches.
 *
 * When an API returns 401 the cookie is gone (expired, password changed, or
 * signed out elsewhere). The (app) layout gates on the cookie *server-side*,
 * but it only re-runs on navigation — a page left open overnight would keep
 * rendering, and worse, the data hooks would fall back to their bundled demo
 * fixtures. A reviewer staring at fake plans is a correctness bug, not a
 * cosmetic one, so an expired session forces a round trip to /login.
 *
 * Returns true when the redirect was issued (the caller should stop and
 * return something benign — the page is about to unmount anyway).
 */
export function handleExpiredSession(status: number): boolean {
  if (status !== 401) return false;
  if (typeof window !== "undefined") {
    window.location.replace("/login");
  }
  return true;
}
