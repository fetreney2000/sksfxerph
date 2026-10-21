import { type NextRequest, NextResponse } from "next/server";
import { reviewStageFor } from "@/lib/auth/permissions";
import { mytFields } from "@/lib/date";
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
/**
 * How long a plan has been waiting, in the words a reviewer would use.
 *
 * The queue already prints the plan's date, so what is missing is not a
 * timestamp but the thing a timestamp makes you work out: whether this has
 * been sitting since this morning or since three weeks ago. The previous
 * value was the constant "Menunggu semakan", which sat in a column that read
 * like an age and was not one.
 *
 * A plan with no recorded submission is said to be unrecorded rather than
 * given an age — guessing one would put a number in front of a reviewer that
 * nobody measured.
 */
function waitingLabel(submittedAt: string | null): string {
  if (!submittedAt) return "Penghantaran tidak direkodkan";
  const since = Date.parse(submittedAt);
  if (!Number.isFinite(since)) return "Penghantaran tidak direkodkan";
  if (Date.now() < since) return "Baru sahaja";

  // Whole school days, not elapsed hours. "Hari ini" is a claim about the
  // calendar — a plan submitted at eight last night was not submitted today,
  // however less than twenty-four hours ago that was. Both days are read in
  // MYT, so a reviewer abroad counts the same day as one at the school.
  const from = mytFields(since);
  const to = mytFields(Date.now());
  if (!from || !to) return "Penghantaran tidak direkodkan";
  const days = Math.round(
    (Date.UTC(to.year, to.month, to.date) - Date.UTC(from.year, from.month, from.date)) /
      86_400_000,
  );

  if (days <= 0) return "Hari ini";
  if (days === 1) return "1 hari menunggu";
  return `${days} hari menunggu`;
}

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
      "id, version, status, plan_date, slot_time, payload, owner_id, submitted_at, " +
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
        { error: "Ralat pelayan semasa mengambil senarai semakan." },
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
      { error: "Ralat pelayan semasa mengambil senarai semakan." },
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
    submitted_at: string | null;
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
      ageLabel: waitingLabel(row.submitted_at),
      payload: row.payload,
    };
  });

  return NextResponse.json({ items });
}
