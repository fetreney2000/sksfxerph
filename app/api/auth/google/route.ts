import { OAuth2Client } from "google-auth-library";
import { type NextRequest, NextResponse } from "next/server";
import { googleAuthConfigured, googleDomain, supabaseConfigured } from "@/lib/config";
import { clientKey, rateLimit } from "@/lib/http/rate-limit";
import {
  checkGoogleClaims,
  type GoogleClaims,
  REJECTION_TEXT,
  resolveAccount,
} from "@/lib/server/auth/google";
import { cookieOptions, mintSession, SESSION_COOKIE } from "@/lib/server/auth/session";
import { adminDb } from "@/lib/server/db";
import type { MemberRole } from "@/lib/types";

/**
 * POST /api/auth/google — sign in with a KPM Google account.
 *
 * Not a second identity system. Google proves *who is holding this browser*;
 * the session it results in is the same HMAC cookie the password route mints,
 * so `schoolIdFor`, the RLS layer and the supervision scope downstream never
 * learn that anything different happened. Supabase Auth is still deliberately
 * unused — partly because it cannot restrict sign-in to a Workspace domain
 * (the `hd` query parameter is advisory, not enforced), which is the entire
 * point here.
 *
 * ── Defences, in the order they apply ───────────────────────────────────────
 *   1. rate limit per IP+client-id
 *   2. a custom request header as CSRF protection. A cross-origin request that
 *      sets one triggers a CORS preflight, which this server never grants, so
 *      the browser refuses to send it. This is the pattern Google recommends
 *      for submitting a credential by `XMLHttpRequest` rather than by their
 *      button's full-page POST (which instead uses the double-submit cookie).
 *   3. `verifyIdToken` — signature against Google's rotating keys, `aud`, `iss`
 *   4. `checkGoogleClaims` — `hd`, `email_verified`, expiry
 *   5. `resolveAccount` — which account, if any, this identity may become
 *   6. the same `is_active` and lockout checks the password route applies
 *
 * A failed Google sign-in never touches `failed_logins`. There is no secret to
 * guess: the failure modes are "not a school account" and "not registered
 * here", neither of which a caller can brute-force into working, and counting
 * them would let someone lock a teacher out by clicking the button repeatedly.
 */

/**
 * Escape LIKE metacharacters before the pattern reaches PostgREST.
 *
 * `.or()` interpolates the value into an `ilike` pattern, so an email of `%`
 * would match every account. Escaping makes the match literal.
 */
const escapeLike = (value: string) => value.replace(/[\\%_]/g, (m) => `\\${m}`);

