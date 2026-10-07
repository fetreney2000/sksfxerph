import type * as React from "react";
import { cn } from "@/lib/cn";

/** Overflow wrapper — every table in the app is horizontally scrollable on a phone. */
export function TableContainer({ className, ...props }: React.ComponentPropsWithoutRef<"div">) {
  return <div className={cn("w-full overflow-x-auto", className)} {...props} />;
}

export function Table({ className, ...props }: React.ComponentPropsWithoutRef<"table">) {
  return <table className={cn("w-full border-collapse text-[13.5px]", className)} {...props} />;
}

export function THead({ className, ...props }: React.ComponentPropsWithoutRef<"thead">) {
  return <thead className={cn("bg-surface-2", className)} {...props} />;
}

export function TH({ className, ...props }: React.ComponentPropsWithoutRef<"th">) {
  return (
    <th
      className={cn(
        "border-b border-border px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-[0.7px] text-ink-4 whitespace-nowrap",
        className,
      )}
      {...props}
    />
  );
}

export function TBody({ className, ...props }: React.ComponentPropsWithoutRef<"tbody">) {
  return <tbody className={className} {...props} />;
}

export function TR({ className, ...props }: React.ComponentPropsWithoutRef<"tr">) {
  return (
    <tr
      className={cn(
        "border-b border-border transition-colors last:border-b-0 hover:bg-surface-2",
        className,
      )}
      {...props}
    />
  );
}

export function TD({ className, ...props }: React.ComponentPropsWithoutRef<"td">) {
  return <td className={cn("px-4 py-3 align-middle", className)} {...props} />;
}
