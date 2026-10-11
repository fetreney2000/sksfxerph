import { type NextRequest, NextResponse } from "next/server";
import { currentWeek } from "@/lib/config";
import { requireDbUser, schoolIdFor } from "@/lib/server/auth/guard";
import { parseRange } from "@/lib/server/range";
import { resolveSession } from "@/lib/server/session";

/**
 * GET /api/stats — school compliance for the current week.
 *
 * Wraps the `erph.school_week_stats` SECURITY DEFINER RPC. The RPC re-checks
 * membership with `erph.actor()`, so a teacher cannot read another school's
 * figures even though this handler holds the secret key.
 *
 * 503 in local mode — the caller falls back to the bundled demo figures.
 */
/**
 * GET /api/stats — whole-school aggregates for the week.
 *
 * Any member may call this: `school_week_stats` returns counts and a
 * compliance percentage and never a name, so a Guru Biasa can see how the
 * school is doing without seeing who is behind it. The per-teacher table, the
 * reminders and the school exports live on `/sekolah`, which is gated on
 * `pantau` — and there is no endpoint that returns names to anyone but a
 * reviewer (`/api/queue` is the only one, and it is reviewer-only).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const gate = await requireDbUser(request);
  if ("error" in gate) return gate.error;

  const schoolId = await schoolIdFor(gate.db, gate.user.id);
  if (!schoolId) {
    return NextResponse.json({ error: "Tiada keahlian sekolah aktif" }, { status: 403 });
  }

  const session = await resolveSession(gate.user.id);
  const week = currentWeek();
  // The range the page's filter chose. Defaults to the last six weeks, which
  // is what the chart drew before the filter existed.
  const range = parseRange(request, { first: week - 5, last: week });

  const { data, error } = await gate.db.rpc("school_week_stats", {
    p_school: schoolId,
    p_session: session,
    p_week: week,
  });

  if (error) {
    console.error("[stats] rpc failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 422 });
  }

  // The trend, over the requested range. Same permission shape as the single
  // week above — counts and a percentage, never a name.
  const { data: history, error: histErr } = await gate.db.rpc("school_week_history", {
    p_school: schoolId,
    p_session: session,
    p_first_week: range.first,
    p_last_week: range.last,
  });

  if (histErr) {
    console.error("[stats] history failed:", histErr.message);
    return NextResponse.json({ error: histErr.message }, { status: 422 });
  }

  interface HistoryRow {
    week: number;
    expected: number;
    submitted: number;
    approved: number;
    returned_t: number;
    drafts: number;
    compliance: number | string;
    avg_minutes: number | string | null;
  }

  const rows = (history ?? []) as unknown as HistoryRow[];

  return NextResponse.json({
    stats: (data ?? [])[0] ?? null,
    history: rows.map((r) => ({
      week: r.week,
      expected: r.expected,
      submitted: r.submitted,
      approved: r.approved,
      returned: r.returned_t,
      drafts: r.drafts,
      // numeric comes back as a string from Postgres; the UI renders a
      // number and never concatenates one.
      compliance: r.compliance === null ? null : Number(r.compliance),
      avgMinutes: r.avg_minutes === null ? null : Number(r.avg_minutes),
    })),
  });
}
