import type * as React from "react";
import { Label } from "@/components/ui/field";
import { cn } from "@/lib/cn";

/**
 * One record in a list that is laid out as cards rather than as a table row.
 *
 * The set-up console's lists became cards when the roster grew. A seven-column
 * table is a horizontally scrolling strip on a phone and seventy rows deep on
 * a laptop; a card grid stacks, and each card carries its own labels, so it
 * stays readable without a header row to read the values against.
 *
 * The footer holds the actions and is pinned to the bottom with a rule above
 * it, so cards of different heights still line their buttons up.
 */
export function RecordCard({
  title,
  subtitle,
  badge,
  children,
  footer,
  className,
}: {
  title: React.ReactNode;
  /** The second line under the title — a username, a code, a form. */
  subtitle?: React.ReactNode;
  /** A status, pinned to the top-right corner. */
  badge?: React.ReactNode;
  /** The body: fields, figures, whatever the record is judged by. */
  children?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col rounded-[14px] border border-border bg-surface p-4 shadow-xs",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] leading-tight font-bold text-ink">{title}</p>
          {subtitle && <p className="mt-1 truncate text-[12px] text-ink-3">{subtitle}</p>}
        </div>
        {badge}
      </div>
      {children && <div className="mt-3.5 grid gap-3">{children}</div>}
      {footer && (
        <div className="mt-3.5 flex flex-wrap gap-1.5 border-t border-border pt-3">
          {footer}
        </div>
      )}
    </div>
  );
}

/**
 * A labelled control or figure inside a record card.
 *
 * The label is a real `<label>`, not a caption: the pickers in the accounts
 * card are the same controls the table had, and they have to stay reachable by
 * their accessible names for a screen reader — and for the tests that ask for
 * "Jawatan <name>" by name.
 */
export function CardField({
  label,
  htmlFor,
  children,
  hint,
  className,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
  hint?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label htmlFor={htmlFor} className="mb-1 block">
        {label}
      </Label>
      {children}
      {hint && <p className="mt-1 text-[11.5px] text-ink-4">{hint}</p>}
    </div>
  );
}
