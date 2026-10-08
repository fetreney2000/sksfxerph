import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { supabaseConfigured } from "@/lib/config";
import { localAccountById } from "@/lib/server/auth/local";
import {
  type DecodedSession,
  mintSession,
  parseSession,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
} from "@/lib/server/auth/token";
import { adminDb } from "@/lib/server/db";
import type { MemberRole } from "@/lib/types";

/**
 * Cookie session → authenticated user.
 *
 * Verification is two-stage:
 *   1. HMAC + expiry (pure, no I/O) — `lib/server/auth/token.ts`;
 *   2. a live read of `erph.user`, which is what makes these checks *stick*:
 *        • `is_active = false`   → out immediately, not when the cookie expires
 *        • `iat < password_changed_at` → every previously issued cookie dies
 *          the moment a password changes ("log out all devices")
 *
 * Local mode (no Supabase configured) resolves to a fixed demo account so the
 * product is usable offline; stage 1 is identical either way.
 */

export interface SessionUser {
  id: string;
  username: string;
  fullName: string;
  email: string | null;
  role: MemberRole;
  issuedAt: number;
}

function toUser(
  row: {
    id: string;
    username: string;
    full_name: string;
    email: string | null;
    role: MemberRole;
    is_active: boolean;
    password_changed_at: string;
  },
  session: DecodedSession,
): SessionUser | null {
  if (!row.is_active) return null;

  const changed = Math.floor(new Date(row.password_changed_at).getTime() / 1000);
  if (Number.isFinite(changed) && changed > 0 && session.iat < changed) return null;

  return {
    id: row.id,
    username: row.username,
    fullName: row.full_name,
    email: row.email,
    role: row.role,
    issuedAt: session.iat,
  };
}

/** Resolve the current user from a raw cookie value, or null. */
export async function resolveUser(
  cookieValue: string | undefined,
): Promise<SessionUser | null> {
  const session = parseSession(cookieValue);
  if (!session) return null;

  if (!supabaseConfigured) {
    // Resolved by the cookie's subject, not "whoever is demoing" — local mode
    // has more than one account precisely so role separation can be exercised.
    const account = localAccountById(session.sub);
    if (!account) return null;
    return toUser(
      {
        ...account,
        is_active: true,
        // Nothing to invalidate a demo cookie against.
        password_changed_at: new Date(0).toISOString(),
      },
      session,
    );
  }

  try {
    const db = adminDb();
    const { data, error } = await db
      .from("user")
      .select("id, username, full_name, email, role, is_active, password_changed_at")
      .eq("id", session.sub)
      .maybeSingle();
    if (error || !data) {
      console.error("[auth] failed to load session user:", error?.message ?? "not found");
      return null;
    }
    return toUser(data as never, session);
  } catch (err) {
    console.error("[auth] session lookup failed:", err);
    return null;
  }
}

/** Current user in a Server Component / Route Handler (Node runtime). */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  return resolveUser(store.get(SESSION_COOKIE)?.value);
}

/** Current user inside a Route Handler (cookie comes off the NextRequest). */
export async function userFromRequest(req: NextRequest): Promise<SessionUser | null> {
  return resolveUser(req.cookies.get(SESSION_COOKIE)?.value);
}

/** Options shared by login (set) and logout (clear). */
export const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_TTL_SECONDS,
};

export { mintSession, parseSession, SESSION_COOKIE };
