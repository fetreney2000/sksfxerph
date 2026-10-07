import Link from "next/link";
import { redirect } from "next/navigation";
import { LoginCard } from "@/components/auth/login-card";
import { getCurrentUser } from "@/lib/server/auth/session";

/**
 * Login gate.
 *
 * Credentials are username + password against `erph.user` (Supabase Auth is
 * not used). Already signed in? Straight through — otherwise a returning
 * teacher with a valid cookie would be asked to log in again.
 */
export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect("/minggu");

  return (
    <main className="grid min-h-dvh place-items-center bg-[var(--color-bg)] px-4 py-10">
      <div className="w-full max-w-400px">
        <Link href="/minggu" className="mb-6 flex items-center justify-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-[13px] bg-gradient-to-br from-primary via-[#004eeb] to-[#53b1fd] text-base font-extrabold text-white shadow-[0_4px_14px_rgba(23,92,211,0.45)]">
            eR
          </span>
          <span className="text-left">
            <span className="block text-xl font-extrabold tracking-[-0.5px]">eRPH</span>
            <span className="block text-[13px] text-[var(--color-ink-3)]">
              Rancangan Pengajaran Harian
            </span>
          </span>
        </Link>

        <LoginCard />
      </div>
    </main>
  );
}
