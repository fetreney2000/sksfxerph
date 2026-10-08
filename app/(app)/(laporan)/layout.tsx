import type { ReactNode } from "react";
import { requirePermission } from "@/lib/server/auth/page-guard";

/** `/laporan` — school-wide reports require `laporan`. */
export default async function LaporanLayout({ children }: { children: ReactNode }) {
  await requirePermission("laporan");
  return <>{children}</>;
}
