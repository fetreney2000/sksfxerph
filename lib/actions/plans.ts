import type { DocumentRow } from "@/app/api/rph/route";
import { supabaseConfigured } from "@/lib/config";
import { schoolDays } from "@/lib/date";
import { db, findByNaturalKey } from "@/lib/db";
import { ownerId } from "@/lib/owner";
import { toLocalPlan } from "@/lib/rph-doc";
import { currentSession } from "@/lib/session";
import type { RphDocument, SchoolClass } from "@/lib/types";

/**
 * Take a plan out of the archive.
 *
 * Synced: a **soft** delete. `deleted_at` keeps the row - under Peraturan 8,
 * Akta Pendidikan 1996 the plan is a record - and every view that reads
 * `deleted_at is null` simply stops showing it, so the archive stops listing
 * it at once rather than on the next reload.
 *
 * Local (development harness only): IndexedDB *is* the only copy, so it is
 * a real delete. There is no record to retain because there is no server
 * holding one.
 */
export async function removePlan(id: string): Promise<void> {
  if (supabaseConfigured) {
    const res = await fetch(`/api/rph/${encodeURIComponent(id)}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? `Gagal memadam (${res.status})`);
    }
    return;
  }
  await db.documents.delete(id);
}

interface ReuseResult {
  created: number;
  skipped: number;
}

/**
 * "Guna semula minggu lepas" - the single biggest time saving in the product.
 *
 * Clones last week's payloads into this week's empty slots, skipping anything
 * that already has a plan. Teachers write the differences, not the document.
 *
 * Synced: each clone is POSTed on its own, and the server answers 409 for
 * slots that filled up since - the count tells how many landed and how many
 * were already taken. Harness: the same duplicate check runs against
 * IndexedDB and the clones are written straight in.
 */
export async function reuseLastWeek(
  fromWeek: number,
  toWeek: number,
  classes: SchoolClass[],
): Promise<ReuseResult> {
  const session = currentSession();
  // Whose last week this is. The harness store is shared by every account on
  // this browser, so "reuse last week" must read the signed-in teacher's
  // plans - never the last account that happened to sign in here.
  const owner = ownerId();
  const source = supabaseConfigured
    ? (await fetchOwnPlans()).filter((d) => d.session === session && d.weekNo === fromWeek)
    : await db.documents
        .where("[ownerId+session]")
        .equals([owner, session])
        .filter((d) => d.weekNo === fromWeek)
        .toArray();

  if (source.length === 0) return { created: 0, skipped: 0 };

  const days = schoolDays(toWeek);
  let created = 0;
  let skipped = 0;

  for (const [i, doc] of source.entries()) {
    const targetDate = days[i % days.length];
    if (!targetDate) continue;

    if (supabaseConfigured) {
      const res = await fetch("/api/rph", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          classIds: doc.classIds,
          subjectCode: doc.subjectCode,
          weekNo: toWeek,
          planDate: targetDate,
          slotTime: doc.slotTime,
          slotTimeEnd: doc.slotTimeEnd,
          payload: doc.payload,
        }),
      });
      // 409 means the slot filled up since the list was read - someone's
      // Tuesday, not an error worth stopping the rest of the week for.
      if (res.status === 409) {
        skipped += 1;
        continue;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Gagal menyalin (${res.status})`);
      }
      created += 1;
      continue;
    }

    const exists = await findByNaturalKey(
      owner,
      doc.classIds,
      doc.subjectCode,
      session,
      toWeek,
      targetDate,
    );
    if (exists) {
      skipped += 1;
      continue;
    }

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
    await db.documents.put(clone);
    created += 1;
  }

  // The class list is no longer consulted: a clone keeps the class it was
  // copied from, so there is nothing to choose. Kept in the signature because
  // the caller has it and the next thing that needs it will be another
  // feature on this same screen.
  void classes;
  return { created, skipped };
}

const canUseCrypto = typeof crypto !== "undefined" && "randomUUID" in crypto;
const mintId = () => (canUseCrypto ? crypto.randomUUID() : `local-${Date.now()}`);

async function fetchOwnPlans(): Promise<RphDocument[]> {
  const res = await fetch("/api/rph", { credentials: "same-origin" });
  if (!res.ok) return [];
  const body = (await res.json()) as { items?: DocumentRow[] };
  return (body.items ?? []).map(toLocalPlan);
}
