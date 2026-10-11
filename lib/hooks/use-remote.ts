"use client";

import { useQuery } from "@tanstack/react-query";
import { handleExpiredSession } from "@/lib/client/auth-session";
import { currentWeek, schoolCode, supabaseConfigured } from "@/lib/config";
import { QUEUE, type QueueItem, SCHOOL_STATS } from "@/lib/demo/review";
import { useSession } from "@/lib/hooks/use-session";

/**
 * Remote data hooks.
 *
 * Backend §6: admin screens read the school's data when Supabase is
 * configured, and fall back to the bundled local-mode dataset otherwise. The
 * components consume the same shape either way, so switching a deployment from
 * local to synced changes the data source, not the UI.
 *
 * These used to query PostgREST directly from the browser. With Supabase Auth
 * removed there is no user JWT to send, so every read now goes through a route
 * handler that authenticates the session cookie and scopes the query to that
 * user's school — the browser never touches the database.
 */

const WEEK = currentWeek();

/** One point on the weekly trend. Every figure is counted, never modelled. */
export interface SchoolWeekPoint {
  week: number;
  submitted: number;
  approved: number;
  returned: number;
  /** Null for a week whose denominator was zero — not zero, which would read as a collapse. */
  compliance: number | null;
  /** Submission → review decision. Null while the week still has undecided plans. */
  avgMinutes: number | null;
}

export interface SchoolStatsView {
  /** Active guru_biasa — the teaching headcount, not a tally of who has submitted. */
  activeTeachers: number;
  submitted: number;
  approved: number;
  returned: number;
  compliancePct: number;
  avgMinutes: number | null;
  /** The same figure for the week before, so a trend is measured rather than asserted. */
  prevAvgMinutes: number | null;
  /** Six weeks ending now. */
  weeks: SchoolWeekPoint[];
  loading: boolean;
}

interface WeekStatsRow {
  expected: number;
  submitted: number;
  approved: number;
  returned_t: number;
  drafts: number;
  compliance: number | null;
}

/**
 * Plans awaiting a grade for one reviewer's stage.
 *
 * `stage` is the rung this user owns — `submitted` for a GPK, `forwarded` for
 * a Guru Besar — so the same hook serves both without the component having to
 * know which. Passing it in rather than reading the role here keeps `lib/`
 * from reaching into `components/`.
 */
export function useReviewQueueData(stage: "submitted" | "forwarded" | null): {
  items: QueueItem[];
  loading: boolean;
} {
  const session = useSession();
  const remote = useQuery<{ items: QueueItem[] }>({
    // The session is in the key so rolling the school year over refetches rather
    // than serving last year's cache — the server filters on it too.
    queryKey: ["review-queue", schoolCode, session, stage],
    queryFn: async () => {
      const res = await fetch("/api/queue", { credentials: "same-origin" });
      // Expired session: leave rather than fall back to demo data — a reviewer
      // must never be shown fake plans as if they were the real queue.
      if (handleExpiredSession(res.status)) return { items: [] };
      // Local mode has no backend, and there the bundled dataset *is* the data.
      if (res.status === 503) return { items: QUEUE };
      // Anything else — a Guru Biasa's 403, a 500 — must not be papered over
      // with fabricated plans. An empty queue reads as "nothing to do", which
      // is the truth; three colleagues' demo RPH read as work that is not there.
      if (!res.ok) return { items: [] };
      return (await res.json()) as { items: QueueItem[] };
    },
    // Local mode has no backend: don't issue a request we know returns 503,
    // it just logs a scary console error for something that is not a failure.
    enabled: supabaseConfigured,
    retry: false,
    staleTime: 30_000,
  });

  // Bundled dataset, filtered to this reviewer's stage so the demo matches
  // what the server would have returned.
  if (!supabaseConfigured) {
    return { items: stage ? QUEUE.filter((q) => q.status === stage) : [], loading: false };
  }
  if (remote.isLoading) return { items: [], loading: true };
  return { items: remote.data?.items ?? [], loading: false };
}

/** School compliance; falls back to the bundled demo figures in local mode. */
/**
 * School compliance for the current week, plus the six-week trend behind it.
 *
 * Local mode has no backend, so the bundled demo figures stand in — and that
 * is what local mode is. What must not happen is synced mode leaving some of
 * them standing, which is the bug this replaced: byPanel, weeks and
 * avgMinutes survived every refresh and were then read as the school's own.
 */
export function useSchoolStats(): SchoolStatsView {
  const session = useSession();
  const remote = useQuery<{ stats: WeekStatsRow | null; history: SchoolWeekPoint[] }>({
    queryKey: ["school-stats", schoolCode, session, WEEK],
    queryFn: async () => {
      const res = await fetch("/api/stats", { credentials: "same-origin" });
      const empty = { stats: null, history: [] as SchoolWeekPoint[] };
      if (handleExpiredSession(res.status)) return empty;
      if (!res.ok) return empty; // local mode (503), signed out (401), no school
      return (await res.json()) as { stats: WeekStatsRow | null; history: SchoolWeekPoint[] };
    },
    // Same as the queue: local mode has no backend, so don't ask.
    enabled: supabaseConfigured,
    retry: false,
    staleTime: 60_000,
  });

  const base: SchoolStatsView = {
    activeTeachers: SCHOOL_STATS.activeTeachers,
    submitted: SCHOOL_STATS.submitted,
    approved: SCHOOL_STATS.approved,
    returned: SCHOOL_STATS.returned,
    compliancePct: SCHOOL_STATS.compliancePct,
    avgMinutes: SCHOOL_STATS.avgMinutes,
    prevAvgMinutes: null,
    weeks: SCHOOL_STATS.weeks,
    loading: remote.isLoading,
  };

  if (!supabaseConfigured || !remote.data?.stats) return base;

  const s = remote.data.stats;
  const weeks = remote.data.history;
  const here = weeks.find((w) => w.week === WEEK);
  const before = weeks.find((w) => w.week === WEEK - 1);

  return {
    // The teaching headcount, not a tally of who has submitted — the previous
    // sub-label claimed the latter, which the RPC does not compute.
    activeTeachers: s.expected,
    submitted: s.submitted,
    approved: s.approved,
    returned: s.returned_t,
    compliancePct: s.compliance ?? 0,
    // Null, not zero: a week still in progress has not stopped its clock, and
    // "0 minit" would read as a school that decided instantly.
    avgMinutes: here?.avgMinutes ?? null,
    prevAvgMinutes: before?.avgMinutes ?? null,
    weeks,
    loading: remote.isLoading,
  };
}
