"use client";

import { usePathname } from "next/navigation";
import { NAV } from "@/components/shell/nav";
import { cn } from "@/lib/cn";
import { ms } from "@/lib/i18n/ms";

/**
 * Bottom navigation — frontend research §4.2(9) "mobile-first: bottom nav".
 *
 * The sidebar is desktop-only (`hidden lg:flex`), so without this a teacher on
 * a phone has no visible way to move between screens except the ⌘K palette,
 * which is not discoverable at 6am on a 5-inch screen. Five destinations, the
 * admin pair only for reviewers, ≥48px touch targets.
 */
const PRIMARY = ["/minggu", "/editor", "/templat", "/semakan", "/sekolah"];

export function MobileNav() {
  const pathname = usePathname();
  const items = NAV.flatMap((g) => g.items).filter((i) => PRIMARY.includes(i.href));

  return (
    <nav
      aria-label="Navigasi utama mudah alih"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-[var(--topbar-bg)] pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
    >
      <ul className="mx-auto flex max-w-md list-none">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <li key={item.href} className="flex-1">
              <a
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  // 48px meets the ≥44px touch-target minimum in §4.2(9).
                  "flex h-14 flex-col items-center justify-center gap-1 px-1 text-[10.5px] font-semibold transition-colors",
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
                <span className="max-w-full truncate px-0.5">
                  {item.label.replace(" & Arkib", "").replace(" & Eksport", "")}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
      <span className="sr-only">{ms.a11y.mainNavigation}</span>
    </nav>
  );
}
