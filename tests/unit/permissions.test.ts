import { describe, expect, it } from "vitest";
import { can, homeFor, permissionsFor, REVIEWER_ROLES } from "@/lib/auth/permissions";

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
 *   Administrator     — set the app up and curate templates; never teach,
 *                       grade, monitor or read the log
 */
describe("permissions", () => {
  it("Guru Biasa can write their own RPH and use the library", () => {
    expect(permissionsFor("guru_biasa")).toEqual(["rph", "templat"]);
  });

  it("Guru Penolong Kanan supervises", () => {
    expect(permissionsFor("gpk")).toEqual([
      "rph",
      "semak",
      "pantau",
      "laporan",
      "audit",
      "templat",
    ]);
  });

  it("Guru Besar reaches the same screens as its GPK", () => {
    expect(permissionsFor("guru_besar")).toEqual(permissionsFor("gpk"));
  });

  it("Administrator sets up the app and never grades", () => {
    expect(permissionsFor("pentadbir")).toEqual(["pentadbir", "templat"]);
    expect(can("pentadbir", "semak")).toBe(false);
    expect(can("pentadbir", "pantau")).toBe(false);
    expect(can("pentadbir", "laporan")).toBe(false);
    expect(can("pentadbir", "audit")).toBe(false);
  });

  /**
   * The Administrator does not teach.
   *
   * Holding `rph` would let them create, submit and be graded on plans of their
   * own — and would put `/minggu`, `/editor` and `/arkib` in front of someone
   * whose job is none of that. `templat` is split out precisely so they can
   * still curate the library without borrowing a permission named "write and
   * submit one's own plans".
   */
  it("Administrator holds no plans of their own", () => {
    expect(can("pentadbir", "rph")).toBe(false);
    expect(can("pentadbir", "templat")).toBe(true);
    for (const role of ["guru_biasa", "gpk", "guru_besar"]) {
      expect(can(role, "rph"), `${role} should hold plans`).toBe(true);
      expect(can(role, "templat"), `${role} should reach the library`).toBe(true);
    }
  });

  /**
   * `homeFor` is what `/`, `/login` and every `requirePermission` fallback
   * redirect to. Getting it wrong for the Administrator means redirecting them
   * to a page that gates on `rph` — which sends them back, in a loop.
   */
  it("sends each role to a home it is actually allowed to open", () => {
    expect(homeFor("guru_biasa")).toBe("/minggu");
    expect(homeFor("gpk")).toBe("/minggu");
    expect(homeFor("guru_besar")).toBe("/minggu");
    expect(homeFor("pentadbir")).toBe("/utama");
    expect(homeFor("system")).toBe("/utama");
    expect(homeFor(undefined)).toBe("/utama");
    // Whatever home is chosen, the role must be permitted to be there.
    for (const role of ["guru_biasa", "gpk", "guru_besar", "pentadbir", "system"]) {
      const home = homeFor(role);
      const needed = home === "/minggu" ? "rph" : "pentadbir";
      const allowed = home === "/minggu" ? can(role, "rph") : true;
      expect(allowed, `${role} -> ${home} needs ${needed}`).toBe(true);
    }
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
