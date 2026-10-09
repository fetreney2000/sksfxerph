import { type NextRequest, NextResponse } from "next/server";
import { reviewStageFor } from "@/lib/auth/permissions";
import type { QueueItem } from "@/lib/demo/review";
import { requireReviewer, schoolIdFor } from "@/lib/server/auth/guard";
import { resolveSession } from "@/lib/server/session";

/**
 * GET /api/queue — plans awaiting a grade.
 *
 * Replaces the browser's direct `from("rph_document")` query: the handler is
 * authenticated by cookie, then scopes the query to the caller's own school.
 * A teacher who forges this request gets 403 before any row is read.
 *
 * The session comes from `school_setting`, not from `lib/config` — the same
 * value the dashboard's client-side queries use, so the queue and the teacher's
 * own list cannot drift into counting different school years.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const gate = await requireReviewer(request);
  if ("error" in gate) return gate.error;

  const stage = reviewStageFor(gate.user.role);
  if (!stage) return NextResponse.json({ items: [] as QueueItem[] }, { status: 403 });

  const schoolId = await schoolIdFor(gate.db, gate.user.id);
  if (!schoolId) {
    return NextResponse.json({ items: [] as QueueItem[] });
  }

  const session = await resolveSession(gate.user.id);

  let query = gate.db
    .from("rph_document")
    .select(
      "id, version, status, plan_date, slot_time, payload, owner_id, " +
        "class:class_id(nama), subject:subject_code(nama), owner:owner_id(full_name)",
    )
    .eq("school_id", schoolId)
    .eq("session", session)
    .eq("status", stage.status);

  // Scope. RLS on rph_document enforces this too, but this handler holds the
  // secret key and therefore bypasses it — a filter the database would have
  // applied is not applied unless it is written here. A Guru Besar takes the
  // whole school; a GPK takes only the teachers assigned to them, which is
  // exactly what `supervisor_id` says and nothing else.
  if (gate.user.role !== "guru_besar") {
    const { data: supervised, error: scopeErr } = await gate.db
      .from("school_member")
      .select("user_id")
      .eq("school_id", schoolId)
      .eq("supervisor_id", gate.user.id)
      .eq("is_active", true);

    if (scopeErr) {
      console.error("[queue] scope lookup failed:", scopeErr.message);
      return NextResponse.json(
        { error: "Ralat pelayan semasa mengambil baris gilir." },
        { status: 500 },
      );
    }
    const ids = (supervised ?? []).map((row) => (row as { user_id: string }).user_id);
    // Not an error: a GPK with no teachers assigned yet simply has no queue.
    if (ids.length === 0) return NextResponse.json({ items: [] as QueueItem[] });
    query = query.in("owner_id", ids);
  }

  const { data, error } = await query.order("submitted_at", { ascending: true }).limit(50);

  if (error) {
    console.error("[queue] query failed:", error.message);
    return NextResponse.json(
      { error: "Ralat pelayan semasa mengambil baris gilir." },
      { status: 500 },
    );
  }

  // No generated Database types, so supabase-js cannot infer the embedded
  // relations — shape the rows explicitly rather than trusting `any`.
  interface QueueRow {
    id: string;
    /** Carried through because signing needs it: the server refuses a
     *  signature over any other version. */
    version: number;
    status: QueueItem["status"];
    plan_date: string;
    slot_time: string | null;
    payload: QueueItem["payload"];
    owner: { full_name: string } | null;
    class: { nama: string } | null;
    subject: { nama: string } | null;
  }

  const rows = (data ?? []) as unknown as QueueRow[];

  const items: QueueItem[] = rows.map((row) => {
    const name = row.owner?.full_name ?? "Guru";
    return {
      id: row.id,
      version: row.version,
      teacherName: name,
      initials: name.slice(0, 2).toUpperCase(),
      tone: "blue",
      className: row.class?.nama ?? "—",
      subjectName: row.subject?.nama ?? "—",
      planDate: row.plan_date,
      slotTime: row.slot_time ?? "07:30",
      status: row.status,
      ageLabel: "Menunggu semakan",
      payload: row.payload,
    };
  });

  return NextResponse.json({ items });
}
