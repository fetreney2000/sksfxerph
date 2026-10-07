import { cn } from "@/lib/cn";

const TONES = {
  blue: "from-primary to-[#2e7ce0]",
  teal: "from-[#0e9384] to-[#15b79e]",
  plum: "from-[#7a5af8] to-[#9e77ed]",
} as const;

export function Avatar({
  initials,
  tone = "blue",
  small,
  className,
}: {
  initials: string;
  tone?: keyof typeof TONES;
  small?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-full bg-gradient-to-br font-bold text-white",
        TONES[tone],
        small ? "h-7 w-7 text-[10.5px]" : "h-8.5 w-8.5 text-[12px]",
        className,
      )}
      aria-hidden
    >
      {initials}
    </span>
  );
}
