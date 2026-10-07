"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { currentWeek, SESSION, schoolCode } from "@/lib/config";
import { schoolDays } from "@/lib/date";
import { db, documentsForWeek } from "@/lib/db";
import { LOCAL_OWNER_ID } from "@/lib/demo/seed";
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
  loading: boolean;
}

/**
 * Everything the dashboard and archive need from IndexedDB, in one live query.
 * `useLiveQuery` re-renders on any matching write — this is how the editor's
 * save shows up in the dashboard without any global store.
 */
export function useWeek(): WeekSummary {
  const summary = useLiveQuery(async () => {
    const documents = await documentsForWeek(LOCAL_OWNER_ID, SESSION, WEEK);
    const total = documents.length || 0;
    const count = (s: RphDocument["status"]) => documents.filter((d) => d.status === s).length;

    return {
      weekNo: WEEK,
      days: schoolDays(WEEK),
      documents,
      total,
      submitted: count("submitted"),
      waiting: count("submitted"),
      returned: count("returned"),
      drafts: count("draft"),
      completenessPct:
        total === 0
          ? 0
          : Math.round((documents.filter((d) => d.status === "approved").length / total) * 100),
    };
  }, []);

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
    loading: summary === undefined,
  };
}

/** All documents this teacher has ever written, newest first. */
export function useArchive() {
  return useLiveQuery(
    async () => {
      const all = await db.documents
        .where("[ownerId+session]")
        .equals([LOCAL_OWNER_ID, SESSION])
        .toArray();
      return all.sort((a, b) =>
        a.planDate < b.planDate ? 1 : a.planDate > b.planDate ? -1 : 0,
      );
    },
    [],
    [] as RphDocument[],
  );
}

export { schoolCode };
