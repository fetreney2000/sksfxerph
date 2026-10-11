import type { NextRequest } from "next/server";
import { currentWeek } from "@/lib/config";

/**
 * The week window a request asks about.
 *
 * `/api/stats` and `/api/pantau/teachers` both describe a range rather than a
 * single week, because the page's filter widens it — and the roster has to
 * cover the same weeks as the cards above it, or a supervisor reads a total
 * beside a table that disagrees with it.
 *
 * Defaults to the current week, so a caller that says nothing gets the figure
 * it always did.
 *
 * Clamped rather than validated. A first week of 0, or a last before the
 * first, is a malformed request and not an attack: answering with a sane
 * window beats a 400 that the UI has no way to produce.
 *
 * `fallback` is what an absent pair means. `/api/stats` asks for the last six
 * weeks — what its chart drew before the filter existed — while the roster
 * asks for the current week, which is what it always showed.
 */
export function parseRange(
  request: NextRequest,
  fallback?: { first: number; last: number },
): { first: number; last: number } {
  const now = currentWeek();
  const num = (key: string): number | undefined => {
    const raw = request.nextUrl.searchParams.get(key);
    const n = raw === null ? Number.NaN : Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : undefined;
  };

  const last = Math.max(1, num("last") ?? fallback?.last ?? now);
  const first = Math.min(Math.max(1, num("first") ?? fallback?.first ?? last), last);
  return { first, last };
}
