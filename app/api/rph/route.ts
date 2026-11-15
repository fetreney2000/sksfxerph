import { type NextRequest, NextResponse } from "next/server";
import { requirePermission, schoolIdFor } from "@/lib/server/auth/guard";

/**
 * GET /api/rph - the caller's own plans, as the server has them.
 *
 * Documents have always synced *up* and nothing has ever pulled them *down*,
 * so a plan only existed in the browser that created it: the same teacher on a
 * second device saw an empty archive, and the seal - which is rendered from
 * the local document - could not appear at all. This is the other half.
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
  /** Written into the local copy, so IndexedDB can tell two accounts apart. */
  owner_id: string;
  /** The classes this plan covers - sorted, distinct (the server's canonical form). */
  class_ids: string[];
  subject_code: string;
  session: string;
  week_no: number;
  plan_date: string;
  slot_time: string | null;
  slot_time_end: string | null;
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
  /** Parallel to class_ids, resolved from the school's class list below. */
  class_names: string[];
  subject: { nama: string } | null;
  /** Every review this plan has had; the caller takes the newest one. */
  rph_review?:
    | {
        reviewer?: { full_name: string } | null;
        comment: string | null;
        created_at: string;
      }[]
    | null;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  // The caller's *own* plans: only a role that writes plans may pull them. A
  // Guru Besar teaches no class, so there is nothing of theirs to return -
  // reviewers read plans through `/api/queue` and teachers through
  // `pantau_teachers`, both scoped differently.
  const gate = await requirePermission(request, "rph");
  if ("error" in gate) return gate.error;

  const schoolId = await schoolIdFor(gate.db, gate.user.id);
  if (!schoolId) return NextResponse.json({ items: [] as DocumentRow[] });

  const { data, error } = await gate.db
    .from("rph_document")
    .select(
      "id, owner_id, class_ids, subject_code, session, week_no, plan_date, slot_time, " +
        "slot_time_end, status, payload, version, content_hash, created_at, " +
        "updated_at, submitted_at, deleted_at, grade, reviewed_at, " +
        "subject:subject_code(nama), " +
        // The reviewer's catatan and their name, from the same row. One-to-many
        // - a plan can be returned and re-reviewed - so the whole set comes
        // across and the caller takes the newest, rather than the server
        // guessing which one a reader wants.
        "rph_review(reviewer:reviewer_id(full_name), comment, created_at)",
    )
    .eq("school_id", schoolId)
    .eq("owner_id", gate.user.id)
    .order("updated_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error("[rph] pull failed:", error.message);
    return NextResponse.json({ error: "Ralat pelayan." }, { status: 500 });
  }

  // PostgREST cannot embed `class.nama` through an array column (`class_ids`
  // has no FK), so the names are resolved here: one extra read of the school's
  // class list, then a map. A plan naming a class that has since been archived
  // keeps its name - the map simply has to include inactive rows to do that.
  const { data: classes } = await gate.db
    .from("class")
    .select("id, nama")
    .eq("school_id", schoolId);
  const names = new Map(
    (classes ?? []).map((c: { id: string; nama: string }) => [c.id, c.nama]),
  );

  const raw = (data ?? []) as unknown as DocumentRow[];
  const rows = raw.map((row) => ({
    ...row,
    class_names: (row.class_ids ?? []).map((id) => names.get(id) ?? ""),
  }));

  return NextResponse.json({ items: rows });
}
