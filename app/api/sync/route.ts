import { type NextRequest, NextResponse } from "next/server";
import { supabaseConfigured } from "@/lib/config";
import { rateLimit } from "@/lib/http/rate-limit";
import { requireDbUser } from "@/lib/server/auth/guard";
import type { SyncResult } from "@/lib/types";

/**
 * Batched offline-sync endpoint.
 *
 * Thin by design: every business rule (school membership, class ownership,
 * natural-key merge, idempotency via `sync_op`, revision history, the
 * status-change guard) lives in the `erph.sync_rph` SECURITY DEFINER RPC in
 * db/schema.sql. This handler authenticates the session cookie, forwards the
 * batch with the acting user id attached, and maps the response — so a bug here
 * cannot bypass a rule there.
 *
 * Auth shape changed with the removal of Supabase Auth: there is no user JWT
 * to forward any more. The cookie identifies the caller, and the handler
 * supplies the user id to PostgREST via `X-Erph-User`, which `erph.actor()`
 * only trusts for `service_role` callers.
 *
 * Free-tier friendly: one round-trip per batch (≤25 ops), Node runtime only.
 */
export async function POST(request: NextRequest) {
  if (!supabaseConfigured) {
    // The client never calls this in local mode (hasBackend() gates it), so
    // reaching here means a stale build talking to a stripped env — fail loudly.
    return NextResponse.json({ error: "Penyegerakan tidak disediakan" }, { status: 503 });
  }

  const gate = await requireDbUser(request);
  if ("error" in gate) return gate.error;

  // Keyed by user, not IP: a teacher retrying on a flaky connection should not
  // lock out colleagues behind the same NAT.
  const limited = rateLimit(`sync:${gate.user.id}`);
  if (limited) return limited;

  let body: { ops?: unknown[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON tidak sah" }, { status: 400 });
  }

  const ops = Array.isArray(body.ops) ? body.ops : [];
  if (ops.length === 0) {
    const empty: SyncResult[] = [];
    return NextResponse.json({ results: empty });
  }
  if (ops.length > 25) {
    return NextResponse.json({ error: "Batch terlalu besar (maksimum 25)" }, { status: 413 });
  }

  try {
    const { data, error } = await gate.db.rpc("sync_rph", { p_ops: ops });

    if (error) {
      console.error("[sync] rpc failed:", error.message);
      const status =
        error.code === "PGRST301" || /belum log masuk/i.test(error.message) ? 401 : 422;
      return NextResponse.json({ error: error.message }, { status });
    }

    return NextResponse.json({ results: (data as SyncResult[] | null) ?? [] });
  } catch (err) {
    console.error("[sync] handler error:", err);
    return NextResponse.json({ error: "Penyegerakan gagal" }, { status: 500 });
  }
}
