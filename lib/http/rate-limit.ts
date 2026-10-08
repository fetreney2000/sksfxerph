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

/** Best-effort client identity: JWT subject when present, else the socket. */
export function clientKey(request: Request, fallback: string): string {
  const auth = request.headers.get("authorization");
  if (auth) {
    try {
      const parts = auth.replace(/^bearer\s+/i, "").split(".");
      const payload = parts[1];
      if (!payload) return `ip:${fallback}`;
      const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
      if (typeof json.sub === "string") return `u:${json.sub}`;
    } catch {
      // Malformed token — fall through to the network key.
    }
  }
  return `ip:${fallback}`;
}
