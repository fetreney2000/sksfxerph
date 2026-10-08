import { describe, expect, it } from "vitest";
import { can, permissionsFor, REVIEWER_ROLES } from "@/lib/auth/permissions";

/**
 * The role matrix, pinned.
 *
 * Every layer asks `can()` — the nav, the page layouts under app/(app)/ and the
 * route guards under app/api — so this test is the single place where "what may
 * each role do" is asserted. If a cell changes, this fails before any UI does.
 *
 * The four roles and their intended reach, from the review that produced them:
 *   Guru Biasa        — their own RPH, nothing else
 *   Guru Penolong Kanan — supervise: grade, monitor, report, read the log
 *   Guru Besar        — the same screens as its GPK
 *   Administrator     — set the app up; never grade, monitor or read the log
 */
describe("permissions", () => {
  it("Guru Biasa can only write their own RPH", () => {
    expect(permissionsFor("guru_biasa")).toEqual(["rph"]);
  });

  it("Guru Penolong Kanan supervises", () => {
    expect(permissionsFor("gpk")).toEqual(["rph", "semak", "pantau", "laporan", "audit"]);
  });

  it("Guru Besar reaches the same screens as its GPK", () => {
    expect(permissionsFor("guru_besar")).toEqual(permissionsFor("gpk"));
  });

  it("Administrator sets up the app and never grades", () => {
    expect(permissionsFor("pentadbir")).toEqual(["rph", "pentadbir"]);
    expect(can("pentadbir", "semak")).toBe(false);
    expect(can("pentadbir", "pantau")).toBe(false);
    expect(can("pentadbir", "laporan")).toBe(false);
    expect(can("pentadbir", "audit")).toBe(false);
  });

  it("only GPK and Guru Besar are reviewers", () => {
    expect(REVIEWER_ROLES).toEqual(["gpk", "guru_besar"]);
    for (const role of ["guru_biasa", "pentadbir", "system"]) {
      expect(can(role, "semak"), `${role} must not grade`).toBe(false);
    }
  });

  it("the service account gets nothing at all", () => {
    expect(permissionsFor("system")).toEqual([]);
  });

  it("an unknown or absent role is denied rather than defaulted", () => {
    expect(can(undefined, "rph")).toBe(false);
    expect(can(null, "semak")).toBe(false);
    expect(can("not-a-role", "pentadbir")).toBe(false);
    expect(permissionsFor("not-a-role")).toEqual([]);
  });
});
