/**
 * Runtime configuration.
 *
 * The app has two modes and the difference is deliberately invisible to the UI:
 *
 *   local-only  – NEXT_PUBLIC_SUPABASE_URL unset. Everything lives in IndexedDB.
 *                 Deployable, demoable, and useful on a school laptop with no
 *                 network. Nothing breaks; the sync chip just stays local.
 *   synced      – Supabase configured. Same code, plus /api/sync pushing to
 *                 the `sync_rph` RPC.
 *
 * This is what makes the free tier safe: the product never *depends* on the
 * remote being reachable (backend §2.2 — a paused free project would otherwise
 * be a Monday-morning outage for the whole school).
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabaseConfigured =
  typeof url === "string" &&
  url.length > 0 &&
  typeof anonKey === "string" &&
  anonKey.length > 0;

/**
 * The school code this deployment was *built* with.
 *
 * A label, not a key — and it is worth being explicit about why, because it
 * looks like it should be an identifier. Nothing joins on it: every table
 * references `school(id)`, `schoolIdFor()` walks `school_member`, `sync_rph`
 * derives the school from `class_id`, and `resolveSchool()` reads the active
 * row rather than matching this string. That is exactly what lets an
 * administrator change `kod_sekolah` from /pentadbiran without editing `.env`
 * and redeploying.
 *
 * What it still does: the local-mode value (no database to read one from) and
 * a cache key, where any stable string will do.
 */
export const schoolCode = process.env.NEXT_PUBLIC_SCHOOL_CODE ?? "SK0000";

/**
 * Google sign-in — opt-in, and entirely optional.
 *
 * All four are `NEXT_PUBLIC_` because the button has to be rendered by the
 * browser; none of them is a secret. `GOOGLE_CLIENT_SECRET` is not in this
 * file at all — it exists only in `.env` and is read by `/api/auth/google`.
 *
 * Unset, and nothing is rendered: no button, no script, no request. That is
 * the local-mode story too, where there is no network to reach Google with —
 * password login stays the only route, exactly as it is today.
 */
export const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";

/** The Workspace domain teachers' accounts live on. `moe-dl.edu.my` for KPM. */
export const googleDomain = process.env.NEXT_PUBLIC_GOOGLE_DOMAIN ?? "moe-dl.edu.my";

export const googleAuthConfigured = googleClientId.length > 0;

/**
 * The school this deployment belongs to.
 *
 * One constant rather than a string in six files: the crest is the login
 * screen, the sidebar and the browser tab, and the name has to match what
 * prints on the RPH itself — or a teacher signs into one school and hands in
 * a document for another.
 */
export const SCHOOL = {
  name: "SK St. Francis Xavier",
  place: "Keningau, Sabah",
  motto: "Bersatu Kita Teguh",
  logo: "/logo.png",
} as const;

/** School session + week — single source of truth for the whole UI. */
export const SESSION = "2026/2027";

/**
 * The account local mode's demo plans are filed under — `cikgu`, the demo
 * Guru Besar in `lib/server/auth/local.ts`.
 *
 * One constant, here rather than beside the seed, because it is also the
 * fallback for "whose plans this browser is holding" (lib/owner.ts) and the
 * id on the demo account itself. A second copy of a uuid is a third opinion.
 */
export const DEMO_OWNER_ID = "00000000-0000-4000-8000-000000000001";

