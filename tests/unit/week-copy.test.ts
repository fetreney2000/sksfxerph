import { describe, expect, it } from "vitest";
import { schoolDays } from "@/lib/date";
import { emptyPayload } from "@/lib/schemas/rph";
import type { RphDocument, SchoolClass } from "@/lib/types";
import { buildWeekCopyCandidates, clearedReflection, planDateInWeek } from "@/lib/week-copy";

const CLASS_A: SchoolClass = { id: "c-a", nama: "5 Amanah", session: "2026/2027" };
const SOURCE = schoolDays(9);
const DESTINATION = schoolDays(10);

function addDay(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

function plan(over: Partial<RphDocument> = {}): RphDocument {
  return {
    id: "p-1",
    schoolCode: "SK",
    ownerId: "teacher",
    classIds: [CLASS_A.id],
    classNames: [CLASS_A.nama],
    subjectCode: "MAT",
    subjectName: "Matematik",
    session: "2026/2027",
    weekNo: 9,
    planDate: SOURCE[0] ?? "",
    slotTime: "07:30",
    slotTimeEnd: "08:30",
    status: "approved",
    payload: { ...emptyPayload(), objektif: "Objektif", refleksi: "Refleksi lama" },
    version: 2,
    clientUpdatedAt: 0,
    createdAt: 0,
    ...over,
  };
}

describe("week copy", () => {
  it("clears the previous lesson's reflection and keeps the rest", () => {
    const payload = clearedReflection({ ...emptyPayload(), objektif: "O", refleksi: "R" });
    expect(payload.refleksi).toBe("");
    expect(payload.objektif).toBe("O");
  });

  it("maps a date to the same weekday in the destination week", () => {
    expect(planDateInWeek(SOURCE[0] ?? "", 9, 10)).toBe(DESTINATION[0]);
    expect(planDateInWeek(SOURCE[2] ?? "", 9, 10)).toBe(DESTINATION[2]);
  });

  it("falls back to Monday for a date that is not a school day", () => {
    const saturday = addDay(SOURCE[4] ?? "", 1);
    expect(planDateInWeek(saturday, 9, 10)).toBe(DESTINATION[0]);
  });

  it("creates a draft-shaped candidate with week and date remapped", () => {
    const [candidate] = buildWeekCopyCandidates([plan()], [], 10, [CLASS_A]);
    expect(candidate?.planDate).toBe(DESTINATION[0]);
    expect(candidate?.weekNo).toBe(10);
    expect(candidate?.payload.refleksi).toBe("");
    expect(candidate?.blocked).toBe(false);
  });

  it("reports a clash with a plan already in the destination week", () => {
    const existing = plan({ id: "p-2", weekNo: 10, planDate: DESTINATION[0] ?? "" });
    const [candidate] = buildWeekCopyCandidates([plan()], [existing], 10, [CLASS_A]);
    expect(candidate?.blocked).toBe(true);
    expect(candidate?.conflicts.join(" ")).toContain("Bertindih dengan RPH sedia ada");
  });

  it("reports a clash between two plans in the same copy", () => {
    const second = plan({ id: "p-2", planDate: SOURCE[0] ?? "" });
    const candidates = buildWeekCopyCandidates([plan(), second], [], 10, [CLASS_A]);
    expect(candidates[0]?.blocked).toBe(false);
    expect(candidates[1]?.blocked).toBe(true);
    expect(candidates[1]?.conflicts.join(" ")).toContain("dalam salinan ini");
  });

  it("warns about a class that is no longer active", () => {
    const [candidate] = buildWeekCopyCandidates([plan()], [], 10, []);
    expect(candidate?.blocked).toBe(true);
    expect(candidate?.conflicts.join(" ")).toContain("Kelas tidak lagi aktif");
    expect(candidate?.conflicts.join(" ")).toContain("Tiada kelas aktif");
  });
});
