"use client";

import { usePathname } from "next/navigation";
import { navFor } from "@/components/shell/nav";
import { useUser } from "@/components/shell/user-context";
import { cn } from "@/lib/cn";
import { ms } from "@/lib/i18n/ms";

/**
 * Bottom navigation — frontend research §4.2(9) "mobile-first: bottom nav".
 *
 * The sidebar is desktop-only (`hidden lg:flex`), so without this a teacher on
 * a phone has no visible way to move between screens except the ⌘K palette,
 * which is not discoverable at 6am on a 5-inch screen. Up to five destinations,
 * filtered through `navFor()` so the reviewer pair never appears for a Guru
 * Biasa, ≥48px touch targets.
 *
 * Labels come from `NavItem.short`, because five items across 375px is ~75px
 * each and "Perpustakaan Templat" measures 126px. `min-w-0` on the item and
 * the anchor is the part that makes `truncate` actually work: a flex item
 * will not shrink below its content width without it, so the label used to
 * push the whole bar past the viewport rather than ellipsize.
 */
const PRIMARY = [
  "/utama",
  "/minggu",
  "/editor",
  "/templat",
  "/semakan",
  "/sekolah",
  "/pentadbiran",
];

export function MobileNav() {
  const pathname = usePathname();
  const { role } = useUser();
  const items = navFor(role)
    .flatMap((g) => g.items)
    .filter((i) => PRIMARY.includes(i.href));

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
            <li key={item.href} className="min-w-0 flex-1">
              <a
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
                <span className="block w-full truncate px-0.5">{item.short ?? item.label}</span>
              </a>
            </li>
          );
        })}
      </ul>
      <span className="sr-only">{ms.a11y.mainNavigation}</span>
    </nav>
  );
}