/**
 * ── School calendar ────────────────────────────────────────────────────────
 *
 * Term 1 of the 2026/2027 session starts **Monday 16 March 2026**; weeks run
 * Monday→Friday.
 *
 * `TERM_START` is the *fallback* — what the app says when the school has not
 * told it otherwise, which is every case in local mode and the default on a
 * fresh deployment. An administrator may declare the truth instead by writing
 * `academic_calendar` rows (db/schema.sql:381) from the Kalendar minggu tab,
 * and the functions below read them from `setCalendarAnchors()`.
 *
 * An anchor **cascades forward**: declaring 19–23 Oct to be week 34 makes
 * 26 Oct week 35 and 2 Nov week 36, so numbering stays non-decreasing with
 * date across a break and only the first week that moved has to be corrected.
 * Dates before the first anchor keep the automatic assignment.
 *
 * They are still written as exact inverses of each other:
 *
 *     currentWeek(d) ── schoolDays() ──▶ the Monday of that same week
 *
 * The earlier version deducted mid-term-break weeks in `currentWeek()` while
 * `schoolDays()` did not, which silently shifted every deadline a month into
 * the past. One offset, applied once, in one place — or none at all.
 *
 * With an empty anchor list every one of these functions returns exactly what
 * it always has, which is what keeps local mode and the calendar unit tests
 * byte-identical.
 */
const DAY_MS = 86_400_000;
const MYT_OFFSET = 8 * 3_600_000; // Asia/Kuala_Lumpur is UTC+8 with no DST

/**
 * ── Calendar-day tokens ────────────────────────────────────────────────────
 *
 * Every date here is a **token**: `Date.UTC(y, m, d)` — a plain calendar day
 * at 00:00 UTC with no meaning as an instant. Day arithmetic happens only on
 * tokens; exactly one function (`weekDeadline`) converts a token into a real
 * instant for display.
 *
 * This matters because the previous version mixed epochs: `TERM_START` was at
 * UTC midnight while week dates were derived at *MYT* midnight (16:00 UTC the
 * day before). The 16-hour difference made `currentWeek()` and `schoolDays()`
 * disagree by one day, which compounded into every deadline landing in the
 * wrong month. One epoch, no exceptions.
 */
const TERM_START = Date.UTC(2026, 2, 16); // Monday 16 March 2026 (token)

/** Token for the Monday of a school week, by the automatic assignment. */
function mondayToken(weekNo: number): number {
  return TERM_START + (weekNo - 1) * 7 * DAY_MS;
}

/**
 * A week the administrator has declared by hand.
 *
 * Mirrors one `academic_calendar` row so the client can hold the same thing
 * the table holds without knowing anything about Postgres.
 */
export interface CalendarAnchor {
  /** The week number this Monday belongs to. */
  weekNo: number;
  /** `yyyy-mm-dd`, and always a Monday — `admin_set_calendar_week` refuses otherwise. */
  startDate: string;
  /** Optional printed name, e.g. `Minggu PTS`. */
  label?: string | null;
}

interface ResolvedAnchor {
  weekNo: number;
  startToken: number;
  label: string | null;
}

const EMPTY_ANCHORS: readonly CalendarAnchor[] = [];

/** `yyyy-mm-dd` → token, or NaN when it is not a date. */
function tokenOfIso(iso: string): number {
  const n = Date.parse(`${iso}T00:00:00Z`);
  return Number.isFinite(n) ? n : Number.NaN;
}

/** Parsed view of an anchor list, memoised by array identity. */
const parsedCache = new WeakMap<readonly CalendarAnchor[], ResolvedAnchor[]>();

function parseAnchors(rows: readonly CalendarAnchor[]): ResolvedAnchor[] {
  const hit = parsedCache.get(rows);
  if (hit) return hit;
  const parsed = rows
    .map((r) => ({
      weekNo: r.weekNo,
      startToken: tokenOfIso(r.startDate),
      label: r.label ?? null,
    }))
    .filter(
      (r) =>
        Number.isFinite(r.startToken) &&
        // A Monday, or the whole 7-day step is measured from the wrong day and
        // `weekExists` reports the declared week as having no dates at all —
        // it disappears from every picker while `currentWeek` can still return
        // it. `admin_set_calendar_week` refuses a Tuesday at the door; this is
        // for a row that arrived some other way.
        tokenDow(r.startToken) === 1 &&
        r.weekNo >= 1 &&
        r.weekNo <= 52,
    )
    .sort((a, b) => a.startToken - b.startToken);
  parsedCache.set(rows, parsed);
  return parsed;
}

