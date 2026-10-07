import type * as React from "react";
import { cn } from "@/lib/cn";

export function Card({ className, ...props }: React.ComponentPropsWithoutRef<"div">) {
  return (
    <div
      className={cn("rounded-[14px] border border-border bg-surface shadow-sm", className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.ComponentPropsWithoutRef<"div">) {
  return (
    <div
      className={cn("flex items-center gap-3 border-b border-border px-4 py-3.5", className)}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: React.ComponentPropsWithoutRef<"h3">) {
  return (
    <h3 className={cn("text-[14.5px] font-bold tracking-[-0.15px]", className)} {...props} />
  );
}

export function CardDescription({ className, ...props }: React.ComponentPropsWithoutRef<"p">) {
  return <p className={cn("text-xs font-normal text-ink-3", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.ComponentPropsWithoutRef<"div">) {
  return <div className={cn("p-4.5", className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.ComponentPropsWithoutRef<"div">) {
  return (
    <div
      className={cn(
        "flex items-center gap-2.5 border-t border-border bg-surface-2 px-4 py-3 rounded-b-[14px]",
        className,
      )}
      {...props}
    />
  );
}
