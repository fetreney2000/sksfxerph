import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { ms } from "@/lib/i18n/ms";
import type { RphStatus } from "@/lib/types";

/**
 * Maps the `rph_status` enum to the KPM-facing label used everywhere in the UI.
 * Grade semantics come from Lampiran 7 of the Garis Panduan: 1 = lengkap,
 * 0 = tidak lengkap.
 */
const MAP: Record<
  RphStatus,
  { label: string; variant: "success" | "info" | "danger" | "neutral" }
> = {
  draft: { label: ms.status.draft, variant: "neutral" },
  submitted: { label: ms.status.submitted, variant: "info" },
  approved: { label: ms.status.approved, variant: "success" },
  returned: { label: ms.status.returned, variant: "danger" },
};

export function StatusBadge({
  status,
  grade,
  className,
}: {
  status: RphStatus;
  grade?: 0 | 1;
  className?: string;
}) {
  const cfg = MAP[status];
  const label =
    status === "approved" && grade === 1
      ? ms.status.approved
      : status === "draft"
        ? ms.status.draft
        : cfg.label;

  return (
    <Badge variant={cfg.variant} className={cn(className)}>
      {label}
    </Badge>
  );
}
