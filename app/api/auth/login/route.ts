import { type NextRequest, NextResponse } from "next/server";
import { supabaseConfigured } from "@/lib/config";
import { clientKey, rateLimit } from "@/lib/http/rate-limit";
import { localAccountByEmail, localAccountByUsername } from "@/lib/server/auth/local";
import { verifyAgainstDummy, verifyPassword } from "@/lib/server/auth/password";
import { cookieOptions, mintSession, SESSION_COOKIE } from "@/lib/server/auth/session";
import { adminDb } from "@/lib/server/db";
import type { MemberRole } from "@/lib/types";

/**
 * POST /api/auth/login — email (or username) + password against `erph.user`.
 *
 * Supabase Auth (GoTrue) is deliberately not used: accounts and password
 * hashes live in our own table and are verified here with scrypt.
 *
 * Teachers and the Guru Besar sign in with their **email**; the pentadbir has
 * no school email to rely on and signs in with their username. One field
 * serves both: an identifier shaped like an address is matched against
 * `email`, anything else against `username`. An account with no email on file
 * is still reachable by its username — the split is guidance, not a lockout.
 *
 * Defences, in the order they apply:
 *   1. rate limit per IP+identifier (one runaway client can't spray passwords)
 *   2. account lockout after 5 failures (15 minutes)
 *   3. constant-time-ish verification — a missing user still pays the scrypt
 *      cost via verifyAgainstDummy, so timing doesn't enumerate accounts
 *   4. generic error message ("… atau kata laluan salah") for every case
 */

const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;

/** The same shape `erph.admin_set_user` (schema.sql) validates email with. */
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Escape LIKE metacharacters before the pattern reaches PostgREST.
 *
 * `.ilike()` passes its value straight into `email ILIKE <pattern>`, so an
 * identifier of `%` would match every account (and `_` would match any single
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
  role: MemberRole;
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
    return NextResponse.json({ error: "JSON tidak sah" }, { status: 400 });
  }

  const identifier = (body.username ?? "").trim();
  const password = body.password ?? "";
  if (!identifier || !password) {
    return NextResponse.json(
      { error: "Nama pengguna dan kata laluan diperlukan" },
      { status: 400 },
    );
  }
  // One field, two doors: an address matches `email`, anything else matches
  // `username`. The body key stays `username` — it is the identifier the
  // client typed, and renaming it would buy nothing.
  const byEmail = EMAIL_RE.test(identifier);

  // A second limit, keyed on the account rather than the network.
  //
  // The one above bounds the total; this one bounds the guesses against a
  // single account. It is derived from the request body, so no header can
  // rotate it — which is what makes it the control that holds when the
  // network key is forged. It applies to every identifier, existent or not, so
  // the 429 says nothing about whether an account is real.
  const accountLimited = rateLimit(`login:acct:${identifier.toLowerCase()}`);
  if (accountLimited) return accountLimited;

  // ── local mode: same code path, demo accounts, no database ────────────────
  if (!supabaseConfigured) {
    // Matched by the same rule as a real lookup: an email finds its account,
    // a bare name finds its username — accepting any identifier against a
    // single hash would hand out the wrong one.
    const account = byEmail
      ? localAccountByEmail(identifier)
      : localAccountByUsername(identifier);
    const ok = account ? await verifyPassword(password, account.password_hash) : false;
    if (!account || !ok) {
      return NextResponse.json(
        {
          error: byEmail
            ? "Emel atau kata laluan salah."
            : "Nama pengguna atau kata laluan salah.",
        },
        { status: 401 },
      );
    }
    const res = NextResponse.json({
      username: account.username,
      fullName: account.full_name,
      role: account.role,
      localMode: true,
    });
    res.cookies.set(SESSION_COOKIE, mintSession(account.id), cookieOptions);
    return res;
  }

  // ── synced mode ──────────────────────────────────────────────────────────
  const db = adminDb();
  const { data, error } = await db
    .from("user")
    .select(
      "id, username, full_name, email, role, password_hash, is_active, failed_logins, locked_until",
    )
    .ilike(byEmail ? "email" : "username", escapeLike(identifier))
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[login] lookup failed:", error.message);
    return NextResponse.json({ error: "Ralat pelayan." }, { status: 500 });
  }

  const user = data as UserRow | null;
  const locked = Boolean(user?.locked_until && new Date(user.locked_until) > new Date());
  /**
   * A lock that has run out starts the count again.
   *
   * Carrying the old total forward would re-arm the lock on the very next
   * guess, so one request per window could hold an account locked for good —
   * and the account owner could do nothing about it, because the counter is
   * only cleared by a successful sign-in. The lock below is not extended
   * while it stands; this is the other half of that promise: the counter
   * does not outlive it either.
   */
  const lockExpired = Boolean(user?.locked_until) && !locked;
  /** The generic 401 names whichever door the caller tried. */
  const badCredentials = () =>
    NextResponse.json(
      {
        error: byEmail
          ? "Emel atau kata laluan salah."
          : "Nama pengguna atau kata laluan salah.",
      },
      { status: 401 },
    );

  if (!user) {
    // Pay the same cost as a real verification so timing leaks nothing.
    await verifyAgainstDummy(password);
    return badCredentials();
  }

  if (!user.is_active) {
    await verifyAgainstDummy(password);
    return badCredentials();
  }

  const ok = await verifyPassword(password, user.password_hash);

  if (!ok) {
    // A locked account gets the *same* generic 401 as an unknown one — telling
    // a caller "this account is locked" would confirm the account exists.
    // The lock is also not extended here: otherwise a flood of guesses could
    // keep a teacher locked out indefinitely.
    if (!locked) {
      // An expired lock starts the count from nothing again, so an attacker
      // has to land five guesses *inside* one window rather than re-arming a
      // stale five.
      const failed = (lockExpired ? 0 : user.failed_logins) + 1;
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

    return badCredentials();
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
