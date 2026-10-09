import { redirect } from "next/navigation";
import { homeFor } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/server/auth/session";

/**
 * `/` resolves to the caller's own home rather than a fixed screen.
 *
 * A literal `/minggu` would strand the Administrator: they hold no `rph`, so
 * that page's gate would bounce them back here in a loop.
 */
export default async function Home() {
  const user = await getCurrentUser();
  redirect(user ? homeFor(user.role) : "/login");
}
