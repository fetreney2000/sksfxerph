"use client";

import { ChevronRight, MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import { mobileNavFor } from "@/components/shell/nav";
import { useUser } from "@/components/shell/user-context";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/cn";
import { ms } from "@/lib/i18n/ms";

/**
 * Bottom navigation — frontend research §4.2(9) "mobile-first: bottom nav".
 *
 * The sidebar is desktop-only (`hidden lg:flex`), so without this a teacher on
 * a phone has no visible way to move between screens except the ⌘K palette,
 * which is not discoverable at 6am on a 5-inch screen.
 *
 * Four destinations get a tab. Everything else for the role is in **Lagi**,
 * which is how Laporan stopped disappearing for reviewers on a phone; a role
 * with four or fewer destinations has no empty drawer. Labels come from
 * `NavItem.short`, because five items across 375px is ~75px each and
 * "Perpustakaan Templat" measures 126px. `min-w-0` on the item and the link is
 * what makes `truncate` actually work: a flex item will not shrink below its
 * content width without it.
 */
export function MobileNav() {
  const pathname = usePathname();
  const { role } = useUser();
  const { primary, secondary } = mobileNavFor(role);
  const [moreOpen, setMoreOpen] = React.useState(false);

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const moreActive = moreOpen || secondary.some((g) => g.items.some((i) => isActive(i.href)));

  return (
    <>
      <nav
        data-print="chrome"
        aria-label="Navigasi utama mudah alih"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-[var(--topbar-bg)] pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
      >
        <ul className="mx-auto flex max-w-md list-none">
          {primary.map((item) => {
            const active = isActive(item.href);
            const Icon = item.icon;
            return (
              <li key={item.href} className="min-w-0 flex-1">
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    // 48px meets the ≥44px touch-target minimum in §4.2(9).
                    "flex h-14 min-w-0 flex-col items-center justify-center gap-1 px-1 text-[10.5px] font-semibold transition-colors",
                    active ? "text-primary-ink" : "text-ink-3",
                  )}
                >
                  <span
                    className={cn(
                      "grid h-7 w-12 place-items-center rounded-full transition-colors",
                      active && "bg-primary-soft",
                    )}
                  >
                    <Icon className="h-[18px] w-[18px]" strokeWidth={1.8} aria-hidden />
                  </span>
                  <span className="block w-full truncate px-0.5">
                    {item.short ?? item.label}
                  </span>
                </Link>
              </li>
            );
          })}

          {secondary.length > 0 && (
            <li className="min-w-0 flex-1">
              <button
                type="button"
                onClick={() => setMoreOpen(true)}
                aria-expanded={moreOpen}
                aria-haspopup="dialog"
                className={cn(
                  "flex h-14 w-full min-w-0 flex-col items-center justify-center gap-1 px-1 text-[10.5px] font-semibold transition-colors",
                  moreActive ? "text-primary-ink" : "text-ink-3",
                )}
              >
                <span
                  className={cn(
                    "grid h-7 w-12 place-items-center rounded-full transition-colors",
                    moreActive && "bg-primary-soft",
                  )}
                >
                  <MoreHorizontal className="h-[18px] w-[18px]" strokeWidth={1.9} aria-hidden />
                </span>
                <span className="block w-full truncate px-0.5">Lagi</span>
              </button>
            </li>
          )}
        </ul>
        <span className="sr-only">{ms.a11y.mainNavigation}</span>
      </nav>

      {secondary.length > 0 && (
        <Dialog open={moreOpen} onOpenChange={setMoreOpen}>
          <DialogContent className="top-auto bottom-0 left-0 flex max-h-[85dvh] w-full max-w-none translate-x-0 translate-y-0 flex-col rounded-t-[18px] rounded-b-none p-0">
            <DialogHeader className="shrink-0 border-b border-border pr-12 pb-3">
              <DialogTitle>Lagi</DialogTitle>
              <DialogDescription>Destinasi lain untuk peranan anda.</DialogDescription>
            </DialogHeader>
            <DialogBody className="min-h-0 flex-1 overflow-y-auto overscroll-contain pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
              {secondary.map((group) => (
                <div key={group.label} className="mb-4 last:mb-0">
                  <p className="mb-1.5 px-2.5 text-[10.5px] font-bold tracking-[0.9px] text-ink-4 uppercase">
                    {group.label}
                  </p>
                  <ul className="list-none space-y-0.5">
                    {group.items.map((item) => {
                      const active = isActive(item.href);
                      const Icon = item.icon;
                      return (
                        <li key={item.href}>
                          <Link
                            href={item.href}
                            onClick={() => setMoreOpen(false)}
                            aria-current={active ? "page" : undefined}
                            className={cn(
                              "flex min-h-12 items-center gap-3 rounded-[9px] px-2.5 py-2.5 text-[13.5px] font-semibold transition-colors",
                              active
                                ? "bg-primary-soft text-primary-ink"
                                : "text-ink-2 hover:bg-surface-3",
                            )}
                          >
                            <Icon
                              className="h-4.5 w-4.5 shrink-0"
                              strokeWidth={1.8}
                              aria-hidden
                            />
                            <span className="min-w-0 truncate">{item.label}</span>
                            <ChevronRight
                              className="ml-auto h-4 w-4 shrink-0 text-ink-4"
                              strokeWidth={2}
                              aria-hidden
                            />
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </DialogBody>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
