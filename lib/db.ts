import Dexie, { type EntityTable } from "dexie";
import type { RphDocument, SchoolClass, SyncOperation, TeacherNotification } from "@/lib/types";

/**
 * The offline source of truth.
 *
 * Every read in the editor goes through Dexie, never straight to Supabase —
 * that is what makes the app usable in a school with patchy connectivity and
 * what keeps it working during the 7-day Supabase free-tier pause.
 *
 * Indexes mirror the SQL natural key so client-side duplicate detection
 * matches `rph_document_uniq` in db/schema.sql.
 */
const db = new Dexie("erph") as Dexie & {
  documents: EntityTable<RphDocument, "id">;
  syncQueue: EntityTable<SyncOperation, "opId">;
  classes: EntityTable<SchoolClass, "id">;
  notifications: EntityTable<TeacherNotification, "id">;
};

db.version(1).stores({
  // Two compound indexes: a short one for "my plans in this session" (used by
  // the dashboard/archive hooks) and the full natural key for duplicate checks.
  documents:
    "id, [ownerId+session], [ownerId+session+weekNo+planDate], classId, status, planDate",
  syncQueue: "opId, entityId, createdAt, nextAttemptAt",
  classes: "id, nama",
  notifications: "id, readAt, createdAt",
});

export { db };

/* ── Small helpers the UI leans on ─────────────────────────────────────────── */

/** Total queued mutations — drives the sync chip's "n belum disegerakkan" label. */
export async function queueDepth(): Promise<number> {
  return db.syncQueue.count();
}

/** Documents needing action for a given week, newest plan date first. */
export async function documentsForWeek(
  ownerId: string,
  session: string,
  weekNo: number,
): Promise<RphDocument[]> {
  const rows = await db.documents
    .where("[ownerId+session]")
    .equals([ownerId, session])
    .filter((d) => d.weekNo === weekNo)
    .toArray();
  return rows.sort((a, b) => (a.planDate < b.planDate ? -1 : a.planDate > b.planDate ? 1 : 0));
}

/** The natural-key lookup used before creating a new plan. */
export async function findByNaturalKey(
  ownerId: string,
  classId: string,
  subjectCode: string,
  session: string,
  weekNo: number,
  planDate: string,
): Promise<RphDocument | undefined> {
  return db.documents
    .where("[ownerId+session+weekNo+planDate]")
    .equals([ownerId, session, weekNo, planDate])
    .and((d) => d.classId === classId && d.subjectCode === subjectCode)
    .first();
}
