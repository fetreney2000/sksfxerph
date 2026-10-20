import { describe, expect, it } from "vitest";
import { summariseWeek, type WeekDocument } from "@/lib/week-summary";

const DEADLINE = 1_000;

const plan = (status: WeekDocument["status"], submittedAt?: number): WeekDocument => ({
  status,
  submittedAt,
});

describe("summariseWeek — one definition of the week", () => {
  it("returns a real empty week rather than division by zero", () => {
    expect(summariseWeek([], DEADLINE)).toEqual({
      total: 0,
      approved: 0,
      waiting: 0,
      returned: 0,
      drafts: 0,
      action: 0,
      handedIn: 0,
      onTimeCount: 0,
      onTimePct: null,
      approvedPct: 0,
    });
  });

  it("partitions the demo week into approved + waiting + action", () => {
    // 2 approved, 1 waiting, 1 returned, 1 draft — the week shown on the
    // dashboard. The cards used to show "Dihantar 1/5" while the bar under it
    // was 40% approved, and "Menunggu semakan" repeated the same 1.
    const summary = summariseWeek(
      [
        plan("approved", 900),
        plan("approved", 900),
        plan("submitted", 900),
        plan("returned", 900),
        plan("draft"),
      ],
      DEADLINE,
    );

    expect(summary.approved).toBe(2);
    expect(summary.waiting).toBe(1);
    expect(summary.returned).toBe(1);
    expect(summary.drafts).toBe(1);
    expect(summary.action).toBe(2);
    expect(summary.approvedPct).toBe(40);
    expect(summary.approved + summary.waiting + summary.action).toBe(summary.total);
  });

  it("counts a returned plan as both handed in and still needing action", () => {
    const summary = summariseWeek([plan("returned", 900)], DEADLINE);

    expect(summary.action).toBe(1);
    expect(summary.handedIn).toBe(1);
    expect(summary.onTimePct).toBe(100);
  });

  it("treats a legacy forwarded plan as waiting, not approved", () => {
    const summary = summariseWeek(
      [plan("forwarded", 900), plan("submitted", 900), plan("approved", 900)],
      DEADLINE,
    );

    expect(summary.waiting).toBe(2);
    expect(summary.approved).toBe(1);
  });

  it("computes punctuality only over handed-in plans and shows the denominator", () => {
    const summary = summariseWeek(
      [
        plan("approved", 900), // on time
        plan("submitted", 1_100), // late
        plan("returned", 900), // on time
        plan("draft"), // not handed in
      ],
      DEADLINE,
    );

    expect(summary.handedIn).toBe(3);
    expect(summary.onTimeCount).toBe(2);
    expect(summary.onTimePct).toBe(67);
  });

  it("distinguishes 'all late' from 'nothing handed in'", () => {
    expect(summariseWeek([plan("submitted", 2_000)], DEADLINE).onTimePct).toBe(0);
    expect(summariseWeek([plan("draft")], DEADLINE).onTimePct).toBeNull();
  });

  it("counts a submittedAt of 0 as handed in", () => {
    expect(summariseWeek([plan("submitted", 0)], DEADLINE).handedIn).toBe(1);
  });
});
