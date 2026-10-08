import Image from "next/image";
import { redirect } from "next/navigation";
import { LoginCard } from "@/components/auth/login-card";
import { SCHOOL } from "@/lib/config";
import { getCurrentUser } from "@/lib/server/auth/session";

/**
 * Login gate.
 *
 * Credentials are username + password against `erph.user` (Supabase Auth is
 * not used). Already signed in? Straight through — otherwise a returning
 * teacher with a valid cookie would be asked to log in again.
 *
 * Two panels: the school's own crest, because at 6am on a school laptop this
 * is the one screen a teacher sees before anything else, and recognising it as
 * *their* school's system is worth more than any amount of product branding.
 */
export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect("/minggu");

  return (
    <div className="grid min-h-dvh bg-bg lg:grid-cols-[minmax(0,1fr)_minmax(0,560px)]">
      {/* ── Brand ─────────────────────────────────────────────────────────── */}
      <aside className="relative flex flex-col justify-between gap-10 overflow-hidden bg-sidebar-bg px-6 py-10 text-center sm:px-10 lg:px-14 lg:text-left">
        {/* Same glow as the app shell, so the two screens feel like one product. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-40 -left-32 h-[420px] w-[420px] rounded-full bg-[radial-gradient(circle,rgba(83,177,253,0.22),transparent_65%)]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -bottom-32 h-[380px] w-[380px] rounded-full bg-[radial-gradient(circle,rgba(255,214,10,0.12),transparent_65%)]"
        />

        <div className="relative flex flex-1 flex-col items-center justify-center gap-7">
          <div className="rounded-[20px] bg-white p-2.5 shadow-[0_18px_40px_-12px_rgba(0,0,0,0.45)]">
            <Image
              src={SCHOOL.logo}
              alt={`Lambang ${SCHOOL.name}`}
              width={512}
              height={512}
              priority
              className="h-36 w-36 rounded-[13px] object-contain sm:h-44 sm:w-44"
            />
          </div>

          <div>
            <p className="text-[11px] font-bold tracking-[3.5px] text-[#8cc7ff] uppercase">
              {SCHOOL.place}
            </p>
            <h1 className="mt-2.5 text-[28px] leading-[1.12] font-extrabold tracking-[-0.6px] text-white sm:text-[34px]">
              {SCHOOL.name}
            </h1>
            <p className="mt-2.5 text-[14px] text-[#afbdd1] sm:text-[15px]">
              Rancangan Pengajaran Harian
            </p>
          </div>
        </div>

        <footer className="relative flex flex-col items-center gap-4">
          <span className="inline-flex items-center rounded-full border border-[#ffd60a]/35 bg-[#ffd60a]/10 px-4 py-1.5 text-[12.5px] font-semibold tracking-[0.4px] text-[#ffe066]">
            {SCHOOL.motto}
          </span>
          <p className="text-[11.5px] text-[#6d7f99]">
            Kementerian Pendidikan Malaysia · Garis Panduan e-RPH
          </p>
        </footer>
      </aside>

      {/* ── Sign in ──────────────────────────────────────────────────────── */}
      <main className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-400px">
          <LoginCard />
        </div>
      </main>
    </div>
  );
}
