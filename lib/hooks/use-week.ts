"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { currentWeek, schoolCode, weekDeadline } from "@/lib/config";
import { schoolDays } from "@/lib/date";
import { db, documentsForWeek } from "@/lib/db";
import { LOCAL_OWNER_ID } from "@/lib/demo/seed";
import { useSession } from "@/lib/hooks/use-session";
import { normalisePayload } from "@/lib/schemas/rph";
import type { RphDocument } from "@/lib/types";

export const WEEK = currentWeek();

export interface WeekSummary {
  weekNo: number;
  days: string[];
  documents: RphDocument[];
  submitted: number;
  waiting: number;
  returned: number;
  drafts: number;
  total: number;
  completenessPct: number;
  /** Share of this teacher's submitted plans that beat the Friday deadline. */
  onTimePct: number | null;
  loading: boolean;
}

/**
 * Everything the dashboard and archive need from IndexedDB, in one live query.
 * `useLiveQuery` re-renders on any matching write — this is how the editor's
 * save shows up in the dashboard without any global store.
 */
export function useWeek(): WeekSummary {
  // The session is a dependency, not a constant read inside the callback: Dexie
  // caches the result of the last run, so a school that rolls its year over
  // would otherwise keep showing last year's plans until something else
  // invalidated the query.
  const session = useSession();

  const summary = useLiveQuery(async () => {
    const documents = await documentsForWeek(LOCAL_OWNER_ID, session, WEEK);
    const total = documents.length || 0;
    const count = (s: RphDocument["status"]) => documents.filter((d) => d.status === s).length;
    // "Left the teacher" and "still awaiting a decision" are the same set at
    // either rung: a plan is with the GPK (`submitted`) or with the Guru Besar
    // (`forwarded`) until it is approved or returned.
    const outForDecision = count("submitted") + count("forwarded");

    // Punctuality, computed rather than asserted: of the plans that have been
    // handed in, how many arrived before Friday 16:00. Nothing submitted yet
    // is `null`, not 0 — "no data" and "all late" are different answers.
    const deadline = weekDeadline(WEEK).getTime();
    const handed = documents.filter((d) => d.submittedAt !== undefined);
    const onTime = handed.filter((d) => (d.submittedAt ?? 0) <= deadline).length;

    return {
      weekNo: WEEK,
      days: schoolDays(WEEK),
      documents,
      total,
      submitted: outForDecision,
      waiting: outForDecision,
      returned: count("returned"),
      drafts: count("draft"),
      completenessPct:
        total === 0
          ? 0
          : Math.round((documents.filter((d) => d.status === "approved").length / total) * 100),
      onTimePct: handed.length === 0 ? null : Math.round((onTime / handed.length) * 100),
    };
  }, [session]);

  return {
    weekNo: WEEK,
    days: schoolDays(WEEK),
    documents: summary?.documents ?? [],
    submitted: summary?.submitted ?? 0,
    waiting: summary?.waiting ?? 0,
    returned: summary?.returned ?? 0,
    drafts: summary?.drafts ?? 0,
    total: summary?.total ?? 0,
    completenessPct: summary?.completenessPct ?? 0,
    onTimePct: summary?.onTimePct ?? null,
    loading: summary === undefined,
  };
}

/** All documents this teacher has ever written, newest first. */
export function useArchive() {
  const session = useSession();
  return useLiveQuery(
    async () => {
      const all = await db.documents
        .where("[ownerId+session]")
        .equals([LOCAL_OWNER_ID, session])
        .toArray();
      // Normalised on the way out, not on the way in: Dexie holds whatever
      // was written, including plans saved before the template reshape, and
      // a reader that assumes the current shape crashes on them. One place
      // to normalise beats every screen remembering to.
      return all
        .map((d) => ({ ...d, payload: normalisePayload(d.payload) }))
        .sort((a, b) => (a.planDate < b.planDate ? 1 : a.planDate > b.planDate ? -1 : 0));
    },
    [session],
    [] as RphDocument[],
  );
}

export { schoolCode };
