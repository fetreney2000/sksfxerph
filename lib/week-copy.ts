import { weekMondayIso } from "@/lib/config";
import { schoolDays } from "@/lib/date";
import { normalisePayload, type RphPayload } from "@/lib/schemas/rph";
import type { RphDocument, SchoolClass } from "@/lib/types";

/**
 * Copying a whole week of RPH into another week.
 *
 * A teacher who missed a week - illness, a course, a family matter - still owes
 * that week's plans. Re-typing five plans to back-date them is the chore this
 * exists to remove. The copy is deliberately conservative:
 *
 *   · every copied plan is a **draft** - the reviewer has not seen it;
 *   · **Refleksi is cleared**. It is a factual statement about one lesson that
 *     happened ("7 daripada 28 murid keliru"), and carrying it forward would put
 *     a previous lesson's outcome on a lesson that has not been taught;
 *   · a date keeps its weekday position in the destination week, so Monday's
 *     plan stays Monday's plan;
 *   · a clash is reported, never silently overwritten: the natural key is the
 *     same one `POST /api/rph` enforces (subject + date + a shared class).
 */

export interface WeekCopyCandidate {
  sourceId: string;
  subjectCode: string;
  subjectName: string;
  classIds: string[];
  classNames: string[];
  slotTime: string;
  slotTimeEnd: string;
  payload: RphPayload;
  sourceDate: string;
  planDate: string;
  weekNo: number;
  /** Anything that would stop or change this copy. Empty when it is clean. */
  conflicts: string[];
  /** True when there is no active class left to file the plan under. */
  blocked: boolean;
}

/** A copy starts a new lesson: the previous lesson's reflection is not its own. */
export function clearedReflection(payload: RphPayload): RphPayload {
  return { ...payload, refleksi: "" };
}

/**
 * The same weekday in another week.
 *
 * `plan_date` is a fact about a lesson, and a copied lesson keeps its place in
 * the week. A date that is not one of the source week's five school days (an
 * older row written before the calendar was declared, say) falls back to the
 * destination Monday rather than inventing a Saturday.
 */
export function planDateInWeek(
  sourceDate: string,
  _sourceWeek: number,
  destinationWeek: number,
): string {
  // The weekday is a property of the date itself, not of a week number that may
  // belong to another session's calendar. Weekend dates fall back to Monday.
  const parsed = Date.parse(`${sourceDate}T00:00:00Z`);
  const dow = Number.isFinite(parsed) ? new Date(parsed).getUTCDay() : 1;
  const position = dow >= 1 && dow <= 5 ? dow - 1 : 0;
  const destinationDays = schoolDays(destinationWeek);
  return destinationDays[position] ?? destinationDays[0] ?? weekMondayIso(destinationWeek);
}

/** The message shown before a copy, not after it. */
function clashLabel(candidate: { subjectName: string; planDate: string }): string {
  return `${candidate.subjectName} · ${candidate.planDate}`;
}

/**
 * Build the preview for a destination week.
 *
 * `destinationPlans` is every plan already in the destination week - including
 * the source week itself when a teacher picks it - so a copy onto itself is
 * reported as a clash instead of duplicating every row.
 */
export function buildWeekCopyCandidates(
  sourcePlans: readonly RphDocument[],
  destinationPlans: readonly RphDocument[],
  destinationWeek: number,
  classes: readonly SchoolClass[],
): WeekCopyCandidate[] {
  const active = new Map(classes.map((c) => [c.id, c.nama]));
  const accepted: WeekCopyCandidate[] = [];

  return sourcePlans.map((source) => {
    const kept = source.classIds.filter((id) => active.has(id));
    const missingNames = source.classIds
      .filter((id) => !active.has(id))
      .map((id) => source.classNames[source.classIds.indexOf(id)] ?? id);

    const candidate: WeekCopyCandidate = {
      sourceId: source.id,
      subjectCode: source.subjectCode,
      subjectName: source.subjectName,
      classIds: kept,
      classNames: kept.map((id) => active.get(id) ?? ""),
      slotTime: source.slotTime,
      slotTimeEnd: source.slotTimeEnd,
      payload: clearedReflection(normalisePayload(source.payload)),
      sourceDate: source.planDate,
      planDate: planDateInWeek(source.planDate, source.weekNo, destinationWeek),
      weekNo: destinationWeek,
      conflicts: [],
      blocked: false,
    };

    if (missingNames.length > 0) {
      candidate.conflicts.push(`Kelas tidak lagi aktif: ${missingNames.join(", ")}`);
    }
    if (kept.length === 0) {
      candidate.blocked = true;
      candidate.conflicts.push("Tiada kelas aktif - RPH ini tidak boleh disalin.");
    }

    const existing = destinationPlans.find(
      (plan) =>
        plan.id !== source.id &&
        plan.subjectCode === candidate.subjectCode &&
        plan.planDate === candidate.planDate &&
        plan.classIds.some((id) => candidate.classIds.includes(id)),
    );
    if (existing) {
      candidate.conflicts.push(
        `Bertindih dengan RPH sedia ada (${clashLabel({ ...candidate, planDate: candidate.planDate })}).`,
      );
      candidate.blocked = true;
    }

    const earlier = accepted.find(
      (other) =>
        other.subjectCode === candidate.subjectCode &&
        other.planDate === candidate.planDate &&
        other.classIds.some((id) => candidate.classIds.includes(id)),
    );
    if (earlier) {
      candidate.conflicts.push(
        `Bertindih dengan RPH lain dalam salinan ini (${clashLabel(candidate)}).`,
      );
      candidate.blocked = true;
    }

    if (!candidate.blocked) accepted.push(candidate);
    return candidate;
  });
}
