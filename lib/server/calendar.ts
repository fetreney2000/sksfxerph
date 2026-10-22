import type { CalendarAnchor } from "@/lib/config";
import { adminDb } from "@/lib/server/db";

/**
 * The school's declared weeks, for the server side of `currentWeek()`.
 *
 * `currentWeek()` defaults to a module-level store so the ~18 client call sites
 * can simply ask. A server process must not do that: every handler would share
 * one array, so whichever request loaded last would decide what every other
 * request meant by "this week". This deployment is single-school today, but
 * that is not a property worth quietly relying on — each handler passes its own
 * school's rows in as the second argument instead, and `currentWeek` stays
 * pure.
 *
 * Cached for 30 seconds, the same `staleTime` the client uses: a week's number
 * does not move while somebody is reading it, and one lookup per request would
 * be a round trip on every stats call to fetch at most a few dozen rows.
 *
 * **Failure returns no rows, on purpose.** An empty calendar is exactly what
 * local mode, a fresh deployment and a school that never overrode anything all
 * have, and in that state the server numbers weeks from the term start — which
 * is what it has always done. A read error therefore degrades to the previous
 * behaviour rather than taking the dashboard down; it is logged, because a
 * school that *did* declare weeks would otherwise see the wrong ones and have
 * no way to tell why.
 */
const TTL_MS = 30_000;
const cache = new Map<string, { at: number; rows: readonly CalendarAnchor[] }>();

/** Drop the cached rows — called when an administrator changes them. */
export function invalidateCalendarCache(schoolId?: string): void {
  if (schoolId) cache.delete(schoolId);
  else cache.clear();
}

export async function loadCalendarAnchors(
  schoolId: string,
): Promise<readonly CalendarAnchor[]> {
  const hit = cache.get(schoolId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.rows;

  let rows: readonly CalendarAnchor[] = [];
  try {
    const db = adminDb();
    const [setting, calendar] = await Promise.all([
      db
        .from("school_setting")
        .select("current_session")
        .eq("school_id", schoolId)
        .maybeSingle(),
      db
        .from("academic_calendar")
        .select("session, week_no, start_date, label")
        .eq("school_id", schoolId)
        .order("start_date", { ascending: true }),
    ]);

    const session = (setting.data as { current_session: string } | null)?.current_session;
    if (setting.error) {
      console.error("[calendar] session read failed:", setting.error.message);
    } else if (calendar.error) {
      console.error("[calendar] read failed:", calendar.error.message);
    } else if (session) {
      // Only the running session's rows: last year's declarations are still in
      // the table and would renumber this year's weeks.
      rows = (calendar.data ?? [])
        .filter((row) => row.session === session)
        .map((row) => ({ weekNo: row.week_no, startDate: row.start_date, label: row.label }));
    }
  } catch (err) {
    console.error("[calendar] load failed:", err);
  }

  cache.set(schoolId, { at: Date.now(), rows });
  return rows;
}
