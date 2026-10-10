import { type NextRequest, NextResponse } from "next/server";
import { requireDbUser, schoolIdFor } from "@/lib/server/auth/guard";

/**
 * GET /api/rph — the caller's own plans, as the server has them.
 *
 * Documents have always synced *up* and nothing has ever pulled them *down*,
 * so a plan only existed in the browser that created it: the same teacher on a
 * second device saw an empty archive, and the seal — which is rendered from
 * the local document — could not appear at all. This is the other half.
 *
 * Scoped to the caller's own rows rather than filtered in the client. This
 * handler holds the secret key and bypasses RLS, so anything not excluded here
 * is readable; `owner_id` is the only condition that matters and it is applied
 * in the query, not afterwards.
 *
 * Deliberately not a "pull everything and reconcile" endpoint: reviewers get
 * plans through `/api/queue` and teachers through `pantau_teachers`, and both
 * are scoped differently. This is the teacher's own archive and nothing else.
 */
export interface DocumentRow {
  id: string;
  class_id: string;
  subject_code: string;
  session: string;
  week_no: number;
  plan_date: string;
  slot_time: string | null;
  status: string;
  payload: unknown;
  version: number;
  content_hash: string | null;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
  deleted_at: string | null;
  grade: number | null;
  reviewed_at: string | null;
  /** Joined, because the local document stores names as well as ids. */
  class: { nama: string } | null;
  subject: { nama: string } | null;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const gate = await requireDbUser(request);
  if ("error" in gate) return gate.error;

  const schoolId = await schoolIdFor(gate.db, gate.user.id);
  if (!schoolId) return NextResponse.json({ items: [] as DocumentRow[] });

  const { data, error } = await gate.db
    .from("rph_document")
    .select(
      "id, class_id, subject_code, session, week_no, plan_date, slot_time, status, " +
        "payload, version, content_hash, created_at, updated_at, submitted_at, deleted_at, " +
        "grade, reviewed_at, class:class_id(nama), subject:subject_code(nama)",
    )
    .eq("school_id", schoolId)
    .eq("owner_id", gate.user.id)
    .order("updated_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error("[rph] pull failed:", error.message);
    return NextResponse.json({ error: "Ralat pelayan." }, { status: 500 });
  }

  return NextResponse.json({ items: (data ?? []) as unknown as DocumentRow[] });
}
