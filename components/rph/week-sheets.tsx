import type { SignaturePayload } from "@/app/api/rph/[id]/signature/route";
import { RphCover } from "@/components/rph/rph-cover";
import { RphPaper } from "@/components/rph/rph-paper";
import type { SignatureState } from "@/lib/hooks/use-signature";
import { currentSchool } from "@/lib/school";
import type { RphDocument, RphStatus } from "@/lib/types";

/**
 * A week as the school files it: the cover sheet, then one page per plan.
 *
 * The cover is first because that is what a district reads first, and because
 * it is the only page that carries the week's approval — the six behind it
 * carry the teaching, not the decision.
 */
export interface WeekSheetsProps {
  weekNo: number;
  session: string;
  teacherName?: string;
  documents: RphDocument[];
  /** Verified material, or null while the week is unsigned. */
  signature?: SignaturePayload | null;
  signatureState?: SignatureState;
  schoolName?: string;
}

/**
 * One status for the week, from its plans.
 *
 * Deliberately pessimistic. A week is only "lengkap" when every plan in it is:
 * a teacher who has had five of six approved and left one as a draft should
 * see the cover say so, not read "Lengkap", staple the stack and discover the
 * gap at the district office. Returned beats submitted for the same reason —
 * it is the thing that needs doing.
 */
function rollup(documents: RphDocument[]): RphStatus {
  if (documents.length === 0) return "draft";
  if (documents.every((d) => d.status === "approved")) return "approved";
  if (documents.some((d) => d.status === "returned")) return "returned";
  if (documents.some((d) => d.status === "submitted" || d.status === "forwarded")) {
    return "submitted";
  }
  return "draft";
}

/**
 * The catatan that governed the week's most recent decision.
 *
 * Not simply "the last comment written": a plan returned on Monday and
 * approved on Tuesday has two, and the teacher needs the one that goes with
 * the status the cover now shows. `reviewedAt` is the timestamp that tracks
 * the decision, so the newest comment is the one on the most recently
 * reviewed plan.
 */
function newestCatatan(documents: RphDocument[]): string | null {
  const reviewed = documents
    .filter((d) => d.reviewComment?.trim())
    .sort((a, b) => (b.reviewedAt ?? 0) - (a.reviewedAt ?? 0));
  return reviewed[0]?.reviewComment ?? null;
}

export function WeekSheets({
  weekNo,
  session,
  teacherName,
  documents,
  signature,
  signatureState = "none",
  schoolName = currentSchool().name,
}: WeekSheetsProps) {
  // The school week's own order, Monday to Friday — the order the district
  // reads them in, and not the order a query happens to return them.
  const ordered = [...documents].sort((a, b) => a.planDate.localeCompare(b.planDate));

  // One submission time for the week: the last of them. Six plans cannot have
  // been handed in at six times, and the cover's single stamp is the moment
  // the stack was complete.
  const submittedAt = ordered.reduce<number | undefined>(
    (acc, d) => (d.submittedAt && (!acc || d.submittedAt > acc) ? d.submittedAt : acc),
    undefined,
  );

  return (
    <>
      <RphCover
        weekNo={weekNo}
        session={session}
        teacherName={teacherName}
        submittedAt={submittedAt ?? null}
        status={rollup(ordered)}
        signature={signature ?? null}
        signatureState={signatureState}
        comment={newestCatatan(ordered)}
        schoolName={schoolName}
      />
      {ordered.map((doc) => (
        <RphPaper
          key={doc.id}
          payload={doc.payload}
          session={doc.session}
          weekNo={doc.weekNo}
          planDate={doc.planDate}
          slotTime={doc.slotTime}
          slotTimeEnd={doc.slotTimeEnd}
          planClassName={doc.className}
          subjectName={doc.subjectName}
          teacherName={teacherName}
          schoolName={schoolName}
        />
      ))}
    </>
  );
}
