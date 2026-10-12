"use client";

import { useQuery } from "@tanstack/react-query";
import { useLiveQuery } from "dexie-react-hooks";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { navFor } from "@/components/shell/nav";
import { homeFor, reviewStageFor } from "@/lib/auth/permissions";
import { handleExpiredSession } from "@/lib/client/auth-session";
import { cn } from "@/lib/cn";
import { currentWeek, supabaseConfigured } from "@/lib/config";
import { db } from "@/lib/db";
import { QUEUE } from "@/lib/demo/review";
import { useSchool } from "@/lib/hooks/use-school";
import { useSession } from "@/lib/hooks/use-session";
import { ms } from "@/lib/i18n/ms";
import { ownerId } from "@/lib/owner";
import type { MemberRole } from "@/lib/types";

const WEEK = currentWeek();

export function Sidebar({
  user,
}: {
  user: { id: string; fullName: string; role: MemberRole };
}) {
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

  const session = useSession();
  // Whose drafts this badge counts: IndexedDB is shared by every account that
  // signs into this browser.
  const owner = ownerId();
  const school = useSchool();
  const counts = useLiveQuery(
    async () => ({
      drafts: await db.documents
        .where("[ownerId+session]")
        .equals([owner, session])
        .filter((d) => d.weekNo === WEEK && d.status === "draft")
        .count(),
    }),
    [owner, session],
    { drafts: 0 },
  );

  /**
   * How many plans are waiting to be reviewed.
   *
   * It was the constant 4, printed on every reviewer's sidebar whatever the
   * school had actually sent in — a badge reporting work that may not exist,
   * which is the same lie as a dashboard of another school's figures. In local
   * mode the demo queue *is* the queue, so it is counted there; in synced mode
   * it is fetched, and a request that has not answered yet shows nothing at
   * all rather than a number.
   */
  const stage = reviewStageFor(user.role);
  const queueCount = useQuery<number | null>({
    queryKey: ["review-queue-count", session],
    queryFn: async () => {
      const res = await fetch("/api/queue", { credentials: "same-origin" });
      if (handleExpiredSession(res.status)) return null;
      if (!res.ok) return null;
      const body = (await res.json()) as { items: unknown[] };
      return body.items.length;
    },
    // Only a reviewer may ask, and only where there is someone to ask.
    enabled: supabaseConfigured && stage !== null,
    retry: false,
    staleTime: 60_000,
  });
  const pending = supabaseConfigured
    ? (queueCount.data ?? null)
    : stage
      ? QUEUE.filter((q) => q.status === stage.status).length
      : null;

  return (
    <aside
      data-print="chrome"
      className="sticky top-0 z-40 hidden h-dvh w-63 shrink-0 flex-col border-r border-[rgba(255,255,255,0.07)] bg-gradient-to-b from-[#0c1d33] to-[#0a1729] lg:flex"
      aria-label={ms.a11y.mainNavigation}
    >
      <Link
        href={homeFor(user.role)}
        className="flex items-center gap-2.5 px-4.5 py-4 transition-colors hover:bg-white/[0.06]"
      >
        <Image
          src={school.logo}
          alt=""
          width={512}
          height={512}
          className="h-10 w-10 shrink-0 rounded-[10px] bg-white object-contain p-0.5 shadow-xs"
        />
        <span className="min-w-0">
          <span className="block truncate text-[13.5px] leading-tight font-bold text-white">
            {school.name}
          </span>
          <span className="block truncate text-[10.5px] text-[#6d7f99]">{ms.appTagline}</span>
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
                    ? pending
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
