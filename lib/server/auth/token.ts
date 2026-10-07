import { createHmac, timingSafeEqual } from "node:crypto";
import { supabaseConfigured } from "@/lib/config";

/**
 * The session cookie's wire format — pure crypto, no Next.js imports, so it
 * can be unit-tested outside a request.
 *
 *   base64url(user id) . issued-at . expires-at . base64url(HMAC-SHA256)
 *
 * Why stateless instead of a session table: a single-school tool does not need
 * server-side session storage to be correct. Revocation still works, because
 * `resolveUser` additionally checks `is_active` and `iat >=
 * password_changed_at` against the live row — deactivate a teacher or change a
 * password and the cookie dies on the next request.
 */

export const SESSION_COOKIE = "erph_session";
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

const DEV_SECRET = "erph-local-mode-insecure-development-secret";

/**
 * Signing key. A deployment that has Supabase configured MUST provide its own
 * ≥32-char secret: signing with the dev default would let anyone mint a cookie
 * for any user id. Local mode has no remote to attack, so the default is fine
 * there (and is clearly labelled as such).
 */
function signingSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 32) return s;
  if (supabaseConfigured) {
    throw new Error(
      "SESSION_SECRET must be set (≥32 chars) when Supabase is configured — " +
        "signing sessions with a default would let anyone forge a cookie.",
    );
  }
  return DEV_SECRET;
}

export interface DecodedSession {
  sub: string;
  iat: number;
  exp: number;
}

const b64u = (input: string | Buffer) => Buffer.from(input).toString("base64url");

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/** Create the cookie value for a user. */
export function mintSession(userId: string, nowMs = Date.now()): string {
  const iat = Math.floor(nowMs / 1000);
  const payload = `${b64u(userId)}.${iat}.${iat + SESSION_TTL_SECONDS}`;
  return `${payload}.${sign(payload, signingSecret())}`;
}

/** Verify signature + expiry. Returns null for anything malformed. */
export function parseSession(value: string | undefined | null): DecodedSession | null {
  if (!value) return null;

  let secret: string;
  try {
    secret = signingSecret();
  } catch {
    // Misconfigured deployment — refuse every session rather than fall back.
    return null;
  }

  const parts = value.split(".");
  if (parts.length !== 4) return null;

  const [subB64, iat, exp, sig] = parts as [string, string, string, string];
  const payload = `${subB64}.${iat}.${exp}`;

  const expected = Buffer.from(sign(payload, secret));
  const actual = Buffer.from(sig);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null;
  }

  const iatN = Number(iat);
  const expN = Number(exp);
  if (!Number.isInteger(iatN) || !Number.isInteger(expN)) return null;
  if (expN * 1000 < Date.now()) return null;

  let sub: string;
  try {
    sub = Buffer.from(subB64, "base64url").toString("utf8");
  } catch {
    return null;
  }
  if (!sub) return null;

  return { sub, iat: iatN, exp: expN };
}
