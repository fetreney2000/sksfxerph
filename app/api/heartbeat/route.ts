import { NextResponse } from "next/server";
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
 */
export async function GET(): Promise<NextResponse> {
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

  return NextResponse.json({
    ok: db === "ok" && actor !== "broken",
    db,
    actor,
    mode: supabaseConfigured ? "synced" : "local",
    latency_ms: Date.now() - started,
    ts: new Date().toISOString(),
  });
}
