import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/cn";

const buttonVariants = cva(
  // §4.2(9) asks for ≥44px targets: md/lg hit 44/48px. `sm` (40px) is used
  // only for inline row actions, which WCAG 2.2 AA rates at 24px minimum —
  // going to 44 there would inflate every table row.
  "inline-flex items-center justify-center gap-2 rounded-[10px] text-[13.5px] font-semibold transition-colors duration-150 select-none disabled:pointer-events-none disabled:opacity-50 active:translate-y-px whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
  {
    variants: {
      variant: {
        primary: "bg-primary text-white shadow-xs hover:bg-primary-hover",
        secondary:
          "bg-surface text-ink-2 border border-border-strong shadow-xs hover:bg-surface-3",
        ghost: "bg-transparent text-ink-2 hover:bg-surface-3",
        danger:
          "bg-danger-soft text-danger-ink border border-danger-line hover:brightness-[0.97]",
        success: "bg-success text-white shadow-xs hover:brightness-110",
        side: "bg-white/10 text-[#dce6f4] border border-white/15 hover:bg-white/[0.16]",
      },
      size: {
        sm: "h-10 px-3.5 text-[12.5px] rounded-lg",
        md: "h-11 px-4",
        lg: "h-12 px-5 text-[14px] rounded-[10px]",
        icon: "h-11 w-11 p-0",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ComponentPropsWithoutRef<"button">,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
    );
  },
);
Button.displayName = "Button";

export { buttonVariants };
