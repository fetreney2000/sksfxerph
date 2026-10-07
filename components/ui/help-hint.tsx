"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * Contextual "?" popover (frontend research §4.2(12): "progressive/zero-training
 * help — contextual ? popovers … teachers must be able to self-serve").
 *
 * A disclosure, not a hover tooltip: hover-only help is unusable on the phones
 * most teachers plan on, and unreachable by keyboard. Click/Enter toggles,
 * Escape and outside-click dismiss.
 */
export function HelpHint({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLSpanElement>(null);

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
    <span ref={ref} className={cn("relative inline-flex align-middle", className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-label={`Bantuan: ${label}`}
        onClick={() => setOpen((o) => !o)}
        className="grid h-[18px] w-[18px] place-items-center rounded-full border border-border-strong bg-surface text-[11px] leading-none font-bold text-ink-3 transition-colors hover:border-primary hover:text-primary-ink"
      >
        ?
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute top-6 left-0 z-30 w-[min(260px,72vw)] rounded-[10px] border border-border bg-surface p-3 text-[12.5px] leading-[1.5] text-ink-2 shadow-md erph-rise-in"
        >
          {children}
        </span>
      )}
    </span>
  );
}