/** The anchor with the latest Monday on or before `monday`, if any. */
function anchorForToken(
  rows: readonly ResolvedAnchor[],
  monday: number,
): ResolvedAnchor | undefined {
  let best: ResolvedAnchor | undefined;
  for (const a of rows)
    if (a.startToken <= monday && (!best || a.startToken > best.startToken)) best = a;
  return best;
}

/** The anchor with the largest week number at or below `weekNo`, if any. */
function anchorForWeek(
  rows: readonly ResolvedAnchor[],
  weekNo: number,
): ResolvedAnchor | undefined {
  let best: ResolvedAnchor | undefined;
  for (const a of rows) if (a.weekNo <= weekNo && (!best || a.weekNo > best.weekNo)) best = a;
  return best;
}

const listeners = new Set<() => void>();
let SNAPSHOT: readonly CalendarAnchor[] = EMPTY_ANCHORS;

/**
 * Whether the calendar has been fetched at all — deliberately separate from
 * "the list is empty".
 *
 * Both a school that has declared nothing and a browser that has not asked yet
 * have zero anchors, and the penyunting needs to tell them apart: it stamps the
 * week a new plan files under, and doing that before the answer arrived would
 * file it on the term-start grid whatever the school had declared.
 */
let loaded = false;

function notify(): void {
  for (const listener of [...listeners]) listener();
}

/**
 * Replace the school's declared weeks — and mark the calendar as fetched.
 *
 * One call, so no caller can remember half of it. `[]` is a complete and normal
 * answer: local mode, a fresh deployment, and every unit test that does not opt
 * in.
 */
export function setCalendarAnchors(rows: readonly CalendarAnchor[]): void {
  SNAPSHOT = Object.freeze(
    rows
      .slice()
      .sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0)),
  );
  loaded = true;
  notify();
}

/** False until the first `setCalendarAnchors` — i.e. until someone has asked. */
export function isCalendarLoaded(): boolean {
  return loaded;
}

/** The current anchors — the `getSnapshot` for `subscribeCalendarAnchors`. */
export function getCalendarAnchors(): readonly CalendarAnchor[] {
  return SNAPSHOT;
}

/** Subscribe to anchor changes (`useSyncExternalStore`). Returns its unsubscribe. */
export function subscribeCalendarAnchors(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The administrator's name for a week — `Minggu PTS` — or null.
 *
 * Null for a week nobody declared *and* for one declared without a name, so a
 * reader never prints an empty separator.
 */
export function getCalendarLabel(
  weekNo: number,
  anchors: readonly CalendarAnchor[] = SNAPSHOT,
): string | null {
  const rows = parseAnchors(anchors);
  const hit = anchorForWeek(rows, weekNo);
  return hit && hit.weekNo === weekNo ? hit.label : null;
}

/** Token for the MYT calendar day containing a real instant. */
function tokenFromInstant(ms: number): number {
  const t = new Date(ms + MYT_OFFSET);
  return Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate());
}

/** Day-of-week of a token (0 = Sunday … 6 = Saturday). */
const tokenDow = (token: number) => new Date(token).getUTCDay();

/** `yyyy-mm-dd` for a token. */
function tokenToIso(token: number): string {
  const t = new Date(token);
  const m = String(t.getUTCMonth() + 1).padStart(2, "0");
  const d = String(t.getUTCDate()).padStart(2, "0");
  return `${t.getUTCFullYear()}-${m}-${d}`;
}

/** `yyyy-mm-dd` for the MYT calendar day containing `ms`. */
export const mytIso = (ms: number = Date.now()): string => tokenToIso(tokenFromInstant(ms));

/** Token for the Monday of a school week, honouring any declared weeks. */
function weekMondayToken(weekNo: number, anchors: readonly CalendarAnchor[]): number {
  const hit = anchorForWeek(parseAnchors(anchors), weekNo);
  // Cascade backwards: the nearest declared week at or below this one owns it,
  // stepped forward by whole weeks. Before the first declaration, the grid.
  if (hit) return hit.startToken + (weekNo - hit.weekNo) * 7 * DAY_MS;
  return mondayToken(weekNo);
}

