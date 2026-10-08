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
  /** Whole-school monitoring. */
  | "pantau"
  /** School-wide reports and exports. */
  | "laporan"
  /** Read the audit log. */
  | "audit"
  /** App set-up: accounts, classes, subjects, session, deadlines. */
  | "pentadbir";

const MATRIX: Record<MemberRole, readonly Permission[]> = {
  // Guru Mata Pelajaran (KPM HR12–HR21): their own RPH and nothing else.
  guru_biasa: ["rph"],
  // GPK Pentadbiran (KPM HR02) — "menyelia dan menilai pengajaran" — so it
  // supervises: grade, monitor, report, and see who reviewed what.
  gpk: ["rph", "semak", "pantau", "laporan", "audit"],
  // PGB (KPM HR01) reaches the same screens as its GPK today.
  guru_besar: ["rph", "semak", "pantau", "laporan", "audit"],
  // Administrator sets the app up. Deliberately outside `is_staff` in SQL, so
  // it can never grade a plan, read whole-school compliance or open the log.
  pentadbir: ["rph", "pentadbir"],
  // District/state officers have no view of their own yet; keep the shell
  // usable for them rather than showing an empty app.
  ppd: ["rph"],
  jpn: ["rph"],
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
