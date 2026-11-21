import { describe, expect, it } from "vitest";
import { isPastReviewWeek } from "@/lib/review-week";

describe("review week in Malaysia", () => {
  it("allows only weeks before the current Monday", () => {
    const now = new Date("2026-11-18T04:00:00Z");
    expect(isPastReviewWeek("2026-11-15", now)).toBe(true);
    expect(isPastReviewWeek("2026-11-16", now)).toBe(false);
    expect(isPastReviewWeek("2026-11-23", now)).toBe(false);
  });
  it("uses Malaysian midnight rather than UTC midnight", () => {
    const now = new Date("2026-11-15T16:00:00Z");
    expect(isPastReviewWeek("2026-11-15", now)).toBe(true);
    expect(isPastReviewWeek("2026-11-16", now)).toBe(false);
  });
  it("rejects malformed dates", () => {
    expect(isPastReviewWeek("bad")).toBe(false);
  });
});
