import { SCHOOL } from "@/lib/config";

/**
 * The school's identity — name, place, motto, crest — as the app currently
 * knows it.
 *
 * It began as the `SCHOOL` constant in `lib/config.ts`, which meant a school
 * could not describe itself without a redeploy. The administrator now edits it
 * from `/pentadbiran`, so it has to be readable at runtime by ordinary
 * components: a module store, exactly like `lib/session.ts`, for the same
 * reason — plain functions (`rph-paper`'s default, the export route) need the
 * value and cannot use a hook.
 *
 * `DEFAULT_SCHOOL` is what local mode shows and what the first paint uses
 * before the server-resolved value arrives, so a deployment that never
 * customises anything sees no difference at all.
 */
export interface SchoolBrand {
  name: string;
  place: string;
  motto: string;
  logo: string;
}

export const DEFAULT_SCHOOL: SchoolBrand = SCHOOL;

let current: SchoolBrand = DEFAULT_SCHOOL;

const listeners = new Set<() => void>();

/** The school as the app currently renders it. */
export function currentSchool(): SchoolBrand {
  return current;
}

/**
 * Adopt a school identity. Idempotent — called from a layout effect on every
 * navigation — and it only fires a notification when something actually
 * changed, so a normal navigation does not re-render the shell for nothing.
 */
export function setSchool(next: SchoolBrand): void {
  if (
    next.name === current.name &&
    next.place === current.place &&
    next.motto === current.motto &&
    next.logo === current.logo
  ) {
    return;
  }
  current = next;
  for (const listener of listeners) listener();
}

/** Subscribe — the shape `useSyncExternalStore` expects. */
export function subscribeSchool(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * `PPD Keningau` + `JPN Sabah` → `Keningau, Sabah`.
 *
 * Derived rather than stored: the district and state are already columns, and
 * a separate "place" field would drift from them the first time one is edited.
 * Blank when neither is set, so the login screen hides the line instead of
 * rendering a stray comma.
 */
export function placeFrom(ppd: string | null, jpn: string | null): string {
  const strip = (s: string) => s.replace(/^(PPD|JPN)\s+/i, "").trim();
  return [ppd, jpn]
    .filter((s): s is string => Boolean(s?.trim()))
    .map(strip)
    .filter(Boolean)
    .join(", ");
}
