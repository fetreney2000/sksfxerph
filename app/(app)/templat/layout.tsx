import type { ReactNode } from "react";
import { requirePermission } from "@/lib/server/auth/page-guard";

/**
 * `/templat` — gated on `templat`, not `rph`.
 *
 * The Administrator curates the library without owning any plans, which is why
 * these are two permissions rather than one: folding "read and write templates"
 * into `rph` would have handed the Administrator a permission named "write and
 * submit one's own plans".
 */
export default async function TemplatLayout({ children }: { children: ReactNode }) {
  await requirePermission("templat");
  return <>{children}</>;
}
