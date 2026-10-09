import { redirect } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { Providers } from "@/components/shell/providers";
import { SessionBridge } from "@/components/shell/session-bridge";
import { getCurrentUser } from "@/lib/server/auth/session";
import { resolveSession } from "@/lib/server/session";

/**
 * Auth gate for every authenticated screen.
 *
 * Supabase Auth and its `proxy.ts` session refresh are gone: this layout reads
 * the signed cookie and resolves the user server-side, on every navigation. A
 * missing/expired/revoked session bounces to /login — including the case where
 * the password was changed after the cookie was minted, which is why
 * `resolveUser` compares `iat` against `password_changed_at`.
 *
 * It also resolves the school session here, for the same reason it resolves the
 * user: one server-side read the whole shell then agrees on. The client adopts
 * it through `useSession()`; until the bridge mounts the default is used, which
 * is correct for any deployment that has never rolled its year over.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const session = await resolveSession(user.id);

  return (
    <Providers>
      <SessionBridge session={session} />
      <AppShell user={{ id: user.id, fullName: user.fullName, role: user.role }}>
        {children}
      </AppShell>
    </Providers>
  );
}
