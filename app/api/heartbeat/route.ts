import { timingSafeEqual } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import { supabaseConfigured } from "@/lib/config";
import { adminDb, hasAdminCredentials } from "@/lib/server/db";

/**
 * Keep-alive heartbeat + deployment diagnostics.
 *
 * Called once a day by Vercel Cron (Hobby cron fires at most 1×/day — see
 * erph-backend-research.md §2.1) so that the **Supabase free project never
 * auto-pauses**. A paused project would mean the whole school gets an error on
 * Monday morning after a 7-day holiday, and pausing also stops pg_cron, so the
 * heartbeat must come from *outside* Supabase.
 *
 * It also answers the two questions you want answered first when auth is
 * hand-rolled: can we reach the database at all, and does `erph.actor()`
 * resolve a user id from the `X-Erph-User` header? If `actor` reports `broken`
 * while `db` reports `ok`, PostgREST is not surfacing the secret key's role —
 * see §3b of db/schema.sql.
 *
 * ## What an anonymous caller is told
 *
 * Only `ok`. The other figures — `db`, `actor`, `mode`, `latency_ms` — tell an
 * attacker whether this deployment is live, whether it has a database, and
 * whether the secret key is wired up, which is reconnaissance for the next
 * attempt rather than an answer to any question a caller should be asking.
 *
 * The probe still runs for everyone: reaching the database is the whole point
 * of the endpoint, and it is what keeps the project alive. Only the *report*
 * is behind the secret.
 *
 * The secret is `CRON_SECRET`, which Vercel sends as `Authorization: Bearer
 * <secret>` on cron requests when it is set. With no secret configured the
 * diagnostics are simply never shown — a deployment that has not set one
 * loses a debugging aid, not a function.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const started = Date.now();

  let db: "ok" | "not-configured" | "no-key" | "error" = "not-configured";
  let actor: "ok" | "not-applicable" | "broken" | "error" = "not-applicable";

  if (supabaseConfigured) {
    if (!hasAdminCredentials()) {
      db = "no-key";
    } else {
      // A fixed probe id: we only care whether the header round-trips into
      // erph.actor(), not about any real user.
      const probe = "00000000-0000-4000-8000-00000000beef";
      const client = adminDb(probe);
      try {
        const { error } = await client
          .from("school")
          .select("id", { count: "exact", head: true })
          .limit(1);
        db = error ? "error" : "ok";

        if (!error) {
          const { data, error: rpcErr } = await client.rpc("actor");
          actor = rpcErr || data !== probe ? "broken" : "ok";
        }
      } catch {
        db = "error";
        actor = "error";
      }
    }
  }

  // "ok" means *nothing is wrong*, not "everything is switched on". Local
  // mode has no database to reach and that is not a fault, so it is ok; a
  // missing secret key and a database that will not answer both are not.
  const ok = db === "ok" ? actor !== "broken" : db === "not-configured";

  if (!isPrivileged(request)) {
    // The readiness probe (playwright.config.ts waits on this) only needs to
    // know that the deployment answered.
    return NextResponse.json({ ok });
  }

  return NextResponse.json({
    ok,
    db,
    actor,
    mode: supabaseConfigured ? "synced" : "local",
    latency_ms: Date.now() - started,
    ts: new Date().toISOString(),
  });
}

/**
 * Is this caller the cron, or whoever holds the secret?
 *
 * Compared in constant time: the secret is a bearer credential, and a timing
 * difference in a comparison is a timing difference in a credential.
 */
function isPrivileged(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const header = request.headers.get("authorization") ?? "";
  // The scheme is required, not optional: Vercel sends `Bearer <secret>`, and
  // accepting a bare token as well would mean two spellings of the same
  // secret, one of them undocumented.
  if (!/^bearer\s+/i.test(header)) return false;
  const bearer = header.replace(/^bearer\s+/i, "").trim();
  if (!bearer) return false;

  const a = Buffer.from(bearer);
  const b = Buffer.from(secret);
  // `timingSafeEqual` throws on a length mismatch, so the length is compared
  // first — and a wrong length is not a secret.
  return a.length === b.length && timingSafeEqual(a, b);
}