/** Monday of the given school week, as `yyyy-mm-dd`. */
export function weekMondayIso(
  weekNo: number,
  anchors: readonly CalendarAnchor[] = SNAPSHOT,
): string {
  return tokenToIso(weekMondayToken(weekNo, anchors));
}

/**
 * The school week containing a `yyyy-mm-dd` day — the other half of the pair.
 *
 * Needed the moment the week became a choice: a teacher who back-dates a plan
 * to last Tuesday must have it filed under last Tuesday's week, or the printed
 * page and the week its numbers land in disagree. Same rule as `currentWeek`,
 * so a Sunday belongs to the week that starts the following Monday.
 */
export function weekOfIso(iso: string, anchors: readonly CalendarAnchor[] = SNAPSHOT): number {
  const token = tokenOfIso(iso);
  return Number.isFinite(token)
    ? currentWeek(new Date(token), anchors)
    : currentWeek(undefined, anchors);
}

/**
 * Whether this week number has dates that belong to it.
 *
 * A declaration leaves numbers behind that nobody owns. The grid calls 19
 * October week 32 and the school's declaration calls it week 34, so weeks 32
 * and 33 describe dates that resolve to a *different* week — offering one would
 * file a plan whose `week_no` and `plan_date` disagree, which is exactly the
 * thing `weekOfIso` and `currentWeek` exist to keep apart.
 *
 * One predicate, used by the week picker and the archive: two lists built from
 * two opinions about which weeks exist would drift the moment they were edited
 * apart.
 */
export function weekExists(
  weekNo: number,
  anchors: readonly CalendarAnchor[] = SNAPSHOT,
): boolean {
  return weekOfIso(weekMondayIso(weekNo, anchors), anchors) === weekNo;
}

/**
 * Current school week (1-based).
 *
 * Saturday and Sunday belong to the school week that starts the *following*
 * Monday — on a Sunday evening a teacher is planning the week ahead, so the
 * dashboard must show next week's deadline, not last week's.
 *
 * The second argument defaults to the loaded calendar, which is why the ~18
 * call sites that just ask "what week is it" need no change; the server passes
 * it explicitly instead of sharing this module's state between requests.
 */
export function currentWeek(
  anchor: Date = new Date(),
  anchors: readonly CalendarAnchor[] = SNAPSHOT,
): number {
  const instant = tokenFromInstant(anchor.getTime());
  const dow = tokenDow(instant);
  // Sun (0) → +1 day, Sat (6) → +2 days, weekdays unchanged. Lands on Monday.
  const toMonday = dow === 0 ? 1 : dow === 6 ? 2 : 0;
  const monday = instant + toMonday * DAY_MS;

  const hit = anchorForToken(parseAnchors(anchors), monday);
  if (hit) {
    // Both endpoints are Mondays, so the difference is whole weeks — this is
    // the forward cascade, the same arithmetic `weekMondayToken` runs backwards.
    const weeks = Math.floor((monday - hit.startToken) / (7 * DAY_MS));
    return Math.max(1, hit.weekNo + weeks);
  }

  const elapsed = Math.round((monday - TERM_START) / DAY_MS);
  return Math.max(1, Math.floor(elapsed / 7) + 1);
}

/**
 * Friday 16:00 MYT of the given school week — the submission deadline.
 *
 * The only place a token becomes a real instant: a token `D` denotes the MYT
 * calendar day `D`, and 16:00 MYT on that day is `D − 8h + 16h` = `D + 8h`
 * as a UTC instant.
 *
 * Deliberately derived from `weekMondayToken`, not the raw grid — a deadline
 * that used the automatic Monday while the dashboard showed the declared one
 * would put every due date a fortnight away, which is the bug this calendar
 * has had once already.
 */
export function weekDeadline(
  weekNo: number,
  anchors: readonly CalendarAnchor[] = SNAPSHOT,
): Date {
  const friday = weekMondayToken(weekNo, anchors) + 4 * DAY_MS;
  return new Date(friday + MYT_OFFSET);
}
