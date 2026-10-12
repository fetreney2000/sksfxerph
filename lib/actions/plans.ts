import { schoolDays } from "@/lib/date";
import { db, findByNaturalKey } from "@/lib/db";
import { ownerId } from "@/lib/owner";
import { currentSession } from "@/lib/session";
import { commit, hasBackend } from "@/lib/sync/queue";
import type { RphDocument, SchoolClass } from "@/lib/types";

const canUseCrypto = typeof crypto !== "undefined" && "randomUUID" in crypto;
const mintId = () => (canUseCrypto ? crypto.randomUUID() : `local-${Date.now()}`);

/**
 * Take a plan out of the archive.
 *
 * Synced: a **soft** delete. `deleted_at` keeps the row — under Peraturan 8 a
 * plan is a statutory record — and every view reads `deleted_at is null`, so it
 * disappears from the app while staying in the database until the retention
 * purge takes it five years later.
 *
 * Local: IndexedDB *is* the only copy, so it is a real delete. There is no
 * record to retain because there is no server holding one, and pretending
 * otherwise would leave a row nobody could ever see or remove.
 *
 * Either way the local copy goes, so the archive stops listing it at once
 * rather than on the next reload.
 */
export async function removePlan(id: string): Promise<void> {
  if (hasBackend()) {
    const res = await fetch(`/api/rph/${encodeURIComponent(id)}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? `Gagal memadam (${res.status})`);
    }
  }
  await db.documents.delete(id);
}

/**
 * "Guna semula minggu lepas" — the single biggest time saving in the product.
 *
 * Clones last week's payloads into this week's empty slots, skipping anything
 * that already has a plan. Teachers write the differences, not the document.
 */
export async function reuseLastWeek(
  fromWeek: number,
  toWeek: number,
  classes: SchoolClass[],
): Promise<number> {
  const session = currentSession();
  // Whose last week this is. Dexie is shared by every account on the browser,
  // so "reuse last week" must read the signed-in teacher's plans — never the
  // last account that happened to sign in here.
  const owner = ownerId();
  const source = await db.documents
    .where("[ownerId+session]")
    .equals([owner, session])
    .filter((d) => d.weekNo === fromWeek)
    .toArray();

  if (source.length === 0) return 0;

  const days = schoolDays(toWeek);
  let created = 0;

  for (const [i, doc] of source.entries()) {
    const targetDate = days[i % days.length];
    if (!targetDate) continue;

    const exists = await findByNaturalKey(
      owner,
      doc.classId,
      doc.subjectCode,
      session,
      toWeek,
      targetDate,
    );
    if (exists) continue;

    const now = Date.now();
    const clone: RphDocument = {
      ...doc,
      id: mintId(),
      session,
      weekNo: toWeek,
      planDate: targetDate,
      status: "draft",
      grade: undefined,
      version: 1,
      reviewedAt: undefined,
      submittedAt: undefined,
      clientUpdatedAt: now,
      createdAt: now,
    };
    // A clone starts from the *plan*, never from last week's review outcome.
    await commit(clone);
    created++;
  }

  // The class list is no longer consulted: a clone keeps the class it was
  // copied from, so there is nothing to choose. Kept in the signature because
  // the caller has it and the next thing that needs it will be another
  // feature on this same screen.
  void classes;
  return created;
}
