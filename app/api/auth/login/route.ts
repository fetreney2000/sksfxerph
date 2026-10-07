import { type NextRequest, NextResponse } from "next/server";
import { supabaseConfigured } from "@/lib/config";
import { clientKey, rateLimit } from "@/lib/http/rate-limit";
import { LOCAL_ACCOUNT } from "@/lib/server/auth/local";
import { verifyAgainstDummy, verifyPassword } from "@/lib/server/auth/password";
import { cookieOptions, mintSession, SESSION_COOKIE } from "@/lib/server/auth/session";
import { adminDb } from "@/lib/server/db";

/**
 * POST /api/auth/login — username + password against `erph.user`.
 *
 * Supabase Auth (GoTrue) is deliberately not used: accounts and password
 * hashes live in our own table and are verified here with scrypt.
 *
 * Defences, in the order they apply:
 *   1. rate limit per IP+username (one runaway client can't spray passwords)
 *   2. account lockout after 5 failures (15 minutes)
 *   3. constant-time-ish verification — a missing user still pays the scrypt
 *      cost via verifyAgainstDummy, so timing doesn't enumerate usernames
 *   4. generic error message ("username atau kata laluan salah") for every case
 */

const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;

/**
 * Escape LIKE metacharacters before the pattern reaches PostgREST.
 *
 * `.ilike()` passes its value straight into `username ILIKE <pattern>`, so a
 * username of `%` would match every account (and `_` would match any single
 * character). Combined with `.limit(1)` that means an attacker could aim the
 * lookup at an arbitrary row. Escaping makes the match literal — case-
 * insensitive, but exact.
 */
const escapeLike = (value: string) => value.replace(/[\\%_]/g, (m) => `\\${m}`);

interface UserRow {
  id: string;
  username: string;
  full_name: string;
  email: string | null;
  role: "teacher" | "coordinator" | "admin" | "ppd" | "jpn" | "system";
  password_hash: string;
  is_active: boolean;
  failed_logins: number;
  locked_until: string | null;
}

export async function POST(request: NextRequest) {
  const limited = rateLimit(
    `login:${clientKey(request, request.headers.get("x-forwarded-for") ?? "anon")}`,
  );
  if (limited) return limited;

  let body: { username?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const username = (body.username ?? "").trim();
  const password = body.password ?? "";
  if (!username || !password) {
    return NextResponse.json({ error: "username dan kata laluan diperlukan" }, { status: 400 });
  }

  // ── local mode: same code path, demo account, no database ────────────────
  if (!supabaseConfigured) {
    const ok = await verifyPassword(password, LOCAL_ACCOUNT.password_hash);
    if (!ok) {
      return NextResponse.json({ error: "Username atau kata laluan salah." }, { status: 401 });
    }
    const res = NextResponse.json({
      username: LOCAL_ACCOUNT.username,
      fullName: LOCAL_ACCOUNT.full_name,
      role: LOCAL_ACCOUNT.role,
      localMode: true,
    });
    res.cookies.set(SESSION_COOKIE, mintSession(LOCAL_ACCOUNT.id), cookieOptions);
    return res;
  }

  // ── synced mode ──────────────────────────────────────────────────────────
  const db = adminDb();
  const { data, error } = await db
    .from("user")
    .select(
      "id, username, full_name, email, role, password_hash, is_active, failed_logins, locked_until",
    )
    .ilike("username", escapeLike(username))
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[login] lookup failed:", error.message);
    return NextResponse.json({ error: "Ralat pelayan." }, { status: 500 });
  }

  const user = data as UserRow | null;
  const locked = Boolean(user?.locked_until && new Date(user.locked_until) > new Date());

  if (!user) {
    // Pay the same cost as a real verification so timing leaks nothing.
    await verifyAgainstDummy(password);
    return NextResponse.json({ error: "Username atau kata laluan salah." }, { status: 401 });
  }

  if (!user.is_active) {
    await verifyAgainstDummy(password);
    return NextResponse.json({ error: "Username atau kata laluan salah." }, { status: 401 });
  }

  const ok = await verifyPassword(password, user.password_hash);

  if (!ok) {
    // A locked account gets the *same* generic 401 as an unknown one — telling
    // a caller "this account is locked" would confirm the username exists.
    // The lock is also not extended here: otherwise a flood of guesses could
    // keep a teacher locked out indefinitely.
    if (!locked) {
      const failed = user.failed_logins + 1;
      const shouldLock = failed >= MAX_FAILURES;
      const { error: updErr } = await db
        .from("user")
        .update({
          failed_logins: failed,
          locked_until: shouldLock
            ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString()
            : null,
        })
        .eq("id", user.id);
      if (updErr) console.error("[login] failed to record failure:", updErr.message);
    }

    return NextResponse.json({ error: "Username atau kata laluan salah." }, { status: 401 });
  }

  // Password proved correct — *now* the lock message is safe to reveal, and it
  // is what the legitimate owner needs to hear (rather than "wrong password").
  if (locked) {
    return NextResponse.json(
      { error: "Akaun dikunci selepas percubaan gagal. Cuba lagi kemudian." },
      { status: 423 },
    );
  }

  const { error: okErr } = await db
    .from("user")
    .update({ failed_logins: 0, locked_until: null, last_login_at: new Date().toISOString() })
    .eq("id", user.id);
  if (okErr) console.error("[login] failed to reset counters:", okErr.message);

  const res = NextResponse.json({
    username: user.username,
    fullName: user.full_name,
    role: user.role,
    localMode: false,
  });
  res.cookies.set(SESSION_COOKIE, mintSession(user.id), cookieOptions);
  return res;
}
