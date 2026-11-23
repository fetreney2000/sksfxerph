import { type NextRequest, NextResponse } from "next/server";
import { reviewStageFor } from "@/lib/auth/permissions";
import { weekMondayIso } from "@/lib/config";
import { mytFields } from "@/lib/date";
import type { QueueItem } from "@/lib/demo/review";
import { requireReviewer, schoolIdFor } from "@/lib/server/auth/guard";
import { loadCalendarAnchors } from "@/lib/server/calendar";
import { resolveSession } from "@/lib/server/session";

/**
 * GET /api/queue - plans awaiting a grade.
 *
 * Replaces the browser's direct `from("rph_document")` query: the handler is
 * authenticated by cookie, then scopes the query to the caller's own school.
 * A teacher who forges this request gets 403 before any row is read.
 *
 * The session comes from `school_setting`, not from `lib/config` - the same
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
 * given an age - guessing one would put a number in front of a reviewer that
 * nobody measured.
 */
function waitingLabel(submittedAt: string | null): string {
  if (!submittedAt) return "Penghantaran tidak direkodkan";
  const since = Date.parse(submittedAt);
  if (!Number.isFinite(since)) return "Penghantaran tidak direkodkan";
  if (Date.now() < since) return "Baru sahaja";

  // Whole school days, not elapsed hours. "Hari ini" is a claim about the
  // calendar - a plan submitted at eight last night was not submitted today,
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
  if (!stage) {
    return NextResponse.json({ items: [] as QueueItem[], total: 0 }, { status: 403 });
  }

  const params = request.nextUrl.searchParams;
  // Pending work is paged: the work list used to stop silently at 50 while the
  // badge claimed that was the whole queue. `total` is the exact count, and
  // Semakan can fetch the next page.
  const offsetRaw = params.get("offset");
  const offset = offsetRaw === null ? 0 : Number(offsetRaw);
  if (!Number.isInteger(offset) || offset < 0) {
    return NextResponse.json({ error: "Ofset tidak sah" }, { status: 400 });
  }
  const limitRaw = params.get("limit");
  const requestedLimit = limitRaw === null ? null : Number(limitRaw);
  if (
    requestedLimit !== null &&
    (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 200)
  ) {
    return NextResponse.json({ error: "Had tidak sah" }, { status: 400 });
  }

  // ── Week mode (`?week=N`) ────────────────────────────────────────────────
  // Without it the queue is the pending submissions, as it always was. With
  // it, the call browses *every* plan of that school week, any status — which
  // is how a reviewer reaches a backdated RPH: one the teacher wrote for a
  // past week and never submitted (a draft the reviewer may submit on their
  // behalf), or one already decided, which is listed so the week can be read
  // as a whole but cannot be decided again here.
  //
  // Matched by WHEN TAUGHT, not by the stamped number. `week_no` is written
  // once by the teacher's browser under whatever numbering the calendar had
  // that day; a later declaration cascades the numbers forward (a grid week
  // 32 becomes a declared week 34) and the stamp goes stale. The picker labels
  // each week by its dates, and dates never go stale — so the filter reads
  // the same range the label names.
  const weekParam = params.get("week");
  let week: number | null = null;
  if (weekParam !== null) {
    const parsed = Number(weekParam);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 53) {
      return NextResponse.json({ error: "Minggu tidak sah" }, { status: 400 });
    }
    week = parsed;
  }

  const schoolId = await schoolIdFor(gate.db, gate.user.id);
  if (!schoolId) {
    return NextResponse.json({ items: [] as QueueItem[], total: 0 });
  }

  const session = await resolveSession(gate.user.id);

  // The week's days under the school's *current* declarations — the same
  // arithmetic the picker labels are built from. One object so the filter
  // below narrows it whole: a half-computed range must never reach the query.
  let range: { monday: string; sunday: string } | null = null;
  if (week !== null) {
    const anchors = await loadCalendarAnchors(schoolId);
    const monday = weekMondayIso(week, anchors);
    // Sunday closes the week: a school week runs Monday to Sunday, so every
    // calendar day belongs to exactly one browsable range. Pure calendar
    // arithmetic on a UTC-midnight date token — no timezone involved.
    const sundayMs = Date.parse(`${monday}T00:00:00Z`) + 6 * 86_400_000;
    range = { monday, sunday: new Date(sundayMs).toISOString().slice(0, 10) };
  }

  let query = gate.db
    .from("rph_document")
    .select(
      "id, version, status, session, plan_date, slot_time, payload, owner_id, " +
        "submitted_at, class_ids, subject:subject_code(nama), " +
        "owner:owner_id(full_name)",
      // The count is over every matching row, not just this page - that is
      // what the badge and "lebih banyak" control need.
      { count: "exact" },
    )
    .eq("school_id", schoolId)
    // A plan removed through the app is a soft-deleted record, not a queue
    // entry. The pending queue never filtered it because a deleted plan could
    // not be `submitted` - its status moves with the delete - but week mode
    // lists drafts too, and a deleted draft would have walked straight back in.
    .is("deleted_at", null);
  if (week === null) {
    // Every submitted plan is in the work list. Current-week plans cannot be
    // *approved* yet, but they can be returned with feedback, so hiding them
    // until Monday would delay the correction loop.
    query = query.eq("status", stage.status);
    // Prior-session pending plans are real work. They are not filtered out by
    // the current school year; their `session` is carried to the row.
  } else if (range !== null) {
    query = query
      .eq("session", session)
      .gte("plan_date", range.monday)
      .lte("plan_date", range.sunday);
  }

  // Scope. RLS on rph_document enforces this too, but this handler holds the
  // secret key and therefore bypasses it - a filter the database would have
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
    // Said out loud (`assigned: false`) rather than as an empty list, or the
    // reviewer reads "no plans this week" when the truth is "no teachers to
    // review" - a supervision assignment the pentadbir has not made yet.
    if (ids.length === 0)
      return NextResponse.json({ items: [] as QueueItem[], assigned: false, total: 0 });
    query = query.in("owner_id", ids);
  }

  const limit = requestedLimit ?? (week === null ? 50 : 200);
  const { data, error, count } = await query
    // Pending queue: oldest submission first, the order a reviewer works
    // through. Week mode: by the day the lesson was taught, so the week reads
    // as a timetable rather than a backlog.
    .order(week === null ? "submitted_at" : "plan_date", { ascending: true })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error("[queue] query failed:", error.message);
    return NextResponse.json(
      { error: "Ralat pelayan semasa mengambil senarai semakan." },
      { status: 500 },
    );
  }

  // No generated Database types, so supabase-js cannot infer the embedded
  // relations - shape the rows explicitly rather than trusting `any`.
  interface QueueRow {
    id: string;
    /** Carried through because signing needs it: the server refuses a
     *  signature over any other version. */
    version: number;
    status: QueueItem["status"];
    session: string;
    plan_date: string;
    slot_time: string | null;
    payload: QueueItem["payload"];
    submitted_at: string | null;
    owner: { full_name: string } | null;
    class_ids: string[] | null;
    subject: { nama: string } | null;
  }

  const rows = (data ?? []) as unknown as QueueRow[];

  // The review history is a separate read rather than a nested select on every
  // row: the sidebar and the Minggu band only need the count, and the page
  // needs comments only for the first page it is showing.
  const reviewsByDoc = new Map<string, NonNullable<QueueItem["reviews"]>>();
  if (rows.length > 0) {
    const { data: reviewRows, error: reviewErr } = await gate.db
      .from("rph_review")
      .select("document_id, comment, created_at, grade, reviewer:reviewer_id(full_name)")
      .in(
        "document_id",
        rows.map((row) => row.id),
      )
      .order("created_at", { ascending: false });
    if (reviewErr) {
      console.error("[queue] review history failed:", reviewErr.message);
    } else {
      for (const review of (reviewRows ?? []) as unknown as {
        document_id: string;
        comment: string | null;
        created_at: string;
        grade: 0 | 1;
        reviewer: { full_name: string } | null;
      }[]) {
        const list = reviewsByDoc.get(review.document_id) ?? [];
        list.push({
          reviewerName: review.reviewer?.full_name ?? null,
          comment: review.comment,
          createdAt: review.created_at,
          grade: review.grade,
        });
        reviewsByDoc.set(review.document_id, list);
      }
    }
  }

  // `class_ids` is an array with no FK to embed through, so the names are
  // resolved here: one read of the school's class list, then a map. Archived
  // rows are included - a plan naming an archived class still prints its name.
  const { data: classes, error: classErr } = await gate.db
    .from("class")
    .select("id, nama")
    .eq("school_id", schoolId);
  if (classErr) {
    console.error("[queue] class lookup failed:", classErr.message);
    return NextResponse.json(
      { error: "Ralat pelayan semasa mengambil senarai semakan." },
      { status: 500 },
    );
  }
  const classNames = new Map(
    (classes ?? []).map((c: { id: string; nama: string }) => [c.id, c.nama]),
  );

  const items: QueueItem[] = rows.map((row) => {
    const name = row.owner?.full_name ?? "Guru";
    return {
      id: row.id,
      version: row.version,
      teacherName: name,
      initials: name.slice(0, 2).toUpperCase(),
      tone: "blue",
      className:
        (row.class_ids ?? [])
          .map((id) => classNames.get(id) ?? "")
          .filter(Boolean)
          .join(", ") || "-",
      subjectName: row.subject?.nama ?? "-",
      planDate: row.plan_date,
      slotTime: row.slot_time ?? "07:30",
      status: row.status,
      ageLabel: waitingLabel(row.submitted_at),
      payload: row.payload,
      session: row.session,
      reviews: reviewsByDoc.get(row.id) ?? [],
    };
  });

  return NextResponse.json({
    items,
    assigned: true,
    total: typeof count === "number" ? count : items.length,
  });
}
