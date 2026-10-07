import * as React from "react";
import { cn } from "@/lib/cn";

const base =
  "w-full rounded-[9px] border border-border-strong bg-surface px-3 py-2.5 text-[13.5px] shadow-xs transition-[box-shadow,border-color] duration-150 placeholder:text-ink-4 focus:outline-none focus:border-primary focus:ring-[3.5px] focus:ring-primary-soft disabled:opacity-50";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.ComponentPropsWithoutRef<"input">
>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(base, className)} {...props} />
));
Input.displayName = "Input";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentPropsWithoutRef<"textarea">
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(base, "min-h-22 resize-y leading-[1.55]", className)}
    {...props}
  />
));
Textarea.displayName = "Textarea";

/**
 * Native <select> on purpose. The primary user is a Malaysian teacher on a
 * phone; the OS picker is bigger, faster and more accessible than any custom
 * dropdown we could ship, and it costs zero JS.
 */
export const Select = React.forwardRef<
  HTMLSelectElement,
  React.ComponentPropsWithoutRef<"select">
>(({ className, children, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      base,
      "appearance-none bg-no-repeat pr-8",
      // chevron drawn with a data-URI so it inherits currentColor in dark mode
      "bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2216%22 height=%2216%22 fill=%22none%22 stroke=%22%2366748C%22 stroke-width=%222%22 stroke-linecap=%22round%22><path d=%22m4 6 4 4 4-4%22/></svg>')]",
      "bg-[right_10px_center]",
      className,
    )}
    {...props}
  >
    {children}
  </select>
));
Select.displayName = "Select";

export function Label({
  className,
  required,
  children,
  htmlFor,
  ...props
}: React.ComponentPropsWithoutRef<"label"> & { required?: boolean }) {
  return (
    <label
      htmlFor={htmlFor}
      className={cn(
        "mb-1.5 flex items-center gap-1.5 text-[12.5px] font-semibold text-ink-2",
        className,
      )}
      {...props}
    >
      {children}
      {required && (
        <span className="text-danger font-bold" aria-hidden>
          *
        </span>
      )}
    </label>
  );
}

export function FieldError({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <p id={id} className="mt-1.5 text-[11.5px] text-danger-ink" role="alert">
      {children}
    </p>
  );
}
