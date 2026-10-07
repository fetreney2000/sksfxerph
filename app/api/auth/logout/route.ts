import { NextResponse } from "next/server";
import { cookieOptions, SESSION_COOKIE } from "@/lib/server/auth/session";

/**
 * POST /api/auth/logout.
 *
 * Sessions are stateless signed cookies, so "logging out" is deleting this
 * browser's cookie — the server keeps no row to revoke. To end a session for
 * *every* device, change the password: cookies carry their issue time and are
 * rejected when `iat < password_changed_at`.
 */
export async function POST(): Promise<NextResponse> {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { ...cookieOptions, maxAge: 0 });
  return res;
}
