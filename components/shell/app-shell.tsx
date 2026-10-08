"use client";

import * as React from "react";
import { CommandPalette } from "@/components/shell/command-palette";
import { MobileNav } from "@/components/shell/mobile-nav";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import { type ShellUser, UserProvider } from "@/components/shell/user-context";

/**
 * Client chrome: holds the command-palette open state so ⌘K works anywhere and
 * the topbar's search button has something to talk to.
 */
export function AppShell({ children, user }: { children: React.ReactNode; user: ShellUser }) {
  const [paletteOpen, setPaletteOpen] = React.useState(false);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    // One provider around the *whole* shell: MobileNav and the command palette
    // sit outside <main>, and both need the role to filter their entries.
    <UserProvider user={user}>
      <div className="flex min-h-dvh">
        {/* Skip link — WCAG 2.4.1 */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-200 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-white"
        >
          Langkau ke kandungan
        </a>

        <Sidebar user={user} />

        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar onOpenPalette={() => setPaletteOpen(true)} />
          {/* pb-28 clears the mobile bottom nav; lg:pb-14 because it disappears */}
          <main
            id="main"
            className="w-full max-w-[1420px] flex-1 px-4 pt-5 pb-28 sm:px-6 lg:pb-14"
          >
            <div className="erph-rise-in">{children}</div>
          </main>
        </div>

        <MobileNav />
        <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      </div>
    </UserProvider>
  );
}
