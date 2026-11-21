import { type NextRequest, NextResponse } from "next/server";
import { currentWeek } from "@/lib/config";
import { requirePermission, schoolIdFor } from "@/lib/server/auth/guard";
import { loadCalendarAnchors } from "@/lib/server/calendar";
import { adminDb } from "@/lib/server/db";
import { parseRange } from "@/lib/server/range";
import { resolveSession } from "@/lib/server/session";

/**
 * GET /api/pantau/teachers - who has and has not submitted, per teacher.
 *
 * The one place this app names an individual, so it is gated on `pantau` - as
 * `/api/stats` is now too. A row here says *this* teacher has not submitted,
 * which the school's counts never did; the counts came to be gated for the
 * opposite reason: a Guru Biasa has nothing to act on in them.
 *
 * A GPK sees only their supervised teachers and a Guru Besar the whole school,
 * and that is enforced by `erph.pantau_teachers` rather than here. This handler
 * holds the secret key, so nothing is left to RLS - and the RPC is called with
 * the caller's own id attached, because `may_supervise` reads `erph.actor()`
 * and the service key has no actor: without it every row would come back empty
 * and look like a school with no teachers.
 */
export interface TeacherRow {
  userId: string;
  fullName: string;
  role: string;
  /** Plans due this week, and how many are approved. */
  weekTotal: number;
  weekDone: number;
  sessionTotal: number;
  sessionDone: number;
  /**
   * Of the plans this teacher has had sent back, and how many are approved
   * now. The pair separates a teacher who acts on feedback from one who does
   * not - a count of who is *currently* returned cannot, because a teacher who
   * fixes everything and one who ignores every return look identical once the
   * first is caught up.
   */
  returnedTotal: number;
  fixedTotal: number;
  lastReviewedAt: string | null;
  classes: string | null;
  /** The teacher's RPT links for the session - Drive only, view-only. */
  rptLinks: { title: string; url: string }[];
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const gate = await requirePermission(request, "pantau");
  if ("error" in gate) return gate.error;

  const schoolId = await schoolIdFor(gate.db, gate.user.id);
  if (!schoolId) return NextResponse.json({ items: [] as TeacherRow[] });

  const session = await resolveSession(gate.user.id);
  // The same current week the cards above this table use. `parseRange` no
  // longer computes it: on the server the client's calendar store is empty, so
  // a bare `currentWeek()` would be the term-start grid's answer and the roster
  // would describe a week the dashboard has stopped calling the current one.
  const anchors = await loadCalendarAnchors(schoolId);
  const range = parseRange(request, currentWeek(new Date(), anchors));

  const { data, error } = await adminDb(gate.user.id).rpc("pantau_teachers", {
    p_school: schoolId,
    p_session: session,
    // The range the page's filter chose, not always the current week - the
    // roster and the cards above it have to describe the same weeks, or a
    // supervisor reads a total beside a table that disagrees with it.
    p_first_week: range.first,
    p_last_week: range.last,
  });

  if (error) {
    console.error("[pantau] teacher rows failed:", error.message);
    return NextResponse.json(
      { error: "Ralat pelayan semasa mengambil prestasi guru." },
      { status: 500 },
    );
  }

  interface RpcRow {
    user_id: string;
    full_name: string;
    role: string;
    week_total: number;
    week_done: number;
    session_total: number;
    session_done: number;
    returned_total: number;
    fixed_total: number;
    last_reviewed_at: string | null;
    classes: string | null;
  }

  const rows = (data ?? []) as unknown as RpcRow[];

  // The teachers' RPT links for this session, keyed by owner. Queried against
  // the already-scoped row set above - never the whole school - so a GPK sees
  // links only for their own supervised teachers, exactly like the plans. No
  // RPC change needed: `pantau_teachers` owns the scope, this only decorates it.
  const ids = rows.map((r) => r.user_id);
  let linksByOwner = new Map<string, { title: string; url: string }[]>();
  if (ids.length > 0) {
    const { data: linkRows, error: linkErr } = await gate.db
      .from("rpt_link")
      .select("owner_id, title, url")
      .eq("school_id", schoolId)
      .eq("session", session)
      .in("owner_id", ids)
      .order("title", { ascending: true });
    if (linkErr) {
      console.error("[pantau] RPT links failed:", linkErr.message);
      return NextResponse.json(
        { error: "Ralat pelayan semasa mengambil pautan RPT." },
        { status: 500 },
      );
    } else {
      linksByOwner = new Map<string, { title: string; url: string }[]>();
      for (const row of (linkRows ?? []) as unknown as {
        owner_id: string;
        title: string;
        url: string;
      }[]) {
        const list = linksByOwner.get(row.owner_id) ?? [];
        list.push({ title: row.title, url: row.url });
        linksByOwner.set(row.owner_id, list);
      }
    }
  }

  const items: TeacherRow[] = rows.map((r) => ({
    userId: r.user_id,
    fullName: r.full_name,
    role: r.role,
    weekTotal: Number(r.week_total ?? 0),
    weekDone: Number(r.week_done ?? 0),
    sessionTotal: Number(r.session_total ?? 0),
    sessionDone: Number(r.session_done ?? 0),
    returnedTotal: Number(r.returned_total ?? 0),
    fixedTotal: Number(r.fixed_total ?? 0),
    lastReviewedAt: r.last_reviewed_at,
    classes: r.classes,
    rptLinks: linksByOwner.get(r.user_id) ?? [],
  }));

  return NextResponse.json({ items });
}
