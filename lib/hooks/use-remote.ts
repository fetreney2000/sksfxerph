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
  /** Active guru_biasa that week. Historical membership is not recorded, so this is current headcount repeated. */
  teachers: number;
  /** RPH owed that week — teachers × the school's own `rph_per_week` (five for a Monday–Friday school). */
  expected: number;
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
  /** RPH the school owes across the window: teachers × the school's weekly rule × the weeks in view. */
  expected: number;
  submitted: number;
  approved: number;
  returned: number;
  /**
   * Approved against what the school owes, capped at 100.
   *
   * `null` is a real state, not zero: either the school has no denominator at
   * all (no active Guru Biasa) or these figures have not been measured —
   * still loading, or unreachable. A page that must show something shows "—".
   */
  compliancePct: number | null;
  avgMinutes: number | null;
  /** The same figure for the week before, so a trend is measured rather than asserted. */
  prevAvgMinutes: number | null;
  /** Six weeks ending now. */
  weeks: SchoolWeekPoint[];
  loading: boolean;
}

interface WeekStatsRow {
  teachers: number;
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
      // Everything else — a Guru Biasa's 403, a 500, and a 503 from a proxy
      // or a deployment mid-restart — is an empty queue, not the demo one.
      // This query only ever runs in synced mode (`enabled` below), so a 503
      // here means the school's own service did not answer, which is exactly
      // when three colleagues' demo RPH would be the worst thing to show.
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
/**
 * School figures for a week window, plus the weeks behind them.
 *
 * Every card is derived from the *same* rows the chart draws. That is the
 * point: with the filter widening the window, a total computed from one
 * source beside a chart drawn from another is a total that can disagree with
 * the evidence next to it.
 *
 * Local mode has no backend, so the bundled demo figures stand in — and that
 * is what local mode is. What must not happen is synced mode leaving some of
 * them standing, which is the bug this replaced: byPanel, weeks and
 * avgMinutes survived every refresh and were then read as the school's own.
 */
/**
 * The school's figures — for a role that may have them.
 *
 * `enabled` is the caller's *permission*, not a loading flag. Whole-school
 * figures are a supervisor's question: a Guru Biasa's dashboard is about their
 * own week, and it says nothing about anyone else's. Passing `false` fetches
 * nothing at all — least of all the bundled demo figures, which describe a
 * different school and would be shown as this one's.
 */
export function useSchoolStats(
  range?: { first: number; last: number },
  enabled = true,
): SchoolStatsView {
  const session = useSession();
  const first = range?.first ?? WEEK;
  const last = range?.last ?? WEEK;

  const remote = useQuery<{ stats: WeekStatsRow | null; history: SchoolWeekPoint[] }>({
    queryKey: ["school-stats", schoolCode, session, first, last],
    queryFn: async () => {
      // One week *before* the range is fetched and then dropped, so a
      // single-week view still has something to state a change against.
      // Without it, "Minggu 5" could never say whether it beat week 4 —
      // week 4 was never asked for.
      const res = await fetch(`/api/stats?first=${first - 1}&last=${last}`, {
        credentials: "same-origin",
      });
      const empty = { stats: null, history: [] as SchoolWeekPoint[] };
      if (handleExpiredSession(res.status)) return empty;
      if (!res.ok) return empty; // local mode (503), signed out (401), no school
      return (await res.json()) as { stats: WeekStatsRow | null; history: SchoolWeekPoint[] };
    },
    // Not asked for at all when the role may not see it — a request that can
    // only answer 403 is a request that should never have been made.
    enabled: supabaseConfigured && enabled,
    retry: false,
    staleTime: 60_000,
  });

  /** The "nothing measured" answer: zeroes, and a rate nobody computed. */
  const empty: SchoolStatsView = {
    activeTeachers: 0,
    expected: 0,
    submitted: 0,
    approved: 0,
    returned: 0,
    compliancePct: null,
    avgMinutes: null,
    prevAvgMinutes: null,
    weeks: [],
    loading: enabled && remote.isLoading,
  };

  if (!enabled) return empty;

  const base: SchoolStatsView = {
    activeTeachers: SCHOOL_STATS.activeTeachers,
    expected: SCHOOL_STATS.weeks[0]?.expected ?? 0,
    submitted: SCHOOL_STATS.submitted,
    approved: SCHOOL_STATS.approved,
    returned: SCHOOL_STATS.returned,
    compliancePct: SCHOOL_STATS.compliancePct,
    avgMinutes: SCHOOL_STATS.avgMinutes,
    prevAvgMinutes: null,
    weeks: SCHOOL_STATS.weeks,
    loading: remote.isLoading,
  };

  // Local mode has no backend, so the bundled figures *are* the data — and
  // local mode is a demo by construction.
  if (!supabaseConfigured) return base;

  // Synced mode with nothing to answer: still loading, an expired session, or
  // a failed request. The bundled figures describe a different school and must
  // not be shown as this one's, which is the leak this hook's own docblock
  // promises cannot happen. Zeroes and a null rate read as "nothing measured
  // yet"; 42 teachers at 88.6% read as a term that already went well.
  if (!remote.data?.stats) return empty;

  const all = remote.data.history;
  const weeks = all.filter((w) => w.week >= first && w.week <= last);
  const before = all.find((w) => w.week === first - 1);

  const sum = (pick: (w: SchoolWeekPoint) => number) =>
    weeks.reduce((total, w) => total + pick(w), 0);

  // Mean of the *weekly* averages, not of the plans: the RPC returns a
  // per-week figure and nothing to weight it by. Averaging averages is a
  // legitimate statistic and is what the card's sub-label says it is, but it
  // is not "the average plan", so it is not presented as one.
  const timed = weeks.filter((w) => w.avgMinutes !== null);
  const mean =
    timed.length === 0
      ? null
      : timed.reduce((total, w) => total + (w.avgMinutes ?? 0), 0) / timed.length;

  // The headcount for the roster, and what the school actually owes — they
  // stopped being the same number when the denominator was fixed. The
  // teaching headcount, not a tally of who has submitted.
  const teachers = weeks[0]?.teachers ?? 0;
  const required = sum((w) => w.expected);

  return {
    activeTeachers: teachers,
    expected: required,
    submitted: sum((w) => w.submitted),
    approved: sum((w) => w.approved),
    returned: sum((w) => w.returned),
    // Approved plans against the RPH the school owes across this window: the
    // school's own weekly rule × the teachers × the weeks in view. Dividing by
    // the headcount alone is what made a finished week read as 500%, and a
    // school with two teachers and six approved plans between them as 300%.
    // Capped at 100 for the same reason the SQL caps it — handing in more than
    // the week requires has met the requirement, not exceeded it — and the
    // counts on the same card still say exactly how many were approved.
    // Null rather than zero when there is no denominator: a school with no
    // active Guru Biasa has not scored 0%, it has not been scored.
    compliancePct:
      required === 0 || weeks.length === 0
        ? null
        : Math.min(100, Math.round((sum((w) => w.approved) / required) * 1000) / 10),
    // Null, not zero: a window with no decided plan has not stopped its
    // clock, and "0 minit" would read as a school that decided instantly.
    avgMinutes: mean,
    prevAvgMinutes: before?.avgMinutes ?? null,
    weeks,
    loading: remote.isLoading,
  };
}
