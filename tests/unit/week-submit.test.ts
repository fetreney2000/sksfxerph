import { describe, expect, it } from "vitest";
import { completeness, emptyPayload, type RphPayload } from "@/lib/schemas/rph";
import { missingRequirements } from "@/lib/week-submit";

const complete = (): RphPayload => ({
  ...emptyPayload(),
  standard_kandungan: "SK",
  standard_pembelajaran: "SP",
  objektif: "O",
  kriteria_kejayaan: "K",
  aktiviti: [{ nama: "Aktiviti", sub: false }],
  refleksi: "R",
});

describe("bulk submission requirements", () => {
  it("names every missing section of an empty plan", () => {
    expect(missingRequirements(emptyPayload())).toEqual([
      "Standard Kandungan dan Standard Pembelajaran",
      "Objektif dan Kriteria Kejayaan",
      "sekurang-kurangnya satu Aktiviti PdPC",
      "Refleksi",
    ]);
  });

  it("names only what a partially filled plan still lacks", () => {
    expect(
      missingRequirements({
        ...emptyPayload(),
        standard_kandungan: "SK",
        standard_pembelajaran: "SP",
        objektif: "O",
        kriteria_kejayaan: "K",
        aktiviti: [{ nama: "A", sub: false }],
      }),
    ).toEqual(["Refleksi"]);
  });

  it("agrees with completeness: no missing section means 100%", () => {
    expect(missingRequirements(complete())).toEqual([]);
    expect(completeness(complete())).toBe(100);
    expect(missingRequirements(emptyPayload()).length).toBeGreaterThan(0);
    expect(completeness(emptyPayload())).toBeLessThan(100);
  });
});
