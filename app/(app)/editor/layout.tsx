import type { ReactNode } from "react";
import { requirePermission } from "@/lib/server/auth/page-guard";

/** `/editor` — writing a plan requires `rph`. Administrators do not write plans. */
export default async function EditorLayout({ children }: { children: ReactNode }) {
  await requirePermission("rph");
  return <>{children}</>;
}
