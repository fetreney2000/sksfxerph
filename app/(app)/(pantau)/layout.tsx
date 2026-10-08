import type { ReactNode } from "react";
import { requirePermission } from "@/lib/server/auth/page-guard";

/** `/sekolah` — whole-school monitoring requires `pantau`. */
export default async function PantauLayout({ children }: { children: ReactNode }) {
  await requirePermission("pantau");
  return <>{children}</>;
}
