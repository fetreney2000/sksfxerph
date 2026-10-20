import type { RphStatus } from "@/lib/types";

/**
 * The smallest part of a plan the weekly summary needs.
 *
 * Deliberately structural rather than `RphDocument`: the arithmetic can be
 * tested without IndexedDB, and a caller cannot accidentally make the counts
 * depend on a field the summary does not own.
 */
export interface WeekDocument {
  status: RphStatus;
  submittedAt?: number;
}

export interface WeekCounts {
  total: number;
  /** Plans that have finished the process. */
  approved: number;
  /** Plans still with a reviewer (`submitted` or the legacy `forwarded`). */
  waiting: number;
  returned: number;
  drafts: number;
  /**
   * The work the teacher still owns: drafts plus plans returned for repair.
   * `approved + waiting + action === total`.
   */
  action: number;
  /** Plans that have ever left the teacher, including approved/returned ones. */
  handedIn: number;
  onTimeCount: number;
  /** Of `handedIn`, the share that arrived before the deadline. */
  onTimePct: number | null;
  /** Share of the week's expected plans that are approved. */
  approvedPct: number;
}

/**
 * One definition of where a week stands.
 *
 * The dashboard used to feed "Dihantar" and "Menunggu semakan" from the same
 * count, draw the first card's progress bar from `approved / total`, and count
 * only returned plans as "Perlu tindakan". Each number was individually
 * plausible, but together they described different weeks. Keeping the
 * arithmetic here means the greeting, cards, deadline banner and progress bar
 * cannot drift apart again.
 */
export function summariseWeek(
  documents: readonly WeekDocument[],
  deadline: number,
): WeekCounts {
  const count = (status: RphStatus) => documents.filter((d) => d.status === status).length;
  const total = documents.length;
  const approved = count("approved");
  const waiting = count("submitted") + count("forwarded");
  const returned = count("returned");
  const drafts = count("draft");
  const handed = documents.filter((d) => d.submittedAt !== undefined);
  const onTimeCount = handed.filter((d) => (d.submittedAt ?? 0) <= deadline).length;

  return {
    total,
    approved,
    waiting,
    returned,
    drafts,
    action: drafts + returned,
    handedIn: handed.length,
    onTimeCount,
    onTimePct: handed.length === 0 ? null : Math.round((onTimeCount / handed.length) * 100),
    approvedPct: total === 0 ? 0 : Math.round((approved / total) * 100),
  };
}
