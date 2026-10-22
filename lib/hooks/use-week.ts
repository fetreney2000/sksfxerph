"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { schoolCode, weekDeadline } from "@/lib/config";
import { schoolDays } from "@/lib/date";
import { db, documentsForWeek } from "@/lib/db";
import { useCurrentWeek } from "@/lib/hooks/use-calendar";
import { useSession } from "@/lib/hooks/use-session";
import { ownerId } from "@/lib/owner";
import { normalisePayload } from "@/lib/schemas/rph";
import type { RphDocument } from "@/lib/types";
import { summariseWeek, type WeekCounts } from "@/lib/week-summary";

export interface WeekSummary extends WeekCounts {
  weekNo: number;
  days: string[];
  documents: RphDocument[];
  loading: boolean;
}

const EMPTY_WEEK_COUNTS: WeekCounts = {
  total: 0,
  approved: 0,
  waiting: 0,
  returned: 0,
  drafts: 0,
  action: 0,
  handedIn: 0,
  onTimeCount: 0,
  onTimePct: null,
  approvedPct: 0,
};

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
  // Whose plans, too. IndexedDB is shared by every account on this browser,
  // so asking for "the" plans would be asking for the last one who signed in.
  const owner = ownerId();
  // Inside the hook rather than the module constant `WEEK` used to be: that was
  // evaluated when the bundle loaded, before the school's calendar had been
  // fetched, so it could only ever hold the term-start grid's answer — and a
  // Dexie query keyed on an unchanging value could not re-run once it had.
  const weekNo = useCurrentWeek();

  const summary = useLiveQuery(async () => {
    const documents = await documentsForWeek(owner, session, weekNo);
    return {
      documents,
      ...summariseWeek(documents, weekDeadline(weekNo).getTime()),
    };
  }, [owner, session, weekNo]);

  // `summariseWeek` owns the definitions — approved, waiting, action and the
  // punctuality denominator all come from the same pass over the same rows.
  const counts = summary ?? EMPTY_WEEK_COUNTS;

  return {
    weekNo,
    days: schoolDays(weekNo),
    documents: summary?.documents ?? [],
    ...counts,
    loading: summary === undefined,
  };
}

/** All documents this teacher has ever written, newest first. */
export function useArchive() {
  const session = useSession();
  const owner = ownerId();
  return useLiveQuery(
    async () => {
      const all = await db.documents
        .where("[ownerId+session]")
        .equals([owner, session])
        .toArray();
      // Normalised on the way out, not on the way in: Dexie holds whatever
      // was written, including plans saved before the template reshape, and
      // a reader that assumes the current shape crashes on them. One place
      // to normalise beats every screen remembering to.
      return all
        .map((d) => ({ ...d, payload: normalisePayload(d.payload) }))
        .sort((a, b) => (a.planDate < b.planDate ? 1 : a.planDate > b.planDate ? -1 : 0));
    },
    [owner, session],
    [] as RphDocument[],
  );
}

export { schoolCode };
