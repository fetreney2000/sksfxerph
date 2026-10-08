import { redirect } from "next/navigation";
import { can, type Permission } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/server/auth/session";

/**
 * Server-side page gate.
 *
 * Next route groups keep the URL — a Guru Biasa typing `/semakan` still gets
 * `/semakan` — but give that subtree its own layout, so the check sits next to
 * the pages it protects instead of hiding in the shared shell.
 *
 * Redirecting rather than rendering an empty page is the whole point: the user
 * should learn "you cannot see this", not "this screen is broken for me". The
 * APIs behind these pages enforce the same permission independently, so this
 * is the readable layer, not the security boundary.
 */
export async function requirePermission(permission: Permission): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!can(user.role, permission)) redirect("/minggu");
}
