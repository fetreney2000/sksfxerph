import type { ReactNode } from "react";
import { requirePermission } from "@/lib/server/auth/page-guard";

/** `/semakan` — grading plans requires the `semak` permission (GPK / Guru Besar). */
export default async function SemakLayout({ children }: { children: ReactNode }) {
  await requirePermission("semak");
  return <>{children}</>;
}
