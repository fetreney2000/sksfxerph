import { redirect } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { IdentityBridge } from "@/components/shell/identity-bridge";
import { Providers } from "@/components/shell/providers";
import { getCurrentUser } from "@/lib/server/auth/session";
import { resolveSchool } from "@/lib/server/school";

/**
 * Auth gate for every authenticated screen.
 *
 * Supabase Auth and its `proxy.ts` session refresh are gone: this layout reads
 * the signed cookie and resolves the user server-side, on every navigation. A
 * missing/expired/revoked session bounces to /login — including the case where
 * the password was changed after the cookie was minted, which is why
 * `resolveUser` compares `iat` against `password_changed_at`.
 *
 * It resolves the school here too — name, crest, motto and school year — for
 * the same reason it resolves the user: one server-side read the whole shell
 * then agrees on, so the sidebar, the breadcrumb and the printed plan cannot
 * show three different schools. The client adopts it through `useSchool()` and
 * `useSession()`; until the bridge mounts the defaults are used, which is what
 * a deployment that has never edited anything should see.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { session, school } = await resolveSchool();

  return (
    <Providers>
      <IdentityBridge session={session} school={school} />
      <AppShell user={{ id: user.id, fullName: user.fullName, role: user.role }}>
        {children}
      </AppShell>
    </Providers>
  );
}
