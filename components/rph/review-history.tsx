import { Badge } from "@/components/ui/badge";
import { longDateOf } from "@/lib/date";
import type { ReviewNote } from "@/lib/types";

/**
 * The decisions already made on one plan, newest first.
 *
 * Used by the reviewer (to see what they or a previous reviewer said before a
 * resubmission) and by the teacher (to keep older feedback visible after a
 * second return). The plan row already carries the history, so this is a pure
 * render.
 */
export function ReviewHistory({
  reviews,
  title = "Sejarah semakan",
}: {
  reviews?: ReviewNote[] | null;
  title?: string;
}) {
  const notes = reviews ?? [];
  if (notes.length === 0) return null;

  return (
    <div className="mb-3 rounded-[11px] border border-border bg-surface-2 p-3.5">
      <p className="mb-2.5 text-[11px] font-bold tracking-[0.7px] text-ink-4 uppercase">
        {title}
      </p>
      <div className="max-h-56 space-y-2.5 overflow-y-auto pr-1">
        {notes.map((note) => (
          <div
            key={`${note.createdAt}-${note.reviewerName ?? "penyemak"}-${note.grade}`}
            className="border-b border-dashed border-border pb-2.5 last:border-b-0 last:pb-0"
          >
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-[12.5px] font-semibold text-ink">
                {note.reviewerName ?? "Penyemak"}
              </span>
              <span className="text-[11px] text-ink-4">{longDateOf(note.createdAt)}</span>
              <Badge
                variant={note.grade === 1 ? "success" : "danger"}
                className="ml-auto shrink-0"
              >
                {note.grade === 1 ? "Lengkap" : "Dikembalikan"}
              </Badge>
            </div>
            {note.comment?.trim() && (
              <p className="mt-1 whitespace-pre-wrap text-[12px] leading-[1.5] text-ink-3">
                {note.comment}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
