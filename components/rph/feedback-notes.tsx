import { longDateOf } from "@/lib/date";
import type { FeedbackNote } from "@/lib/types";

/**
 * Comment-only notes from reviewers. They never changed the plan's status, so
 * they are shown separately from the decision history.
 */
export function FeedbackNotes({
  notes,
  title = "Maklum balas penyemak",
}: {
  notes?: FeedbackNote[] | null;
  title?: string;
}) {
  const items = notes ?? [];
  if (items.length === 0) return null;

  return (
    <div className="mb-3 rounded-[11px] border border-border bg-surface-2 p-3.5">
      <p className="mb-2.5 text-[11px] font-bold tracking-[0.7px] text-ink-4 uppercase">
        {title}
      </p>
      <div className="max-h-56 space-y-2.5 overflow-y-auto pr-1">
        {items.map((note) => (
          <div
            key={`${note.createdAt}-${note.authorName ?? "penyemak"}`}
            className="border-b border-dashed border-border pb-2.5 last:border-b-0 last:pb-0"
          >
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-[12.5px] font-semibold text-ink">
                {note.authorName ?? "Penyemak"}
              </span>
              <span className="text-[11px] text-ink-4">{longDateOf(note.createdAt)}</span>
            </div>
            <p className="mt-1 whitespace-pre-wrap text-[12px] leading-[1.5] text-ink-3">
              {note.comment}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