interface UserRow {
  id: string;
  username: string;
  full_name: string;
  email: string | null;
  role: MemberRole;
  is_active: boolean;
  locked_until: string | null;
  google_sub: string | null;
  google_email: string | null;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!googleAuthConfigured || !supabaseConfigured) {
    return NextResponse.json({ error: "Log masuk Google tidak tersedia" }, { status: 503 });
  }

  // Before anything else: a request without this header cannot have come from
  // our page, because a cross-origin caller would have to preflight it.
  if (request.headers.get("x-requested-with") !== "XMLHttpRequest") {
    return NextResponse.json({ error: "Sahkan asal permintaan gagal" }, { status: 403 });
  }

  const limited = rateLimit(
    `google:${clientKey(request, request.headers.get("x-forwarded-for") ?? "anon")}`,
  );
  if (limited) return limited;

  let body: { credential?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Permintaan tidak sah" }, { status: 400 });
  }
  if (!body.credential) {
    return NextResponse.json({ error: "Tiada kelayakan Google" }, { status: 400 });
  }

  let claims: GoogleClaims | undefined;
  try {
    const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
    const ticket = await client.verifyIdToken({
      idToken: body.credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    claims = ticket.getPayload() as GoogleClaims | undefined;
  } catch (e) {
    console.error("[google] token verification failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Token Google tidak sah" }, { status: 401 });
  }
  if (!claims) return NextResponse.json({ error: "Token Google tidak sah" }, { status: 401 });

  const checked = checkGoogleClaims(claims, { domain: googleDomain });
  if (!checked.ok) {
    return NextResponse.json({ error: REJECTION_TEXT[checked.reason] }, { status: 403 });
  }

  const db = adminDb();
  const { data, error } = await db
    .from("user")
    .select(
      "id, username, full_name, email, role, is_active, locked_until, google_sub, google_email",
    )
    .or(`google_sub.eq.${checked.sub},email.ilike.${escapeLike(checked.email)}`);

  if (error) {
    console.error("[google] lookup failed:", error.message);
    return NextResponse.json({ error: "Ralat pelayan." }, { status: 500 });
  }

  const rows = (data ?? []) as unknown as UserRow[];
  const resolved = resolveAccount(
    { sub: checked.sub, email: checked.email },
    rows.map((r) => ({ id: r.id, email: r.email, google_sub: r.google_sub })),
  );

  if (resolved.kind === "not-registered") {
    // Deliberately not a generic failure: the teacher needs to know this is an
    // administrator's problem, not something retrying will fix. It reveals
    // nothing an attacker could use — the address had to be verified and inside
    // the school's Workspace domain to get this far.
    return NextResponse.json(
      { error: "Akaun Google ini belum didaftarkan di sini. Sila hubungi pentadbir sekolah." },
      { status: 403 },
    );
  }

  const user = rows.find((r) => r.id === resolved.row.id);
  if (!user) return NextResponse.json({ error: "Ralat pelayan." }, { status: 500 });

  if (!user.is_active) {
    return NextResponse.json({ error: "Akaun ini tidak aktif." }, { status: 403 });
  }
  // An administrator-locked account must not be walkable around with Google.
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    return NextResponse.json(
      { error: "Akaun dikunci selepas percubaan gagal. Cuba lagi kemudian." },
      { status: 423 },
    );
  }

  if (resolved.kind === "link") {
    const { error: linkErr } = await db
      .from("user")
      .update({
        google_sub: checked.sub,
        google_email: checked.email,
        last_login_at: new Date().toISOString(),
      })
      .eq("id", user.id);

    if (linkErr) {
      // `google_sub` is UNIQUE, so two simultaneous first sign-ins race here.
      // The loser is told to try again rather than shown a database error.
      console.error("[google] linking failed:", linkErr.message);
      return NextResponse.json(
        { error: "Gagal memautkan akaun. Sila cuba lagi." },
        { status: 409 },
      );
    }

    // The only moment worth auditing: an account's identity binding changed.
    // Ordinary sign-ins are not logged, matching the password route.
    await audit(db, user.id, "pautkan-google", {
      google_email: checked.email,
      sub: checked.sub,
    });
  } else {
    const { error: loginErr } = await db
      .from("user")
      .update({ last_login_at: new Date().toISOString() })
      .eq("id", user.id);
    if (loginErr) console.error("[google] failed to record sign-in:", loginErr.message);
  }

  const res = NextResponse.json({
    username: user.username,
    fullName: user.full_name,
    role: user.role,
    localMode: false,
    linked: resolved.kind === "link",
  });
  res.cookies.set(SESSION_COOKIE, mintSession(user.id), cookieOptions);
  return res;
}

/**
 * Fire-and-forget audit write.
 *
 * A failure here must not turn a successful sign-in into an error the teacher
 * sees — but it is logged, so the gap stays visible rather than becoming a
 * silent hole in the record.
 */
async function audit(
  db: ReturnType<typeof adminDb>,
  userId: string,
  action: string,
  after: Record<string, unknown>,
): Promise<void> {
  try {
    const { data: school } = await db
      .from("school_member")
      .select("school_id")
      .eq("user_id", userId)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    await db.from("audit_log").insert({
      school_id: (school as { school_id: string } | null)?.school_id ?? null,
      actor_id: userId,
      entity: "user",
      entity_id: userId,
      action,
      after,
    });
  } catch (e) {
    console.error("[google] audit write failed:", e);
  }
}
