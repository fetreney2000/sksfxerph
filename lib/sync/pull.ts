import type { DocumentRow } from "@/app/api/rph/route";
import { schoolCode, supabaseConfigured } from "@/lib/config";
import { db } from "@/lib/db";
import { LOCAL_OWNER_ID } from "@/lib/demo/seed";
import type { RphPayload } from "@/lib/schemas/rph";
import { currentSession } from "@/lib/session";
import type { RphDocument } from "@/lib/types";

/**
 * The other half of sync: pull what the server has.
 *
 * Documents have only ever gone *up*. A teacher who created a plan at school
 * saw an empty archive on their phone, and the signature seal — which is
 * rendered from the local document — could not appear on any machine but the
 * one that wrote it. `flushQueue()` sends; this receives.
 *
 * ## The merge rule is the whole point
 *
 * Anything with a queued mutation is work the server has not seen. Overwriting
 * it would discard exactly the offline edits the queue exists to protect, so
 * those are skipped and the local copy wins until it has been flushed. Only
 * once the queue is clear does the server's version take over.
 *
 * `deleted_at` is honoured too: a plan removed through the app disappears here
 * rather than lingering as a ghost the teacher can open but never submit.
 */

export interface PullResult {
  written: number;
  removed: number;
  /** Plans skipped because this browser has unsent work for them. */
  keptLocal: number;
}

const NOTHING: PullResult = { written: 0, removed: 0, keptLocal: 0 };

/** Fetch the caller's own plans and merge them into IndexedDB. */
export async function pullDocuments(): Promise<PullResult> {
  // Local mode has no remote, and a signed-out shell has no session to read.
  if (!supabaseConfigured || typeof fetch === "undefined") return NOTHING;

  let items: DocumentRow[];
  try {
    const res = await fetch("/api/rph", { credentials: "same-origin" });
    // 401 means the cookie expired mid-session; the app redirects on its own.
    if (!res.ok) return NOTHING;
    items = ((await res.json()) as { items?: DocumentRow[] }).items ?? [];
  } catch {
    // Offline is a normal state here, not an error to report.
    return NOTHING;
  }

  const pending = new Set((await db.syncQueue.toArray()).map((op) => op.entityId));

  let written = 0;
  let removed = 0;
  let keptLocal = 0;

  await db.transaction("rw", db.documents, async () => {
    for (const row of items) {
      if (pending.has(row.id)) {
        keptLocal += 1;
        continue;
      }

      if (row.deleted_at) {
        // Dexie's delete returns nothing, so count it here rather than assume.
        await db.documents.delete(row.id);
        removed += 1;
        continue;
      }

      await db.documents.put(toLocal(row));
      written += 1;
    }
  });

  return { written, removed, keptLocal };
}

/** Server row → the shape every local hook filters on. */
function toLocal(row: DocumentRow): RphDocument {
  return {
    id: row.id,
    schoolCode,
    // The local convention. Dexie's owner is this placeholder in every plan,
    // and the dashboard, archive and editor all filter on `[ownerId+session]`
    // — so a pulled plan with the server's real owner id would be written and
    // then invisible to the very screens that asked for it.
    ownerId: LOCAL_OWNER_ID,
    classId: row.class_id,
    className: row.class?.nama ?? "",
    subjectCode: row.subject_code,
    subjectName: row.subject?.nama ?? "",
    session: row.session || currentSession(),
    weekNo: row.week_no,
    planDate: row.plan_date,
    // `07:30:00` on the server, `07:30` in the document — the editor's time
    // input takes the short form.
    slotTime: (row.slot_time ?? "07:30").slice(0, 5),
    status: row.status as RphDocument["status"],
    payload: row.payload as RphPayload,
    version: row.version,
    clientUpdatedAt: new Date(row.updated_at).getTime(),
    createdAt: new Date(row.created_at).getTime(),
    ...(row.submitted_at ? { submittedAt: new Date(row.submitted_at).getTime() } : {}),
    ...(row.reviewed_at ? { reviewedAt: new Date(row.reviewed_at).getTime() } : {}),
    // Narrowed explicitly: the column is `smallint`, the document type is
    // `0 | 1`, and nothing between the two should be guessed at.
    ...(row.grade === 1 ? { grade: 1 as const } : row.grade === 0 ? { grade: 0 as const } : {}),
  };
}
