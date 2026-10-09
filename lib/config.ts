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
 * ── School calendar ────────────────────────────────────────────────────────
 *
 * Term 1 of the 2026/2027 session starts **Monday 16 March 2026**; weeks run
 * Monday→Friday.
 *
 * In production these three functions are replaced by reads of the
 * `academic_calendar` table (db/schema.sql) — school-configurable dates, never
 * hard-coded. They are hard-coded here only so the local/demo build has a real
 * calendar to render, and they are written as exact inverses of each other:
 *
 *     currentWeek(d) ── schoolDays() ──▶ the Monday of that same week
 *
 * The earlier version deducted mid-term-break weeks in `currentWeek()` while
 * `schoolDays()` did not, which silently shifted every deadline a month into
 * the past. One offset, applied once, in one place — or none at all.
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
 *
 * In production these come from the `academic_calendar` table (db/schema.sql)
 * — school-configurable, never hard-coded. They are hard-coded here only so
 * the local/demo build has a real term calendar to render.
 */
const TERM_START = Date.UTC(2026, 2, 16); // Monday 16 March 2026 (token)

/** Token for the Monday of a school week. */
function mondayToken(weekNo: number): number {
  return TERM_START + (weekNo - 1) * 7 * DAY_MS;
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

/** Monday of the given school week, as `yyyy-mm-dd`. */
export const weekMondayIso = (weekNo: number): string => tokenToIso(mondayToken(weekNo));

/**
 * Current school week (1-based).
 *
 * Saturday and Sunday belong to the school week that starts the *following*
 * Monday — on a Sunday evening a teacher is planning the week ahead, so the
 * dashboard must show next week's deadline, not last week's.
 */
export function currentWeek(anchor: Date = new Date()): number {
  const dow = tokenDow(tokenFromInstant(anchor.getTime()));
  // Sun (0) → +1 day, Sat (6) → +2 days, weekdays unchanged. Lands on Monday.
  const toMonday = dow === 0 ? 1 : dow === 6 ? 2 : 0;
  const monday = tokenFromInstant(anchor.getTime()) + toMonday * DAY_MS;
  const elapsed = Math.round((monday - TERM_START) / DAY_MS);
  return Math.max(1, Math.floor(elapsed / 7) + 1);
}

/**
 * Friday 16:00 MYT of the given school week — the submission deadline.
 *
 * The only place a token becomes a real instant: a token `D` denotes the MYT
 * calendar day `D`, and 16:00 MYT on that day is `D − 8h + 16h` = `D + 8h`
 * as a UTC instant.
 */
export function weekDeadline(weekNo: number): Date {
  const friday = mondayToken(weekNo) + 4 * DAY_MS;
  return new Date(friday + MYT_OFFSET);
}
