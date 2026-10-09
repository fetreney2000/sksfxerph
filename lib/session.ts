/**
 * The school session the app is currently working in (`2026/2027`).
 *
 * It started life as a plain constant in `lib/config.ts`, but a constant cannot
 * be changed by the person whose job it is to change it: the school year rolls
 * over once a year and the administrator does it from `/pentadbiran`. Three
 * things read this value and all three have to agree or sync breaks:
 *
 *   • `createPlan` stamps it on every document it writes;
 *   • `sync_rph` refuses a plan whose `session` does not match the class's;
 *   • the Dexie queries key on it, so the dashboard and archive filter by it.
 *
 * Hence a tiny store rather than a constant: `DEFAULT_SESSION` is the value for
 * local mode and the first paint, `currentSession()` is what non-React code
 * reads, and `setSession()` is called once by the shell from the server-resolved
 * value. Components subscribe through `lib/hooks/use-session.ts` so a rollover
 * re-renders them instead of leaving stale rows on screen.
 *
 * The split matters for correctness, not tidiness: if the client kept the
 * build-time value while the server used the new one, a teacher's next plan
 * would carry the old session, `sync_rph` would reject it as "kelas bukan dalam
 * sekolah/sesi anda", and the failure would look like a network problem.
 */

/** Local mode, and the value used before the shell has resolved the real one. */
export const DEFAULT_SESSION = "2026/2027";

let current: string = DEFAULT_SESSION;

const listeners = new Set<() => void>();

/** The session in effect. Safe to call from anywhere, React or not. */
export function currentSession(): string {
  return current;
}

/**
 * Adopt a session. Idempotent — called from a layout effect on every navigation
 * — and a malformed value is ignored rather than written, because a bad session
 * would silently empty every screen that filters on it.
 */
export function setSession(next: string): void {
  if (!/^\d{4}\/\d{4}$/.test(next) || next === current) return;
  current = next;
  for (const listener of listeners) listener();
}

/** Subscribe — the shape `useSyncExternalStore` expects. */
export function subscribeSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
