"use client";

import { Bell } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { cn } from "@/lib/cn";
import { formatMyt } from "@/lib/date";
import { useNotifications } from "@/lib/hooks/use-notifications";
import { ms } from "@/lib/i18n/ms";

/**
 * Notification bell + panel.
 *
 * `notification` rows are written by `sahkan_rph()` and `hantar_balik()` when
 * a GPK decides on a plan. The Dexie mirror is what makes this device's own
 * events available offline; this is the surface.
 *
 * Clicking a row both marks it read and follows its `link_view`, because a
 * notification that says "RPH perlu dibaiki" and does not take you to the RPH
 * makes the reader do the finding.
 */

/** The routes `link_view` names. 'dashboard' predates /minggu's rename. */
const ROUTES: Record<string, string> = { dashboard: "/minggu", review: "/semakan" };
export function NotificationBell() {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const router = useRouter();

  const { items, markRead, markAllRead } = useNotifications();
  const unread = items.filter((n) => !n.readAt).length;

  const openNotification = (n: (typeof items)[number]) => {
    void markRead(n.id);
    setOpen(false);
    const href = ROUTES[n.linkView ?? ""] ?? "/minggu";
    // No push when already there: navigating to the current route would
    // re-render the page a teacher is already reading.
    if (window.location.pathname !== href) router.push(href);
  };

  // Close on outside click or Escape — a menu that can only be closed by
  // clicking it again is a keyboard trap.
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`${ms.a11y.notifications}${unread > 0 ? ` (${unread} baharu)` : ""}`}
        aria-expanded={open}
        aria-haspopup="menu"
        className="relative grid h-11 w-11 place-items-center rounded-[9px] border border-border bg-surface shadow-xs transition-colors hover:bg-surface-3"
      >
        <Bell className="h-[18px] w-[18px] text-ink-2" strokeWidth={1.7} aria-hidden />
        {unread > 0 && (
          <span className="absolute top-1.5 right-2 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          aria-label={ms.a11y.notifications}
          className="absolute right-0 z-50 mt-2 w-[min(360px,92vw)] overflow-hidden rounded-[14px] border border-border bg-surface shadow-lg erph-rise-in"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <span className="text-[13.5px] font-bold">{ms.a11y.notifications}</span>
            {unread > 0 && (
              <button
                type="button"
                onClick={() => markAllRead()}
                className="text-[12px] font-semibold text-primary-ink hover:underline"
              >
                Tanda semua dibaca
              </button>
            )}
          </div>

          <ul className="max-h-80 list-none overflow-y-auto">
            {(items ?? []).length === 0 && (
              <li className="px-4 py-8 text-center text-[13px] text-ink-4">
                Tiada pemberitahuan baharu.
              </li>
            )}
            {(items ?? []).map((n) => (
              <li key={n.id} className="border-b border-border last:border-b-0">
                <button
                  type="button"
                  onClick={() => openNotification(n)}
                  className={cn(
                    "flex w-full flex-col gap-0.5 px-4 py-3 text-left transition-colors hover:bg-surface-2",
                    !n.readAt && "bg-primary-soft/50",
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span
                      className={cn(
                        "h-1.5 w-1.5 shrink-0 rounded-full",
                        n.readAt ? "bg-border-strong" : "bg-primary",
                      )}
                      aria-hidden
                    />
                    <span className="text-[13px] font-semibold">{n.title}</span>
                  </span>
                  {n.body && (
                    <span className="line-clamp-2 pl-3.5 text-[12.5px] leading-[1.5] text-ink-3">
                      {n.body}
                    </span>
                  )}
                  <span className="pl-3.5 text-[11px] text-ink-4">
                    {formatMyt({
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    }).format(new Date(n.createdAt))}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
