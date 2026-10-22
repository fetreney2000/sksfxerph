import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type CalendarAnchor,
  currentWeek,
  getCalendarAnchors,
  getCalendarLabel,
  setCalendarAnchors,
  subscribeCalendarAnchors,
  weekDeadline,
  weekExists,
  weekMondayIso,
  weekOfIso,
} from "@/lib/config";
import { schoolDays, weekOptions, weekRangeLabel } from "@/lib/date";

const MYT = 8 * 3_600_000;

/** Build an instant from a MYT calendar date + hour (no DST to worry about). */
const mytDate = (y: number, m: number, d: number, h = 12) =>
  new Date(Date.UTC(y, m - 1, d, h) - MYT);

/**
 * Declared Monday 19–23 Oct 2026 to be week 34.
 *
 * The automatic grid says week 32 (it counts 31 whole weeks from Monday 16
 * March). Everything the numbers in between no longer have dates is expected:
 * 32 and 33 are what the grid *would* have called those dates.
 */
const DECLARED: CalendarAnchor[] = [{ weekNo: 34, startDate: "2026-10-19" }];

afterEach(() => {
  // The store is module state, and every test below this file shares it.
  setCalendarAnchors([]);
});

describe("declared weeks — the pentadbir's override", () => {
  it("agrees with the automatic grid when nothing is declared", () => {
    // The whole point of the default: local mode, a fresh deployment and
    // every test that does not opt in must be byte-identical to before.
    expect(currentWeek(mytDate(2026, 10, 19))).toBe(32);
    expect(weekMondayIso(32)).toBe("2026-10-19");
    expect(getCalendarAnchors()).toEqual([]);
  });

  it("numbers the declared date as the school declared it", () => {
    setCalendarAnchors(DECLARED);
    expect(currentWeek(mytDate(2026, 10, 19))).toBe(34);
    expect(weekOfIso("2026-10-19")).toBe(34);
    // Through the store, because schoolDays()/weekRangeLabel() take a Monday
    // rather than a calendar — they reach the declaration the same way a page
    // does, which is the only way the breadcrumb and the form can agree.
    expect(schoolDays(34)).toEqual([
      "2026-10-19",
      "2026-10-20",
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
    ]);
    expect(weekRangeLabel(34)).toBe("19–23 Okt 2026");
  });

  it("cascades forward so numbering never runs backwards", () => {
    // 26 Oct is 35 and 2 Nov is 36 — the whole reason one declaration is
    // enough, and what keeps the sequence monotone across a break.
    const anchors = DECLARED;
    expect(currentWeek(mytDate(2026, 10, 26), anchors)).toBe(35);
    expect(currentWeek(mytDate(2026, 11, 2), anchors)).toBe(36);
    expect(weekMondayIso(35, anchors)).toBe("2026-10-26");
    expect(weekMondayIso(36, anchors)).toBe("2026-11-02");
  });

  it("leaves dates before the first declaration on the automatic grid", () => {
    const anchors = DECLARED;
    // Monday 12 Oct is still week 31, and a whole week earlier is 30.
    expect(currentWeek(mytDate(2026, 10, 12), anchors)).toBe(31);
    expect(currentWeek(mytDate(2026, 10, 5), anchors)).toBe(30);
    expect(weekMondayIso(31, anchors)).toBe("2026-10-12");
  });

  it("keeps Sunday and Saturday on the following Monday", () => {
    // The weekend rule is orthogonal to the declaration and must not be lost
    // by it — a teacher planning on Sunday 25 Oct plans week 35.
    const anchors = DECLARED;
    expect(currentWeek(mytDate(2026, 10, 25, 20), anchors)).toBe(35);
    expect(currentWeek(mytDate(2026, 10, 24, 9), anchors)).toBe(35);
    expect(currentWeek(mytDate(2026, 10, 18, 20), anchors)).toBe(34);
  });

  it("stays an exact inverse for every week that exists", () => {
    // The invariant calendar.test.ts enforces, re-proved under a declaration.
    const anchors = DECLARED;
    for (let w = 1; w <= 45; w++) {
      const monday = weekMondayIso(w, anchors);
      if (weekOfIso(monday, anchors) === w) {
        expect(schoolDays(w, monday)[0], `week ${w}`).toBe(monday);
        expect(weekOfIso(schoolDays(w, monday)[4] ?? "", anchors)).toBe(w);
      }
    }
  });

  it("drops the weeks whose numbers no dates belong to", () => {
    // 19 Oct is week 34 by declaration and week 32 by the grid, so 32 and 33
    // describe dates somebody else owns. Offering them would let a plan be
    // filed under a number that resolves to different dates.
    const anchors = DECLARED;
    setCalendarAnchors(anchors);
    const weeks = weekOptions().map((o) => o.week);
    expect(weeks).not.toContain(32);
    expect(weeks).not.toContain(33);
    expect(weeks).toContain(34);
    expect(weeks).toContain(31);
    // Still newest first, still no gaps in what remains.
    expect(weeks[0]).toBe(currentWeek());
    expect(weeks).toEqual([...weeks].sort((a, b) => b - a));
  });

  it("puts the deadline on the Friday of the declared week", () => {
    const anchors = DECLARED;
    const deadline = weekDeadline(34, anchors);
    const friday = new Date(deadline.getTime() + MYT);
    expect(friday.getUTCDay()).toBe(5); // Friday
    expect(friday.getUTCDate()).toBe(23); // 19 + 4
    expect(friday.getUTCHours()).toBe(16);
    // …and it is the same Friday schoolDays() calls the end of the week.
    expect(schoolDays(34, weekMondayIso(34, anchors))[4]).toBe("2026-10-23");
  });

  it("carries the administrator's name for the week only where one is set", () => {
    setCalendarAnchors([{ weekNo: 34, startDate: "2026-10-19", label: "Minggu PTS" }]);
    expect(getCalendarLabel(34)).toBe("Minggu PTS");
    expect(getCalendarLabel(35)).toBeNull();
    expect(weekOptions().find((o) => o.week === 34)?.label).toContain("Minggu PTS");
  });

  it("ignores a row that is not a date or not a week", () => {
    // A malformed row must fall back to the grid rather than take the whole
    // calendar down with it.
    setCalendarAnchors([
      { weekNo: 34, startDate: "bukan-tarikh" },
      { weekNo: 0, startDate: "2026-10-19" },
      { weekNo: 53, startDate: "2026-10-26" },
    ]);
    expect(currentWeek(mytDate(2026, 10, 19))).toBe(32);
  });

  it("refuses to number a week from anything but a Monday", () => {
    // `admin_set_calendar_week` will not write one of these. A row that arrived
    // another way has to behave as though it is not there: a non-Monday start
    // makes the 7-day step land mid-week, which is how a declared week can end
    // up missing from every picker while `currentWeek` still answers with it —
    // a number the teacher cannot choose anywhere.
    setCalendarAnchors([{ weekNo: 34, startDate: "2026-10-20" }]); // a Tuesday

    // Ignored entirely: the Monday after that date is the grid's week 33, not
    // a cascade measured from a Tuesday…
    expect(currentWeek(mytDate(2026, 10, 26))).toBe(33);
    // …so nothing is ever asked for, or told, that week 34 begins on the 20th.
    expect(weekMondayIso(34)).toBe("2026-11-02");
    // And the calendar is left coherent: the grid's own week 34 still has
    // dates, so the picker keeps it instead of showing a hole.
    expect(weekExists(34)).toBe(true);
  });

  it("keeps the current week on offer whatever has been declared", () => {
    // The one row a picker must never lose: `weekOptions()` filters to weeks
    // that exist, so a declaration that hid *this* week would leave the penyunting
    // with nothing to file a new plan under.
    setCalendarAnchors([{ weekNo: 40, startDate: schoolDays(currentWeek())[0] ?? "" }]);
    expect(weekExists(currentWeek())).toBe(true);
    expect(weekOptions().map((o) => o.week)).toContain(currentWeek());
  });
});

describe("the calendar store", () => {
  it("replaces its contents and notifies subscribers", () => {
    const listener = vi.fn();
    const stop = subscribeCalendarAnchors(listener);

    setCalendarAnchors(DECLARED);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getCalendarAnchors()).toEqual(DECLARED);

    setCalendarAnchors([]);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(getCalendarAnchors()).toEqual([]);

    stop();
    setCalendarAnchors(DECLARED);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(typeof stop).toBe("function");
  });

  it("hands back a stable snapshot so useSyncExternalStore does not loop", () => {
    setCalendarAnchors(DECLARED);
    expect(getCalendarAnchors()).toBe(getCalendarAnchors());
    // Sorted by start date whichever order they arrive in.
    setCalendarAnchors([
      { weekNo: 36, startDate: "2026-11-02" },
      { weekNo: 34, startDate: "2026-10-19" },
    ]);
    expect(getCalendarAnchors().map((a) => a.startDate)).toEqual(["2026-10-19", "2026-11-02"]);
  });
});
