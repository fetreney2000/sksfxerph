import { type NextRequest, NextResponse } from "next/server";
import { currentWeek } from "@/lib/config";
import { requirePermission, schoolIdFor } from "@/lib/server/auth/guard";
import { adminDb } from "@/lib/server/db";
import { resolveSession } from "@/lib/server/session";

/**
 * GET /api/pantau/teachers — who has and has not submitted, per teacher.
 *
 * The one place this app names an individual, so it is gated on `pantau` where
 * `/api/stats` is not: those counts cannot identify anyone and every member may
 * see them, whereas a row here says *this* teacher has not submitted.
 *
 * A GPK sees only their supervised teachers and a Guru Besar the whole school,
 * and that is enforced by `erph.pantau_teachers` rather than here. This handler
 * holds the secret key, so nothing is left to RLS — and the RPC is called with
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
  lastReviewedAt: string | null;
  classes: string | null;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const gate = await requirePermission(request, "pantau");
  if ("error" in gate) return gate.error;

  const schoolId = await schoolIdFor(gate.db, gate.user.id);
  if (!schoolId) return NextResponse.json({ items: [] as TeacherRow[] });

  const session = await resolveSession(gate.user.id);

  const { data, error } = await adminDb(gate.user.id).rpc("pantau_teachers", {
    p_school: schoolId,
    p_session: session,
    p_week: currentWeek(),
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
    last_reviewed_at: string | null;
    classes: string | null;
  }

  const rows = (data ?? []) as unknown as RpcRow[];

  const items: TeacherRow[] = rows.map((r) => ({
    userId: r.user_id,
    fullName: r.full_name,
    role: r.role,
    weekTotal: Number(r.week_total ?? 0),
    weekDone: Number(r.week_done ?? 0),
    sessionTotal: Number(r.session_total ?? 0),
    sessionDone: Number(r.session_done ?? 0),
    lastReviewedAt: r.last_reviewed_at,
    classes: r.classes,
  }));

  return NextResponse.json({ items });
}
