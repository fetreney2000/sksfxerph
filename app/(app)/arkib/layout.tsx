import type { ReactNode } from "react";
import { requirePermission } from "@/lib/server/auth/page-guard";

/** `/arkib` — a teacher's own plan history. Requires `rph`. */
export default async function ArkibLayout({ children }: { children: ReactNode }) {
  await requirePermission("rph");
  return <>{children}</>;
}
