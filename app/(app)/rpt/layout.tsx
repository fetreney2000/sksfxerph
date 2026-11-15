import type { ReactNode } from "react";
import { requirePermission } from "@/lib/server/auth/page-guard";

/** `/rpt` — a teacher's own RPT links. Requires `rph`. */
export default async function RptLayout({ children }: { children: ReactNode }) {
  await requirePermission("rph");
  return <>{children}</>;
}
