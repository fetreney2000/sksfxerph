import type { ReactNode } from "react";
import { requirePermission } from "@/lib/server/auth/page-guard";

/** `/utama` — the Administrator's own home. Not a teacher's screen at all. */
export default async function UtamaLayout({ children }: { children: ReactNode }) {
  await requirePermission("pentadbir");
  return <>{children}</>;
}
