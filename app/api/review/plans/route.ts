import { type NextRequest, NextResponse } from "next/server";
import { requireReviewer, schoolIdFor } from "@/lib/server/auth/guard";
import { dbFailureMessage } from "@/lib/server/http/errors";
import { resolveSession } from "@/lib/server/session";
import type { RphStatus } from "@/lib/types";

/**
 * One light row per plan - everything the review tree needs except the body.
 * The payload (the whole RPH) stays server-side until the reviewer opens the
 * plan, when `GET /api/rph/[id]` delivers that single row in full.
 */
export interface ReviewPlanRow {
  id: string;
  version: number;
  teacherId: string;
  teacherName: string;
  className: string;
  subjectName: string;
  planDate: string;
  slotTime: string | null;
  weekNo: number;
  session: string;
  status: RphStatus;
  submittedAt: string | null;
}

/**
 * GET /api/review/plans - every in-scope plan of the session, without bodies.
 *
 * The review tree (Tahun → Guru → Minggu → Senarai) expands instantly from a
 * single fetch instead of one request per teacher or week. Scope is the queue's
 * own: the whole school for a Guru Besar, the assigned teachers for a GPK.
 * A GPK with no supervised teachers gets `{ items: [], assigned: false }` -
 * an empty school is not the same as an empty assignment, and the tree says
 * which one it is.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const gate = await requireReviewer(request);
  if ("error" in gate) return gate.error;

  const schoolId = await schoolIdFor(gate.db, gate.user.id);
  if (!schoolId) return NextResponse.json({ items: [] as ReviewPlanRow[], assigned: true });

  const session = await resolveSession(gate.user.id);

  let ownerIds: string[] | null = null;
  if (gate.user.role !== "guru_besar") {
    const { data: supervised, error: scopeErr } = await gate.db
      .from("school_member")
      .select("user_id")
      .eq("school_id", schoolId)
      .eq("supervisor_id", gate.user.id)
      .eq("is_active", true);
    if (scopeErr) {
      console.error("[review-plans] scope lookup failed:", scopeErr.message);
      const known = dbFailureMessage(scopeErr);
      if (known) return NextResponse.json({ error: known }, { status: 422 });
      return NextResponse.json({ error: "Ralat pelayan." }, { status: 500 });
    }
    const ids = ((supervised ?? []) as { user_id: string }[]).map((r) => r.user_id);
    if (ids.length === 0) {
      return NextResponse.json({ items: [] as ReviewPlanRow[], assigned: false });
    }
    ownerIds = ids;
  }

  let query = gate.db
    .from("rph_document")
    .select(
      "id, version, owner_id, class_ids, subject_code, session, week_no, " +
        "plan_date, slot_time, status, submitted_at, " +
        "subject:subject_code(nama), owner:owner_id(full_name)",
    )
    .eq("school_id", schoolId)
    .eq("session", session)
    .is("deleted_at", null);
  if (ownerIds) query = query.in("owner_id", ownerIds);

  const { data, error } = await query.order("plan_date", { ascending: false }).limit(2000);

  if (error) {
    console.error("[review-plans] query failed:", error.message);
    const known = dbFailureMessage(error);
    if (known) return NextResponse.json({ error: known }, { status: 422 });
    return NextResponse.json({ error: "Ralat pelayan." }, { status: 500 });
  }

  interface PlanRow {
    id: string;
    version: number;
    owner_id: string;
    class_ids: string[] | null;
    subject_code: string;
    session: string;
    week_no: number;
    plan_date: string;
    slot_time: string | null;
    status: RphStatus;
    submitted_at: string | null;
    subject: { nama: string } | null;
    owner: { full_name: string } | null;
  }

  const rows = (data ?? []) as unknown as PlanRow[];

  // `class_ids` is an array with no FK to embed through, so the names are
  // resolved here - the same read the queue does.
  const { data: classes } = await gate.db
    .from("class")
    .select("id, nama")
    .eq("school_id", schoolId);
  const classNames = new Map(
    ((classes ?? []) as { id: string; nama: string }[]).map((c) => [c.id, c.nama]),
  );

  const items: ReviewPlanRow[] = rows.map((row) => ({
    id: row.id,
    version: row.version,
    teacherId: row.owner_id,
    teacherName: row.owner?.full_name ?? "Guru",
    className:
      (row.class_ids ?? [])
        .map((id) => classNames.get(id) ?? "")
        .filter(Boolean)
        .join(", ") || "-",
    subjectName: row.subject?.nama ?? row.subject_code,
    planDate: row.plan_date,
    slotTime: row.slot_time,
    weekNo: row.week_no,
    session: row.session,
    status: row.status,
    submittedAt: row.submitted_at,
  }));

  return NextResponse.json({ items, assigned: true });
}
