"use client";

import { useLiveQuery } from "dexie-react-hooks";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { navFor } from "@/components/shell/nav";
import { cn } from "@/lib/cn";
import { currentWeek, SESSION } from "@/lib/config";
import { db } from "@/lib/db";
import { LOCAL_OWNER_ID } from "@/lib/demo/seed";
import { ms } from "@/lib/i18n/ms";
import type { MemberRole } from "@/lib/types";

const WEEK = currentWeek();

export function Sidebar({ user }: { user: { fullName: string; role: MemberRole } }) {
  const pathname = usePathname();
  const initials =
    user.fullName
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "U";
  const roleLabel = ms.roles[user.role];

  const signOut = async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
      });
    } finally {
      // Full navigation: the (app) layout reads the cookie server-side, so the
      // server must re-render rather than hydrate a shell it can no longer auth.
      window.location.assign("/login");
    }
  };

  const counts = useLiveQuery(
    async () => ({
      drafts: await db.documents
        .where("[ownerId+session]")
        .equals([LOCAL_OWNER_ID, SESSION])
        .filter((d) => d.weekNo === WEEK && d.status === "draft")
        .count(),
      pending: 4, // stand-in for `select count(*) ... status='submitted'` in local mode
    }),
    [],
    { drafts: 0, pending: 4 },
  );

  return (
    <aside
      className="sticky top-0 z-40 hidden h-dvh w-63 shrink-0 flex-col border-r border-[rgba(255,255,255,0.07)] bg-gradient-to-b from-[#0c1d33] to-[#0a1729] lg:flex"
      aria-label={ms.a11y.mainNavigation}
    >
      <Link href="/minggu" className="flex items-center gap-2.5 px-4.5 py-4.5">
        <span className="grid h-9.5 w-9.5 place-items-center rounded-[11px] bg-gradient-to-br from-primary to-[#53b1fd] text-[13px] font-extrabold text-white shadow-[0_4px_12px_rgba(23,92,211,0.45)]">
          eR
        </span>
        <span className="min-w-0">
          <span className="block text-[15.5px] font-bold tracking-[-0.2px] text-white">
            {ms.appName}
          </span>
          <span className="block text-[11px] text-[#6d7f99]">{ms.appTagline}</span>
        </span>
        <span className="ml-auto rounded-md border border-[rgba(83,177,253,0.3)] bg-[rgba(83,177,253,0.14)] px-1.5 py-0.5 text-[9.5px] font-bold tracking-[0.6px] text-[#8cc7ff]">
          BETA
        </span>
      </Link>

      <nav className="flex-1 overflow-y-auto px-3 pb-3">
        {navFor(user.role).map((group) => (
          <div key={group.label}>
            <p className="px-2.5 pt-4 pb-1.5 text-[10.5px] font-bold tracking-[0.9px] text-[#6d7f99] uppercase">
              {group.label}
            </p>
            {group.items.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              const n =
                item.badge === "drafts"
                  ? counts?.drafts
                  : item.badge === "pending"
                    ? counts?.pending
                    : undefined;
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative mb-0.5 flex items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-[13.5px] font-medium transition-colors",
                    "text-[#afbdd1] hover:bg-white/[0.06] hover:text-[#e7eef8]",
                    active && "bg-[rgba(83,177,253,0.14)] font-semibold text-[#8cc7ff]",
                  )}
                >
                  {active && (
                    <span className="absolute -left-3 top-1.5 bottom-1.5 w-[3px] rounded-r bg-[#53b1fd] shadow-[0_0_10px_rgba(83,177,253,0.8)]" />
                  )}
                  <Icon className="h-4.5 w-4.5 shrink-0" strokeWidth={1.7} aria-hidden />
                  <span className="truncate">{item.label}</span>
                  {!!n && n > 0 && (
                    <span
                      className={cn(
                        "ml-auto rounded-full px-1.5 py-px text-[10.5px] font-bold",
                        item.badge === "pending"
                          ? "bg-[#f04438] text-white"
                          : "bg-[rgba(83,177,253,0.18)] text-[#8cc7ff]",
                      )}
                    >
                      {n}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}

        <div className="mt-4 rounded-xl border border-[rgba(255,255,255,0.09)] bg-white/[0.045] p-3">
          <h4 className="flex items-center gap-1.5 text-[12.5px] font-semibold text-white">
            <svg
              className="h-3.75 w-3.75"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M12 16.2v-4.4M12 8h.01" />
            </svg>
            {ms.nav.rujukan}
          </h4>
          <p className="mt-1 mb-2.5 text-[11.5px] leading-[1.5] text-[#90a1ba]">
            Surat Siaran KPM Bil. 2/2025 &amp; Garis Panduan Penyediaan e-RPH — disertakan terus
            dalam sistem.
          </p>
          <button
            type="button"
            className="h-10 w-full rounded-lg border border-white/15 bg-white/10 px-2.5 text-[12.5px] font-semibold text-[#dce6f4] transition-colors hover:bg-white/[0.16]"
            onClick={() =>
              window.open(
                // The actual Garis Panduan e-RPH PDF (§4.2(12): self-serve help),
                // not the ministry homepage — the FAQ must be one click away.
                "https://gurubesar.my/wp-content/uploads/2025/05/Surat-Siaran-Bilangan-2-Tahun-2025-eRPH-1.pdf",
                "_blank",
                "noopener",
              )
            }
          >
            Buka garis panduan
          </button>
        </div>
      </nav>

      <div className="flex items-center gap-2.5 border-t border-[rgba(255,255,255,0.08)] px-4 py-3">
        <span className="grid h-8.5 w-8.5 place-items-center rounded-full bg-gradient-to-br from-primary to-[#2e7ce0] text-[12px] font-bold text-white">
          {initials}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-white">
            {user.fullName}
          </span>
          <span className="block truncate text-[11px] text-[#6d7f99]">{roleLabel}</span>
        </span>
        <button
          type="button"
          onClick={() => void signOut()}
          title="Log keluar"
          aria-label="Log keluar"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-[rgba(255,255,255,0.14)] bg-white/[0.07] text-[#afbdd1] transition-colors hover:bg-white/[0.15] hover:text-white"
        >
          <svg
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <path d="m16 17 5-5-5-5" />
            <path d="M21 12H9" />
          </svg>
        </button>
      </div>
    </aside>
  );
}
