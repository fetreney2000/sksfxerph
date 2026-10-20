import { NextResponse } from "next/server";

/**
 * Sliding-window rate limiter for anon-key endpoints (backend §5 checklist:
 * "rate limiting isn't provided by Supabase").
 *
 * In-memory and per-instance — correct for this deployment (one school, one
 * Vercel instance, no horizontal scaling) and it costs no dependency and no
 * extra service on the free tier. If the app is ever scaled across instances
 * this must move to a shared store (Upstash Rate Limit, stack §11); the call
 * sites do not change, only the implementation behind `rateLimit()`.
 *
 * Deliberately generous: this exists to stop a runaway client or a scraping
 * loop, not to throttle a teacher.
 */
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 60;

const hits = new Map<string, { count: number; resetAt: number }>();

/** Returns null when allowed, or a ready-to-return error response. */
export function rateLimit(key: string): NextResponse | null {
  const now = Date.now();
  const entry = hits.get(key);

  if (!entry || entry.resetAt <= now) {
    hits.set(key, { count: 1, resetAt: now + WINDOW_MS });
    // Opportunistic prune so a long-lived process doesn't accumulate keys.
    if (hits.size > 5_000) {
      for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
    }
    return null;
  }

  entry.count += 1;
  if (entry.count <= MAX_PER_WINDOW) return null;

  const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
  return NextResponse.json(
    { error: "Terlalu banyak permintaan", retry_after: retryAfter },
    { status: 429, headers: { "retry-after": String(retryAfter) } },
  );
}

/**
 * Best-effort client identity: the caller's network address.
 *
 * This used to read the `Authorization` header and key on the JWT's `sub`.
 * Nothing here verifies that JWT — it was decoded and trusted — so `sub` was
 * simply whatever the caller put inside it. A caller could send
 * `Authorization: Bearer <base64url of {"sub":"1"}>` and land in a fresh bucket
 * on every request, which is precisely what the limiter exists to prevent: the
 * login route's account lockout became a one-request-per-window denial of
 * service against every account in the school.
 *
 * The browser never sends an Authorization header at all — sessions are
 * httpOnly cookies and the publishable key is never used as a bearer token —
 * so the JWT branch had no legitimate caller to serve. The limit that cannot
 * be forged is the one keyed on the account: the login route adds a second
 * bucket from the username in the request body, which no header can rotate.
 */
export function clientKey(request: Request, fallback: string): string {
  return `ip:${clientIp(request, fallback)}`;
}

/**
 * The caller's network address.
 *
 * The first hop of `x-forwarded-for` — the original client in the standard
 * chain — then `x-real-ip`, then whatever the caller passed as the fallback.
 * The first hop rather than the last because a school behind a shared proxy
 * would otherwise put every teacher in one bucket, and one noisy teacher's
 * retries would then lock the whole school out of logging in for a minute.
 *
 * A caller that can prepend to `x-forwarded-for` can still rotate this bucket.
 * That is why the per-account limit exists alongside it: the account limit is
 * derived from the request body, so forging headers does not help.
 */
export function clientIp(request: Request, fallback: string): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = request.headers.get("x-real-ip")?.trim();
  if (real) return real;
  return fallback;
}
