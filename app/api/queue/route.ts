import { type NextRequest, NextResponse } from "next/server";
import { reviewStageFor } from "@/lib/auth/permissions";
import { SESSION } from "@/lib/config";
import type { QueueItem } from "@/lib/demo/review";
import { requireReviewer, schoolIdFor } from "@/lib/server/auth/guard";

/**
 * GET /api/queue — plans awaiting a grade.
 *
 * Replaces the browser's direct `from("rph_document")` query: the handler is
 * authenticated by cookie, then scopes the query to the caller's own school.
 * A teacher who forges this request gets 403 before any row is read.
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

  const { data, error } = await gate.db
    .from("rph_document")
    .select(
      "id, status, plan_date, slot_time, payload, owner_id, " +
        "class:class_id(nama), subject:subject_code(nama), owner:owner_id(full_name)",
    )
    .eq("school_id", schoolId)
    .eq("session", SESSION)
    .eq("status", stage.status)
    .order("submitted_at", { ascending: true })
    .limit(50);

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
