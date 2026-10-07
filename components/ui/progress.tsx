import type * as React from "react";
import { cn } from "@/lib/cn";

export interface ProgressProps extends React.ComponentPropsWithoutRef<"div"> {
  /** 0–100 */
  value: number;
  tone?: "primary" | "success" | "warning";
}

export function Progress({ value, tone = "primary", className, ...props }: ProgressProps) {
  const clamped = Math.max(0, Math.min(100, value));
  const bar =
    tone === "success"
      ? "bg-gradient-to-r from-[#12b76a] to-[#039855]"
      : tone === "warning"
        ? "bg-gradient-to-r from-[#f79009] to-[#dc6803]"
        : "bg-primary";

  return (
    <div
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn("h-1.75 w-full overflow-hidden rounded-full bg-surface-3", className)}
      {...props}
    >
      <div
        className={cn("h-full rounded-full transition-[width] duration-500", bar)}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
