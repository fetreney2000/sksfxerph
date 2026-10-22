/**
 * Date helpers — Asia/Kuala_Lumpur, no date library.
 *
 * MYT is UTC+8 with **no DST**, so local wall-clock time is always a fixed
 * offset from UTC. Every function here derives from that one fact rather than
 * mixing `Date#getHours()` (server-local) with `timeZone` options — that mix
 * is what produced a deadline labelled "Ahad, 27 September · 23:00".
 *
 * (erph-frontend-stack.md §9: `Intl.DateTimeFormat` covers everything we
 * need; we don't need a date library.)
 */

const MYT = 8 * 3_600_000;
const DAY_MS = 86_400_000;

/**
 * Where the school is, and how it writes.
 *
 * These are not "defaults": every date in this app is rendered for a school in
 * Kuala Lumpur, and a teacher whose laptop is set to another country must not
 * read their own documents back with someone else's clock on them. Anything
 * that formats an instant goes through `formatMyt` or the helpers below,
 * which all derive from the same fixed +8 offset.
 */
export const TIME_ZONE = "Asia/Kuala_Lumpur";
export const LOCALE = "ms-MY";

// config.ts imports nothing from this module, so there is no cycle. Having one
// calendar definition is what keeps `currentWeek()` and `schoolDays()` in sync.
import { currentWeek, getCalendarLabel, weekExists, weekMondayIso } from "@/lib/config";

const HARI = ["Ahad", "Isnin", "Selasa", "Rabu", "Khamis", "Jumaat", "Sabtu"] as const;
const BULAN = [
  "Januari",
  "Februari",
  "Mac",
  "April",
  "Mei",
  "Jun",
  "Julai",
  "Ogos",
  "September",
  "Oktober",
  "November",
  "Disember",
] as const;

/** Broken-down MYT wall-clock fields for an instant. */
function myt(ms: number) {
  const t = new Date(ms + MYT);
  return {
    year: t.getUTCFullYear(),
    month: t.getUTCMonth(), // 0-based
    date: t.getUTCDate(),
    dow: t.getUTCDay(), // 0 = Sunday
    hour: t.getUTCHours(),
    minute: t.getUTCMinutes(),
  };
}

/**
 * The school's wall-clock fields for anything instant-shaped, or `null` if it
 * is not a real instant.
 *
 * Exported for the printed stamps, whose shape (`19-01-2026 | 09:06 AM`) no
 * `Intl` option list produces — and which used `Date#getHours()`, i.e. the
 * reader's machine's zone rather than the school's.
 */
export function mytFields(value: number | string | Date): ReturnType<typeof myt> | null {
  const ms =
    value instanceof Date
      ? value.getTime()
      : typeof value === "number"
        ? value
        : Date.parse(value);
  return Number.isFinite(ms) ? myt(ms) : null;
}

/**
 * The app's one `Intl.DateTimeFormat`: Malay (Malaysia), Asia/Kuala_Lumpur.
 *
 * `timeZone` is the whole point. Without it Intl renders in the *browser's*
 * zone, so the same plan reads "9:06 pagi" at the school and "1:06 pagi" on a
 * colleague's machine set to UTC — two different documents out of one row.
 */
export function formatMyt(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(LOCALE, { timeZone: TIME_ZONE, ...options });
}

/** Which greeting the hour calls for, on the school's clock. */
export type GreetingPart = "pagi" | "tengahHari" | "petang" | "malam";

/**
 * Morning to night, in MYT: pagi 05–11, tengah hari 12–14, petang 15–18,
 * malam 19–04.
 *
 * A fixed "Selamat pagi" said the same thing to a teacher opening the app at
 * nine at night, which is the one greeting it could be sure to get wrong.
 */
export function greetingPart(now: number = Date.now()): GreetingPart {
  const h = myt(now).hour;
  if (h >= 19 || h < 5) return "malam";
  if (h < 12) return "pagi";
  if (h < 15) return "tengahHari";
  return "petang";
}

/** Parse `yyyy-mm-dd` as midday MYT — safely inside the intended calendar day. */
function parseIso(iso: string): number {
  return new Date(`${iso}T12:00:00+08:00`).getTime();
}

export const hariName = (iso: string) => HARI[myt(parseIso(iso)).dow] ?? "";

/** 0 = Sunday … 6 = Saturday, in school-local time. */
export const weekdayIndex = (iso: string) => myt(parseIso(iso)).dow;

/**
 * The day's number as the school's own form writes it.
 *
 * The paper form numbers the week **Ahad = 1**, so a Monday is `2. Isnin` —
 * 12 Januari 2026 is a Monday and the form says "2. Isnin" against it.
 * `weekdayIndex` counts from zero, which is right for a day of the week and
 * wrong for the number printed beside it: the sheets came out a day early
 * against the physical form they are filed beside.
 */
export const printedDayNumber = (iso: string) => weekdayIndex(iso) + 1;

/** '7 Okt 2026' */
export function shortDate(iso: string): string {
  const p = myt(parseIso(iso));
  return `${p.date} ${BULAN[p.month]?.slice(0, 3)} ${p.year}`;
}

