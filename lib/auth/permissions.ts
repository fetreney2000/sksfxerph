import type { MemberRole } from "@/lib/types";

/**
 * What a role may *do* — in exactly one place.
 *
 * Permissions name a capability, not a page: the nav (`components/shell/nav`),
 * the page gates under `app/(app)/` and the route guards under `app/api/` all
 * ask this module, so a role can never be hidden in one layer and reachable in
 * another. That is the bug this file replaces — `nav.ts` used to declare a
 * `scope` field that nothing ever read.
 *
 * `db/schema.sql` mirrors this table (`is_staff`, `has_role(...)`, the RLS
 * policies). Renaming a role or changing a cell means editing both: SQL
 * compares enum literals and a stale one fails *closed*, silently locking the
 * role out.
 */
export type Permission =
  /** Write and submit one's own plans. */
  | "rph"
  /** Grade plans — the review queue. */
  | "semak"
  /**
   * Whole-school monitoring — the `/sekolah` page: per-teacher rows, reminders
   * and exports. The aggregate counts behind it are deliberately *not* behind
   * this (see `/api/stats`), so a Guru Biasa still sees how the school is doing
   * without seeing who is behind it.
   */
  | "pantau"
  /** School-wide reports and exports. */
  | "laporan"
  /** Read the audit log. */
  | "audit"
  /**
   * The template library — reading, and for the school's own templates,
   * writing them.
   *
   * Split from `rph` because the Administrator needs it without needing `rph`.
   * An administrator does not teach, so they should not be given a permission
   * named "write and submit one's own plans" just to reach a screen they *do*
   * administer; folding the two together would have been the smaller diff and
   * the worse model.
   */
  | "templat"
  /** App set-up: accounts, classes, subjects, session, deadlines. */
  | "pentadbir";

const MATRIX: Record<MemberRole, readonly Permission[]> = {
  // Guru Mata Pelajaran (KPM HR12–HR21): their own RPH and nothing else.
  guru_biasa: ["rph", "templat"],
  // GPK Pentadbiran (KPM HR02) — "menyelia dan menilai pengajaran" — so it
  // supervises: grade, monitor, report, and see who reviewed what.
  gpk: ["rph", "semak", "pantau", "laporan", "audit", "templat"],
  // PGB (KPM HR01) reaches the same screens as its GPK today.
  guru_besar: ["rph", "semak", "pantau", "laporan", "audit", "templat"],
  // Administrator sets the app up. Deliberately outside `is_staff` in SQL, so
  // it can never grade a plan, read whole-school compliance or open the log —
  // and deliberately *without* `rph`: they do not teach, so they have no plans
  // of their own to write, submit or be graded on. `templat` is what they do
  // administer.
  pentadbir: ["pentadbir", "templat"],
  // District/state officers were removed: this app is internal to one school.
  system: [],
};

/** `role` is a string at the edges (cookie, context, row); unknown ⇒ nothing. */
export function can(role: string | null | undefined, permission: Permission): boolean {
  return MATRIX[role as MemberRole]?.includes(permission) ?? false;
}

export function permissionsFor(role: string | null | undefined): readonly Permission[] {
  return MATRIX[role as MemberRole] ?? [];
}

/** Roles allowed to grade — SQL mirrors this as `erph.is_staff`. */
export const REVIEWER_ROLES: readonly MemberRole[] = ["gpk", "guru_besar"];

/**
 * Where a role lands after signing in, and where it is sent when it asks for a
 * screen it may not have.
 *
 * Derived rather than configured: the Administrator has no `rph`, so sending
 * them to `/minggu` — a page gated on `rph` — would bounce them straight back
 * and produce a redirect loop. One rule, used by `/`, `/login` and every
 * `requirePermission` fallback, so the three can never disagree.
 */
export function homeFor(role: string | null | undefined): string {
  return can(role, "rph") ? "/minggu" : "/utama";
}

/**
 * What a reviewer may decide.
 *
 * There is no chain to climb any more. A GPK reviews and then either **sahkan**
 * (approve, signed) or **hantar balik** (return to the teacher), and a Guru
 * Besar can do everything a GPK can — on any teacher's plan in the school, not
 * only the ones assigned to them. Both roles therefore share this table and the
 * difference lives in `erph.may_supervise`, which SQL checks independently of
 * the role.
 *
 * Which function runs is derived from the role rather than taken from the
 * request, so a caller cannot choose the decision it wants to make.
 */
export interface ReviewStage {
  /** The only status either reviewer can decide. */
  status: "submitted";
  /** Approve. The plan must already carry a verified signature. */
  approveRpc: "sahkan_rph";
  /** Return to the teacher, with a reason. No signature — nothing was approved. */
  returnRpc: "hantar_balik_rph";
}

const REVIEWERS: Partial<Record<MemberRole, ReviewStage>> = {
  gpk: { status: "submitted", approveRpc: "sahkan_rph", returnRpc: "hantar_balik_rph" },
  guru_besar: {
    status: "submitted",
    approveRpc: "sahkan_rph",
    returnRpc: "hantar_balik_rph",
  },
};

export function reviewStageFor(role: string | null | undefined): ReviewStage | null {
  return REVIEWERS[role as MemberRole] ?? null;
}
