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
 * `submit_rph()` then refuses. Each case below documents its SQL equivalent.
 */
const payload = (over: Partial<RphPayload>): RphPayload => ({
  ...emptyPayload(),
  ...over,
});

const FULL_PROFILE = {
  standard_kandungan: "Nombor hingga 100,000",
  standard_pembelajaran: "3.1.1 Menulis semula nombor",
  objektif: "Murid dapat menulis semula nombor hingga 100,000.",
};

const FULL_ACTIVITY = {
  aktiviti: [{ masa: "10 min", aktiviti_guru: "Set induksi", aktiviti_murid: "Menjawab" }],
};

describe("completeness — four 25-point checks", () => {
  it("empty payload scores 0 (all four SQL conditions false)", () => {
    expect(completeness(emptyPayload())).toBe(0);
  });

  it("profil only: SK + SP + objektif → 25", () => {
    expect(completeness(payload(FULL_PROFILE))).toBe(25);
  });

  it("profil is NOT satisfied when only SK and SP are present", () => {
    // SQL: requires all three non-empty — a missing objektif must not score.
    expect(
      completeness(
        payload({
          standard_kandungan: "x",
          standard_pembelajaran: "y",
          objektif: "",
        }),
      ),
    ).toBe(0);
  });

  it("profil + aktiviti → 50", () => {
    expect(completeness(payload({ ...FULL_PROFILE, ...FULL_ACTIVITY }))).toBe(50);
  });

  it("an aktiviti array with an empty aktiviti_guru does not score", () => {
    // SQL checks `(v_act->0)->>'aktiviti_guru'` is non-blank specifically —
    // a row with only murid text must not count as a plan.
    expect(
      completeness(
        payload({
          ...FULL_PROFILE,
          aktiviti: [{ masa: "10 min", aktiviti_guru: "   ", aktiviti_murid: "jawab" }],
        }),
      ),
    ).toBe(25);
  });

  it("profil + aktiviti + refleksi → 75", () => {
    expect(
      completeness(payload({ ...FULL_PROFILE, ...FULL_ACTIVITY, refleksi: "Murid faham." })),
    ).toBe(75);
  });

  it("intervensi alone completes the fourth check → 100", () => {
    expect(
      completeness(
        payload({
          ...FULL_PROFILE,
          ...FULL_ACTIVITY,
          refleksi: "ok",
          intervensi: "Intervensi kumpulan kecil.",
        }),
      ),
    ).toBe(100);
  });

  it("EMK alone also completes the fourth check (SQL: OR emk length > 0)", () => {
    expect(
      completeness(
        payload({
          ...FULL_PROFILE,
          ...FULL_ACTIVITY,
          refleksi: "ok",
          emk: ["Kerjasama"],
        }),
      ),
    ).toBe(100);
  });

  it("whitespace-only refleksi does not score", () => {
    expect(
      completeness(payload({ ...FULL_PROFILE, ...FULL_ACTIVITY, refleksi: "   \n  " })),
    ).toBe(50);
  });

  it("fully complete payload → 100 and isComplete() true", () => {
    const full = payload({
      ...FULL_PROFILE,
      ...FULL_ACTIVITY,
      refleksi: "7 daripada 28 murid keliru nilai puluhan.",
      intervensi: "Intervensi kumpulan kecil Khamis.",
      emk: ["Kerjasama", "Kreativiti"],
    });
    expect(completeness(full)).toBe(100);
    expect(isComplete(full)).toBe(true);
  });

  it("always returns a multiple of 25 (never a partial score)", () => {
    const cases: RphPayload[] = [
      emptyPayload(),
      payload(FULL_PROFILE),
      payload({ ...FULL_PROFILE, ...FULL_ACTIVITY }),
      payload({ ...FULL_PROFILE, refleksi: "x" }),
    ];
    for (const c of cases) {
      expect(completeness(c) % 25).toBe(0);
    }
  });
});

describe("stepStatus — drives the stepper and the reviewer checklist", () => {
  const full = payload({
    ...FULL_PROFILE,
    ...FULL_ACTIVITY,
    refleksi: "ok",
    intervensi: "ok",
    emk: ["Kerjasama"],
  });

  it("reports every section complete for a finished plan", () => {
    expect(stepStatus(full)).toEqual({
      profil: true,
      dskp: true,
      pdpc: true,
      refleksi: true,
    });
  });

  it("flags the missing section rather than failing the whole plan", () => {
    const s = stepStatus(payload(FULL_PROFILE));
    expect(s.dskp).toBe(true);
    expect(s.pdpc).toBe(false);
    expect(s.refleksi).toBe(false);
  });

  it("requires aktiviti_murid as well as aktiviti_guru", () => {
    const s = stepStatus(
      payload({
        ...FULL_PROFILE,
        aktiviti: [{ masa: "10 min", aktiviti_guru: "Terang", aktiviti_murid: "" }],
      }),
    );
    expect(s.pdpc).toBe(false);
  });
});
