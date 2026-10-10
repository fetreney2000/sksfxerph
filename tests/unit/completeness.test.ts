import { describe, expect, it } from "vitest";
import {
  completeness,
  emptyPayload,
  isComplete,
  type RphPayload,
  stepStatus,
} from "@/lib/schemas/rph";

/**
 * These fixtures are the contract with the database.
 *
 * `completeness()` must agree with `rph_completeness()` in db/schema.sql —
 * the client shows the teacher a meter, the server gates submission on the
 * same number, and a disagreement would mean the editor promises something
 * `submit_rph()` then refuses.
 *
 * The four checks are the four rows the school's printed form cannot be issued
 * without, and they were redefined along with the template: Kriteria Kejayaan
 * is scored, and EMK / KBAT / Intervensi — not on the printed form at all —
 * no longer are.
 */
const payload = (over: Partial<RphPayload>): RphPayload => ({
  ...emptyPayload(),
  ...over,
});

/** Checkpoint 1 — the two DSKP rows, and nothing else. */
const DSKP = {
  standard_kandungan: "3.1 Menulis semula nombor hingga 100,000",
  standard_pembelajaran: "3.1.1 Menulis semula nombor hingga 100,000",
};

/** Checkpoint 2 — Objektif *and* Kriteria Kejayaan, together. */
const OBJEKTIF = {
  objektif: "Murid dapat menulis semula nombor hingga 100,000.",
  kriteria_kejayaan: "Murid menulis semula nombor dengan betul.",
};

/** Checkpoint 3 — at least one activity carrying a name. */
const AKTIVITI = { aktiviti: [{ nama: "Set induksi kad nilai tempat" }] };

/** Checkpoint 4. */
const REFLEKSI = { refleksi: "7 daripada 28 murid keliru nilai puluhan." };

const FULL = { ...DSKP, ...OBJEKTIF, ...AKTIVITI, ...REFLEKSI };

describe("completeness — four 25-point checks", () => {
  it("empty payload scores 0 (all four SQL conditions false)", () => {
    expect(completeness(emptyPayload())).toBe(0);
  });

  it("the two DSKP rows alone → 25", () => {
    expect(completeness(payload(DSKP))).toBe(25);
  });

  it("objektif without Kriteria Kejayaan does not score", () => {
    // The printed form has a Kriteria Kejayaan row. A plan without it is
    // incomplete however good the objektif is — SQL checks both.
    expect(
      completeness(
        payload({
          ...DSKP,
          objektif: "Murid dapat…",
          kriteria_kejayaan: "   ",
        }),
      ),
    ).toBe(25);
  });

  it("all three filled → 75", () => {
    expect(completeness(payload({ ...DSKP, ...OBJEKTIF, ...AKTIVITI }))).toBe(75);
  });

  it("an activity with a blank name does not score", () => {
    // SQL asks whether *any* element carries a `nama`, not whether the first
    // does — an activity list whose first row is a blank separator still has
    // activities in it, and refusing to submit would be a gate that cannot be
    // satisfied by filling the form correctly.
    expect(
      completeness(
        payload({ ...DSKP, ...OBJEKTIF, aktiviti: [{ nama: "" }, { nama: "Catur" }] }),
      ),
    ).toBe(75);
    expect(completeness(payload({ ...DSKP, ...OBJEKTIF, aktiviti: [{ nama: "   " }] }))).toBe(
      50,
    );
  });

  it("sub-activities count like any other", () => {
    expect(
      completeness(
        payload({ ...DSKP, ...OBJEKTIF, aktiviti: [{ nama: "Congkak", sub: true }] }),
      ),
    ).toBe(75);
  });

  it("whitespace-only refleksi does not score", () => {
    expect(completeness(payload({ ...FULL, refleksi: "   \n  " }))).toBe(75);
  });

  it("fully complete payload → 100 and isComplete() true", () => {
    const full = payload(FULL);
    expect(completeness(full)).toBe(100);
    expect(isComplete(full)).toBe(true);
  });

  it("always returns a multiple of 25 (never a partial score)", () => {
    const cases: RphPayload[] = [
      emptyPayload(),
      payload(DSKP),
      payload({ ...DSKP, ...AKTIVITI }),
      payload({ ...DSKP, ...OBJEKTIF, refleksi: "x" }),
      payload(FULL),
    ];
    for (const c of cases) {
      expect(completeness(c) % 25).toBe(0);
    }
  });
});

describe("stepStatus — drives the stepper and the reviewer checklist", () => {
  it("reports every section complete for a finished plan", () => {
    expect(stepStatus(payload(FULL))).toEqual({
      profil: true,
      dskp: true,
      pdpc: true,
      refleksi: true,
    });
  });

  it("flags the missing section rather than failing the whole plan", () => {
    const s = stepStatus(payload({ ...DSKP, objektif: "", kriteria_kejayaan: "" }));
    expect(s.profil).toBe(true);
    expect(s.dskp).toBe(false);
    expect(s.pdpc).toBe(false);
    expect(s.refleksi).toBe(false);
  });

  it("needs Kriteria Kejayaan as well as activities for PdPc", () => {
    const s = stepStatus(
      payload({
        ...DSKP,
        ...OBJEKTIF,
        aktiviti: [{ nama: "Senamrobik" }],
        kriteria_kejayaan: "   ",
      }),
    );
    expect(s.pdpc).toBe(false);
  });
});
