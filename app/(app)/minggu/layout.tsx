import type { ReactNode } from "react";
import { requirePermission } from "@/lib/server/auth/page-guard";

/**
 * `/minggu` — the teacher's dashboard, gated on `rph`.
 *
 * Ungated until now, which was harmless while every role held `rph`. The
 * Administrator does not: they do not teach, so a dashboard of "your plans this
 * week" is a screen about work they never do, and its "RPH baharu" button would
 * create a plan attributed to an account that must not have one.
 */
export default async function MingguLayout({ children }: { children: ReactNode }) {
  await requirePermission("rph");
  return <>{children}</>;
}