/** 'Rabu, 7 Oktober 2026' */
export function longDate(iso: string): string {
  const p = myt(parseIso(iso));
  return `${HARI[p.dow]}, ${p.date} ${BULAN[p.month]} ${p.year}`;
}

/**
 * 'Rabu, 7 Oktober 2026' for an *instant* — the school's calendar day of it.
 *
 * For anything that arrives as a timestamp. Taking `.toISOString().slice(0,
 * 10)` first would use the UTC day instead, so a plan reviewed at 17:30 UTC
 * — half past one the next morning at the school — would print the wrong
 * date on a record the school has to file.
 */
export function longDateOf(value: number | string | Date): string {
  const f = mytFields(value);
  if (!f) return "—";
  const iso = `${f.year}-${String(f.month + 1).padStart(2, "0")}-${String(f.date).padStart(2, "0")}`;
  return longDate(iso);
}

/** '16:00' — 24-hour, matching KPM's own form. */
export const hhmm = (ms: number) => {
  const p = myt(ms);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
};

/** 'Isn 5 Okt · 07:30' — the dashboard table's compact cell. */
export function daySlot(iso: string, time: string): string {
  return `${hariName(iso).slice(0, 3)} ${shortDate(iso)} · ${time}`;
}

function isoFromMytMidnight(ms: number): string {
  const p = myt(ms);
  const m = String(p.month + 1).padStart(2, "0");
  const d = String(p.date).padStart(2, "0");
  return `${p.year}-${m}-${d}`;
}

/** The five school days (Mon–Fri) of a week, as `yyyy-mm-dd`. */
export function schoolDays(weekNo: number, mondayIso?: string): string[] {
  const monday = mondayIso ? parseIso(mondayIso) : parseIso(weekMondayIso(weekNo));
  return Array.from({ length: 5 }, (_, i) => isoFromMytMidnight(monday + i * DAY_MS));
}

export const todayIso = (): string => isoFromMytMidnight(Date.now());

/** '5–9 Okt 2026' — week range label for the breadcrumb. */
export function weekRangeLabel(weekNo: number, mondayIso?: string): string {
  const days = schoolDays(weekNo, mondayIso);
  const first = days[0];
  const last = days[4];
  if (!first || !last) return `Minggu ${weekNo}`;

  const a = myt(parseIso(first));
  const b = myt(parseIso(last));

  // Both months when the week crosses one. It used to print only the ending
  // month, so the week before a term break read "30–4 Dis 2026" — two numbers
  // and one month, on the header of the statutory sheet.
  if (a.month === b.month && a.year === b.year) {
    return `${a.date}–${b.date} ${BULAN[b.month]?.slice(0, 3)} ${b.year}`;
  }
  return `${a.date} ${BULAN[a.month]?.slice(0, 3)}–${b.date} ${BULAN[b.month]?.slice(0, 3)} ${b.year}`;
}

/**
 * The weeks a plan may be filed under: every week of the session that has
 * started, newest first.
 *
 * The week is a choice because back-filling is a real thing a teacher owes. A
 * week missed to illness still had lessons, and until now a plan could only be
 * born into whatever week the penyunting happened to be opened in — there was
 * no way to write Monday's RPH on Thursday of the following week, and the gap
 * simply stayed a gap.
 *
 * The future is not offered. An RPH is a plan for a lesson that has a date and
 * a class, and a week the school has not reached has neither; offering it
 * would let a plan be counted towards a week that has not happened.
 *
 * A week also only appears if it **round-trips**: `weekOfIso(weekMondayIso(w))`
 * has to give `w` back. When an administrator declares a week by hand the grid
 * and the declaration disagree in between — automatic numbering calls 19 Oct
 * week 33 while the declaration says 34 — and the number in the gap has no
 * dates belonging to it. Offering it would let a plan be filed for a week that
 * resolves to somebody else's dates.
 */
export function weekOptions(): {
  week: number;
  monday: string;
  friday: string;
  label: string;
}[] {
  const now = currentWeek();
  return Array.from({ length: now }, (_, i) => now - i)
    .filter((week) => weekExists(week))
    .map((week) => {
      const days = schoolDays(week);
      const named = getCalendarLabel(week);
      return {
        week,
        monday: days[0] ?? weekMondayIso(week),
        friday: days[4] ?? days[0] ?? weekMondayIso(week),
        label: `M${week} · ${weekRangeLabel(week)}${named ? ` · ${named}` : ""}`,
      };
    });
}

/**
 * 'Jumaat, 9 Oktober 2026 · 16:00'
 *
 * Takes a Date produced by `weekDeadline()` (or anything else) and renders it
 * entirely from MYT wall-clock parts — no server-local `getFullYear()`, no
 * locale database dependency.
 */
export function deadlineLabel(deadline: Date): string {
  const p = myt(deadline.getTime());
  const iso = `${p.year}-${String(p.month + 1).padStart(2, "0")}-${String(p.date).padStart(2, "0")}`;
  return `${longDate(iso)} · ${hhmm(deadline.getTime())}`;
}
