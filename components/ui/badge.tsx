import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/cn";

/**
 * Status pill. The leading dot is a `::before` so the badge never shifts when
 * the label changes between states (Draf → Menunggu → Lengkap).
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-[3px] text-[11.5px] font-semibold tracking-[0.1px] whitespace-nowrap",
  {
    variants: {
      variant: {
        success: "bg-success-soft text-success-ink border-success-line",
        info: "bg-info-soft text-info-ink border-info-line",
        warning: "bg-warning-soft text-warning-ink border-warning-line",
        danger: "bg-danger-soft text-danger-ink border-danger-line",
        neutral: "bg-surface-3 text-ink-2 border-border",
        solid: "bg-primary text-white border-primary",
      },
      dot: {
        true: "before:content-[''] before:h-1.5 before:w-1.5 before:rounded-full before:bg-current",
        false: "",
      },
    },
    defaultVariants: { variant: "neutral", dot: true },
  },
);

export interface BadgeProps
  extends React.ComponentPropsWithoutRef<"span">,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, dot, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant, dot }), className)} {...props} />;
}
