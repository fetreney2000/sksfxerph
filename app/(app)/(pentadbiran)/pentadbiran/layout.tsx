import type { ReactNode } from "react";
import { requirePermission } from "@/lib/server/auth/page-guard";

/** `/pentadbiran` — set up and manage the app. Administrator only. */
export default async function PentadbiranLayout({ children }: { children: ReactNode }) {
  await requirePermission("pentadbir");
  return <>{children}</>;
}
