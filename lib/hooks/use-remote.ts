"use client";

import { useQuery } from "@tanstack/react-query";
import { handleExpiredSession } from "@/lib/client/auth-session";
import { currentWeek, SESSION, schoolCode, supabaseConfigured } from "@/lib/config";
import { QUEUE, type QueueItem, SCHOOL_STATS } from "@/lib/demo/review";

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

export interface SchoolStatsView {
  activeTeachers: number;
  totalExpected: number;
  submitted: number;
  approved: number;
  compliancePct: number;
  avgMinutes: number;
  byPanel: { label: string; pct: number }[];
  weeks: { week: number; pct: number; rejected: number }[];
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
  const remote = useQuery<{ items: QueueItem[] }>({
    queryKey: ["review-queue", schoolCode, SESSION, stage],
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
export function useSchoolStats(): SchoolStatsView {
  const remote = useQuery<WeekStatsRow | null>({
    queryKey: ["school-stats", schoolCode, SESSION, WEEK],
    queryFn: async () => {
      const res = await fetch("/api/stats", { credentials: "same-origin" });
      if (handleExpiredSession(res.status)) return null;
      if (!res.ok) return null; // local mode (503), signed out (401), no school
      const body = (await res.json()) as { stats: WeekStatsRow | null };
      return body.stats;
    },
    // Same as the queue: local mode has no backend, so don't ask.
    enabled: supabaseConfigured,
    retry: false,
    staleTime: 60_000,
  });

  const base: SchoolStatsView = { ...SCHOOL_STATS, loading: remote.isLoading };
  if (!supabaseConfigured || !remote.data) return base;

  const s = remote.data;
  return {
    ...base,
    submitted: s.submitted,
    approved: s.approved,
    compliancePct: s.compliance ?? base.compliancePct,
    totalExpected: s.expected || base.totalExpected,
  };
}
