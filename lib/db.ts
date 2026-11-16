import Dexie, { type EntityTable } from "dexie";
import type { RphDocument, SchoolClass, SyncOperation, TeacherNotification } from "@/lib/types";

/**
 * The offline dev harness's store - NOT production storage.
 *
 * Production reads and writes go straight to the API, never here - that
 * is what makes the app work with no offline layer to maintain. This
 * file exists so local development and the e2e suite (which run with no
 * backend) still have a database to read and write: the demo seed and
 * the local accounts' plans. Do not add production reads or writes here.
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

/**
 * One plan may cover several classes (`class_ids uuid[]` on the server, 020),
 * so the scalar `classId`/`className` became the parallel arrays
 * `classIds`/`classNames`. The upgrade maps every stored row in place; the
 * `classId` index is dropped because overlap checks filter in JS on the
 * compound index that remains - Dexie cannot index inside an array.
 */
db.version(2)
  .stores({
    documents: "id, [ownerId+session], [ownerId+session+weekNo+planDate], status, planDate",
  })
  .upgrade(async (tx) => {
    // The scalar fields no longer exist on `RphDocument`, but every row this
    // upgrade runs over was written by the previous version and has exactly
    // them - so the legacy shape is declared here, where it is true.
    type LegacyDoc = RphDocument & { classId?: string; className?: string };
    await tx
      .table("documents")
      .toCollection()
      .modify((doc: LegacyDoc) => {
        if (!Array.isArray(doc.classIds)) {
          doc.classIds = doc.classId ? [doc.classId] : [];
          doc.classNames = doc.className ? [doc.className] : [];
          delete doc.classId;
          delete doc.className;
        }
      });
  });

export { db };

/* ── Small helpers the harness leans on ──────────────────────────────────── */

/**
 * The overlap lookup used before creating a new plan in the dev harness: a
 * duplicate is another live plan with the same subject on the same day that
 * claims *any* of the classes this draft covers - mirroring the overlap check
 * POST /api/rph applies server-side. Disjoint class sets are two different
 * lessons and may coexist.
 */
export async function findByNaturalKey(
  ownerId: string,
  classIds: string[],
  subjectCode: string,
  session: string,
  weekNo: number,
  planDate: string,
): Promise<RphDocument | undefined> {
  return db.documents
    .where("[ownerId+session+weekNo+planDate]")
    .equals([ownerId, session, weekNo, planDate])
    .and(
      (d) =>
        d.subjectCode === subjectCode &&
        Array.isArray(d.classIds) &&
        d.classIds.some((c) => classIds.includes(c)),
    )
    .first();
}
