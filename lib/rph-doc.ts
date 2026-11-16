import type { DocumentRow } from "@/app/api/rph/route";
import { schoolCode } from "@/lib/config";
import { normalisePayload } from "@/lib/schemas/rph";
import { currentSession } from "@/lib/session";
import type { RphDocument } from "@/lib/types";

/**
 * Server row → the plan shape the UI works with.
 *
 * One mapping, used by every reader of the teacher's own plans, so the
 * dashboard, the archive and the editor cannot disagree about what a row
 * means. Tolerant on the way in: the server returns what it has, including
 * plans written before the template reshape, and a reader that assumes the
 * current shape would crash on the first field that is missing.
 */
export function toLocalPlan(row: DocumentRow): RphDocument {
  return {
    id: row.id,
    schoolCode,
    // The server's own owner id - the same one every screen filters on.
    ownerId: row.owner_id,
    classIds: row.class_ids ?? [],
    classNames: row.class_names ?? [],
    subjectCode: row.subject_code,
    subjectName: row.subject?.nama ?? "",
    session: row.session || currentSession(),
    weekNo: row.week_no,
    planDate: row.plan_date,
    // `07:30:00` on the server, `07:30` in the document - the editor's time
    // input takes the short form.
    slotTime: (row.slot_time ?? "07:30").slice(0, 5),
    slotTimeEnd: (row.slot_time_end ?? "12:40").slice(0, 5),
    status: row.status as RphDocument["status"],
    payload: normalisePayload(row.payload),
    version: row.version,
    clientUpdatedAt: new Date(row.updated_at).getTime(),
    createdAt: new Date(row.created_at).getTime(),
    ...(row.submitted_at ? { submittedAt: new Date(row.submitted_at).getTime() } : {}),
    ...(row.reviewed_at ? { reviewedAt: new Date(row.reviewed_at).getTime() } : {}),
    // Narrowed explicitly: the column is `smallint`, the document type is
    // `0 | 1`, and nothing in between should be guessed at.
    ...(row.grade === 1 ? { grade: 1 as const } : row.grade === 0 ? { grade: 0 as const } : {}),
    // The newest review's catatan and the reviewer's name. Ordered here rather
    // than trusted from the wire: PostgREST's default order for an embedded
    // collection is not a promise, and printing an older comment than the one
    // that governed the current status would tell a teacher to fix the wrong
    // thing. Both halves come from the *same* row: pairing one review's
    // comment with another's name would describe a decision nobody made.
    ...reviewFields(row),
  };
}

function reviewFields(row: {
  rph_review?:
    | {
        reviewer?: { full_name: string } | null;
        comment: string | null;
        created_at: string;
      }[]
    | null;
}): { reviewComment?: string; reviewerName?: string } {
  const newest = [...(row.rph_review ?? [])].sort(
    (a, b) =>
      // Newest first; a missing or invalid timestamp sorts last rather than
      // throwing, because a bad row must not take the screen down with it.
      Date.parse(b.created_at) - Date.parse(a.created_at),
  )[0];

  const comment = newest?.comment?.trim();
  const reviewer = newest?.reviewer?.full_name?.trim();
  return {
    ...(comment ? { reviewComment: comment } : {}),
    ...(reviewer ? { reviewerName: reviewer } : {}),
  };
}
