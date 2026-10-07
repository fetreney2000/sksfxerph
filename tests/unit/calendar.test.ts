import { describe, expect, it } from "vitest";
import { currentWeek, SESSION, weekDeadline, weekMondayIso } from "@/lib/config";
import { deadlineLabel, longDate, schoolDays, weekdayIndex, weekRangeLabel } from "@/lib/date";

const MYT = 8 * 3_600_000;
const DAY = 86_400_000;

/** Build an instant from a MYT calendar date + hour (no DST to worry about). */
const mytDate = (y: number, m: number, d: number, h = 12) =>
  new Date(Date.UTC(y, m - 1, d, h) - MYT);

describe("school calendar — one definition, used everywhere", () => {
  it("term 1 starts Monday 16 March 2026 → week 1", () => {
    expect(weekMondayIso(1)).toBe("2026-03-16");
    expect(currentWeek(mytDate(2026, 3, 16))).toBe(1);
  });

  it("a weekday maps to the week containing it (currentWeek ∘ inverse)", () => {
    // Any weekday: the Monday of currentWeek(d) must be on-or-before d,
    // and d must fall within the five school days.
    for (const [m, d] of [
      [3, 20],
      [5, 13],
      [7, 1],
      [9, 15],
      [10, 5],
    ] as [number, number][]) {
      const anchor = mytDate(2026, m, d);
      const w = currentWeek(anchor);
      const days = schoolDays(w);
      const iso = `${2026}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      expect(days, `week of 2026-${m}-${d}`).toContain(iso);
    }
  });

  it("weekend belongs to the week starting the following Monday", () => {
    // Sunday 4 Oct 2026 → planning the week of Mon 5 Oct.
    const sun = mytDate(2026, 10, 4, 20);
    const days = schoolDays(currentWeek(sun));
    expect(days[0]).toBe("2026-10-05");
    expect(days[4]).toBe("2026-10-09");

    // Saturday 3 Oct → same Monday.
    const sat = mytDate(2026, 10, 3, 9);
    expect(schoolDays(currentWeek(sat))[0]).toBe("2026-10-05");
  });

  it("schoolDays returns exactly Monday→Friday", () => {
    const days = schoolDays(30);
    expect(days).toHaveLength(5);
    expect(days.map(weekdayIndex)).toEqual([1, 2, 3, 4, 5]);
    // consecutive calendar days
    for (let i = 1; i < days.length; i++) {
      const prev = Date.parse(`${days[i - 1]}T12:00:00+08:00`);
      expect(Date.parse(`${days[i]}T12:00:00+08:00`)).toBe(prev + DAY);
    }
  });
});

describe("weekDeadline — Friday 16:00 MYT, inside the same school week", () => {
  it("falls on a Friday", () => {
    for (const w of [1, 10, 30, 40]) {
      expect(weekdayIndex(toIso(weekDeadline(w)))).toBe(5);
    }
  });

  it("is 16:00 in Asia/Kuala_Lumpur", () => {
    const d = weekDeadline(30);
    // 16:00 MYT = 08:00 UTC
    expect(d.getUTCHours()).toBe(8);
    expect(d.getUTCMinutes()).toBe(0);
    expect(deadlineLabel(d)).toContain("16:00");
  });

  it("is the Friday of that same week, not a month away", () => {
    // Regression: the old implementation added `4 * WEEK_MS` instead of
    // `4 * DAY_MS`, pushing every deadline ~4 weeks into the future (and the
    // broken currentWeek() pushed it back again → "27 September").
    const w = currentWeek(mytDate(2026, 10, 5, 9)); // Monday of the demo week
    const deadline = weekDeadline(w);
    const days = schoolDays(w);
    expect(toIso(deadline)).toBe(days[4]); // Friday of that week
    expect(toIso(deadline)).toBe("2026-10-09");
  });

  it("renders in Malay as a Friday deadline", () => {
    const w = currentWeek(mytDate(2026, 10, 5, 9));
    expect(deadlineLabel(weekDeadline(w))).toBe("Jumaat, 9 Oktober 2026 · 16:00");
  });
});

describe("labels", () => {
  it("week range covers the school week", () => {
    expect(weekRangeLabel(30)).toBe("5–9 Okt 2026");
    expect(weekRangeLabel(1)).toBe("16–20 Mac 2026");
  });

  it("longDate names the weekday correctly in Malay", () => {
    expect(longDate("2026-10-07")).toBe("Rabu, 7 Oktober 2026");
    expect(longDate("2026-10-09")).toBe("Jumaat, 9 Oktober 2026");
  });

  it("session is the expected format", () => {
    expect(SESSION).toMatch(/^\d{4}\/\d{4}$/);
  });
});

function toIso(d: Date): string {
  const t = new Date(d.getTime() + MYT);
  const m = String(t.getUTCMonth() + 1).padStart(2, "0");
  const day = String(t.getUTCDate()).padStart(2, "0");
  return `${t.getUTCFullYear()}-${m}-${day}`;
}
