"use client";

import { Command, Moon, Search, Sun } from "lucide-react";
import { usePathname } from "next/navigation";
import { ROUTE_META } from "@/components/shell/nav";
import { NotificationBell } from "@/components/shell/notifications";
import { SyncChip } from "@/components/shell/sync-chip";
import { useTheme } from "@/components/shell/theme";
import { initialsOf, useUser } from "@/components/shell/user-context";
import { currentWeek } from "@/lib/config";
import { weekRangeLabel } from "@/lib/date";
import { useSchool } from "@/lib/hooks/use-school";
import { useSession } from "@/lib/hooks/use-session";
import { ms } from "@/lib/i18n/ms";

const WEEK = currentWeek();

export function Topbar({ onOpenPalette }: { onOpenPalette: () => void }) {
  const pathname = usePathname();
  const { theme, toggle } = useTheme();
  const me = useUser();
  const session = useSession();
  const school = useSchool();
  const meta = ROUTE_META[pathname] ?? { title: "eRPH", crumb: "" };

  return (
    <header className="sticky top-0 z-30 flex flex-wrap items-center gap-3 border-b border-border bg-[var(--topbar-bg)] px-4 py-3 backdrop-blur-md sm:px-6">
      <div className="min-w-0">
        <h1 className="truncate text-[16.5px] font-bold tracking-[-0.35px]">{meta.title}</h1>
        <p className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-ink-3">
          <span className="truncate">{school.name}</span>
          <Chevron />
          <span>{session}</span>
          <Chevron />
          <span className="num">
            Minggu {WEEK} · {weekRangeLabel(WEEK)}
          </span>
        </p>
      </div>

      <div className="ml-auto flex items-center gap-2 sm:gap-2.5">
        {/* Search is a button, not an input: it opens the ⌘K palette. */}
        <button
          type="button"
          onClick={onOpenPalette}
          className="hidden items-center gap-2 rounded-[9px] border border-border bg-surface px-2.5 py-[7px] text-left text-[13px] text-ink-4 shadow-xs transition-colors hover:border-border-strong md:flex md:w-60"
        >
          <Search className="h-3.75 w-3.75" strokeWidth={2} aria-hidden />
          <span className="truncate">Cari kelas, guru, Standard Kandungan…</span>
          <kbd className="ml-auto rounded-md border border-border-strong bg-surface-3 px-1.5 py-px font-mono text-[10.5px] font-semibold text-ink-3">
            ⌘K
          </kbd>
        </button>

        <SyncChip />

        <button
          type="button"
          onClick={onOpenPalette}
          className="grid h-9.5 w-9.5 place-items-center rounded-[9px] border border-border bg-surface shadow-xs transition-colors hover:bg-surface-3 md:hidden"
          aria-label="Cari"
        >
          <Search className="h-4.25 w-4.25 text-ink-2" strokeWidth={1.8} aria-hidden />
        </button>

        <button
          type="button"
          onClick={toggle}
          className="grid h-9.5 w-9.5 place-items-center rounded-[9px] border border-border bg-surface shadow-xs transition-colors hover:bg-surface-3"
          aria-label={theme === "dark" ? ms.a11y.lightMode : ms.a11y.darkMode}
          title={theme === "dark" ? ms.a11y.lightMode : ms.a11y.darkMode}
        >
          {theme === "dark" ? (
            <Sun className="h-4.25 w-4.25 text-ink-2" strokeWidth={1.7} aria-hidden />
          ) : (
            <Moon className="h-4.25 w-4.25 text-ink-2" strokeWidth={1.7} aria-hidden />
          )}
        </button>

        <NotificationBell />

        <span
          className="grid h-11 w-11 place-items-center rounded-full bg-gradient-to-br from-primary to-[#2e7ce0] text-xs font-bold text-white"
          title={me.fullName}
        >
          {initialsOf(me.fullName)}
        </span>
      </div>

      {/* Exposed for the palette's ⌘K hint on mobile */}
      <Command className="hidden" aria-hidden />
    </header>
  );
}

function Chevron() {
  return (
    <svg
      className="h-3 w-3 text-ink-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      aria-hidden
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}
