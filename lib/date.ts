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

// config.ts imports nothing from this module, so there is no cycle. Having one
// calendar definition is what keeps `currentWeek()` and `schoolDays()` in sync.
import { weekMondayIso } from "@/lib/config";

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

/** Parse `yyyy-mm-dd` as midday MYT — safely inside the intended calendar day. */
function parseIso(iso: string): number {
  return new Date(`${iso}T12:00:00+08:00`).getTime();
}

export const hariName = (iso: string) => HARI[myt(parseIso(iso)).dow] ?? "";

/** 0 = Sunday … 6 = Saturday, in school-local time. */
export const weekdayIndex = (iso: string) => myt(parseIso(iso)).dow;

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

  const suffix = `${BULAN[b.month]?.slice(0, 3)} ${b.year}`;

  return `${a.date}–${b.date} ${suffix}`;
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
