import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** shadcn-style class combiner: clsx for conditionals, twMerge for overrides. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
