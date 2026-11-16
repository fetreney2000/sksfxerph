"use client";

import { useQuery } from "@tanstack/react-query";
import { useLiveQuery } from "dexie-react-hooks";
import type { DocumentRow } from "@/app/api/rph/route";
import { handleExpiredSession } from "@/lib/client/auth-session";
import { schoolCode, supabaseConfigured, weekDeadline } from "@/lib/config";
import { schoolDays } from "@/lib/date";
import { db } from "@/lib/db";
import { useCurrentWeek } from "@/lib/hooks/use-calendar";
import { useSession } from "@/lib/hooks/use-session";
import { ownerId } from "@/lib/owner";
import { toLocalPlan } from "@/lib/rph-doc";
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
 * The teacher's own plans, newest first.
 *
 * Synced mode reads the server directly - there is no local mirror to keep in
 * step, so what the dashboard, the archive and the editor open is always what
 * the server has. Local mode (the development harness) reads IndexedDB, where
 * the demo seed lives.
 */
export function useOwnPlans(): { items: RphDocument[]; loading: boolean } {
  const session = useSession();
  const remote = useQuery<{ items: DocumentRow[] }>({
    queryKey: ["own-plans", schoolCode, session],
    queryFn: async () => {
      const res = await fetch("/api/rph", { credentials: "same-origin" });
      if (handleExpiredSession(res.status)) return { items: [] };
      if (!res.ok) return { items: [] };
      return (await res.json()) as { items: DocumentRow[] };
    },
    enabled: supabaseConfigured,
    retry: 1,
    staleTime: 30_000,
  });

  const local = useLiveQuery(async () => {
    if (supabaseConfigured) return [] as RphDocument[];
    const owner = ownerId();
    return db.documents.where("[ownerId+session]").equals([owner, session]).toArray();
  }, [session]);

  if (!supabaseConfigured) {
    // Normalised on the way out: Dexie holds whatever was written, including
    // plans saved before the template reshape - and a reader that assumed the
    // current shape would crash on the first field that did.
    return {
      items: (local ?? []).map((d) => ({ ...d, payload: normalisePayload(d.payload) })),
      loading: local === undefined,
    };
  }
  if (remote.isLoading) return { items: [], loading: true };
  return { items: (remote.data?.items ?? []).map(toLocalPlan), loading: false };
}

/**
 * Everything the dashboard and archive need - derived from the teacher's own
 * plans, so the week view, the archive and the editor all read the same rows.
 */
export function useWeek(): WeekSummary {
  // The session is a dependency, not a constant read inside the callback: a
  // request scoped on a stale session would keep showing last year's plans.
  const session = useSession();
  // Inside the hook rather than a module constant: the school's declared
  // weeks arrive after the bundle loads, and a module constant could never
  // re-render once they did.
  const weekNo = useCurrentWeek();
  const { items, loading } = useOwnPlans();
  // IndexedDB is shared by every account on this browser, so the harness
  // path must ask for the signed-in account's plans - never "the" plans.
  // (The server already scopes to the caller; filtering here too keeps one
  // rule for both paths.)
  const owner = ownerId();

  const documents = items.filter(
    (d) => d.ownerId === owner && d.session === session && d.weekNo === weekNo,
  );
  const summary = summariseWeek(documents, weekDeadline(weekNo).getTime());

  // `summariseWeek` owns the definitions - approved, waiting, action and the
  // punctuality denominator all come from the same pass over the same rows.
  const counts = loading ? EMPTY_WEEK_COUNTS : summary;

  return {
    weekNo,
    days: schoolDays(weekNo),
    documents: loading ? [] : documents,
    ...counts,
    loading,
  };
}

/** All documents this teacher has ever written, newest first. */
export function useArchive(): RphDocument[] {
  const { items } = useOwnPlans();
  return [...items].sort((a, b) =>
    a.planDate < b.planDate ? 1 : a.planDate > b.planDate ? -1 : 0,
  );
}

export { schoolCode };
