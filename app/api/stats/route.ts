import { type NextRequest, NextResponse } from "next/server";
import { currentWeek } from "@/lib/config";
import { requirePermission, schoolIdFor } from "@/lib/server/auth/guard";
import { loadCalendarAnchors } from "@/lib/server/calendar";
import { parseRange } from "@/lib/server/range";
import { resolveSession } from "@/lib/server/session";

/**
 * GET /api/stats — whole-school compliance for the week, and the trend.
 *
 * Supervisors only. It returns counts and a percentage and never a name, so
 * there is nothing here to identify a teacher — but that was never the
 * question. A Guru Biasa's dashboard is about their own week, and a school's
 * compliance percentage beside it is a school's answer to a school's problem;
 * they are no better placed to act on it than they are to act on a colleague's
 * roster, which is what `/api/pantau/teachers` has always refused.
 *
 * It used to be open to every member, which meant the dashboard could hide a
 * card it could not stop anyone from asking for. The permission is `pantau`,
 * the same one `/sekolah` and `/api/pantau/teachers` are behind, so the UI and
 * the endpoint can no longer disagree about who may look.
 *
 * 503 in local mode — the caller falls back to the bundled demo figures.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const gate = await requirePermission(request, "pantau");
  if ("error" in gate) return gate.error;

  const schoolId = await schoolIdFor(gate.db, gate.user.id);
  if (!schoolId) {
    return NextResponse.json({ error: "Tiada keahlian sekolah aktif" }, { status: 403 });
  }

  const session = await resolveSession(gate.user.id);
  // The school's own numbering, not the term-start grid: the card this feeds
  // sits on a dashboard already showing the declared week.
  const week = currentWeek(new Date(), await loadCalendarAnchors(schoolId));
  // The range the page's filter chose. Defaults to the last six weeks, which
  // is what the chart drew before the filter existed.
  const range = parseRange(request, week, { first: week - 5, last: week });

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
    teachers: number;
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
      // The headcount. `expected` is the number of RPH the school owes that
      // week — teachers × the school's rph_per_week — so the two are no
      // longer the same figure and a roster needs the first one.
      teachers: r.teachers,
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
