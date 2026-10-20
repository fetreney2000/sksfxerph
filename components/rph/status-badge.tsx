import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { ms } from "@/lib/i18n/ms";
import type { RphStatus } from "@/lib/types";

/**
 * Maps the `rph_status` enum to the label teachers see in their lists.
 *
 * The reviewer's grade — 1 = lengkap, 0 = tidak lengkap, per Lampiran 7 — is
 * shown on Semakan where the decision is made. The printed cover keeps its
 * own paper wording ("Lengkap") via `approvedPaper`.
 */
const MAP: Record<
  RphStatus,
  { label: string; variant: "success" | "info" | "danger" | "neutral" }
> = {
  draft: { label: ms.status.draft, variant: "neutral" },
  submitted: { label: ms.status.submitted, variant: "info" },
  forwarded: { label: ms.status.forwarded, variant: "info" },
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
