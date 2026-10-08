import { redirect } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { Providers } from "@/components/shell/providers";
import { getCurrentUser } from "@/lib/server/auth/session";

/**
 * Auth gate for every authenticated screen.
 *
 * Supabase Auth and its `proxy.ts` session refresh are gone: this layout reads
 * the signed cookie and resolves the user server-side, on every navigation. A
 * missing/expired/revoked session bounces to /login — including the case where
 * the password was changed after the cookie was minted, which is why
 * `resolveUser` compares `iat` against `password_changed_at`.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <Providers>
      <AppShell user={{ id: user.id, fullName: user.fullName, role: user.role }}>
        {children}
      </AppShell>
    </Providers>
  );
}
