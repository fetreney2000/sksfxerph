import { schoolCode } from "@/lib/config";
import { schoolDays, todayIso } from "@/lib/date";
import { db, findByNaturalKey } from "@/lib/db";
import { LOCAL_OWNER_ID } from "@/lib/demo/seed";
import { emptyPayload } from "@/lib/schemas/rph";
import { currentSession } from "@/lib/session";
import { commit, hasBackend } from "@/lib/sync/queue";
import type { RphDocument, SchoolClass } from "@/lib/types";

/** Defaults for the seed data; a real deployment reads teaching_assignment. */
const DEFAULT_SUBJECT = { code: "MAT", nama: "Matematik" };

const canUseCrypto = typeof crypto !== "undefined" && "randomUUID" in crypto;
const mintId = () => (canUseCrypto ? crypto.randomUUID() : `local-${Date.now()}`);

export interface NewPlanInput {
  classId: string;
  className: string;
  planDate: string;
  slotTime: string;
  /** Masa Tamat — the printed form shows both, so both are carried. */
  slotTimeEnd: string;
  weekNo: number;
  subjectCode?: string;
  subjectName?: string;
}

/**
 * Create (or return) the plan for a class/subject/date.
 *
 * Idempotent by design: the natural key check mirrors `rph_document_uniq` so a
 * double-tap on "RPH baharu" can never produce two plans for the same lesson.
 */
export async function createPlan(input: NewPlanInput): Promise<RphDocument> {
  const subjectCode = input.subjectCode ?? DEFAULT_SUBJECT.code;
  const subjectName = input.subjectName ?? DEFAULT_SUBJECT.nama;
  // Read per call, not captured at module load: rolling the school year over
  // must take effect on the very next plan, without a reload.
  const session = currentSession();

  const existing = await findByNaturalKey(
    LOCAL_OWNER_ID,
    input.classId,
    subjectCode,
    session,
    input.weekNo,
    input.planDate,
  );
  if (existing) return existing;

  const now = Date.now();
  const doc: RphDocument = {
    id: mintId(),
    schoolCode,
    ownerId: LOCAL_OWNER_ID,
    classId: input.classId,
    className: input.className,
    subjectCode,
    subjectName,
    session,
    weekNo: input.weekNo,
    planDate: input.planDate,
    slotTime: input.slotTime,
    slotTimeEnd: input.slotTimeEnd,
    status: "draft",
    payload: emptyPayload(),
    version: 1,
    clientUpdatedAt: now,
    createdAt: now,
  };

  await commit(doc);
  return doc;
}

/** True when nothing a teacher would recognise as their own work is in it. */
function isBlank(doc: RphDocument): boolean {
  const p = doc.payload;
  const empty = (s?: string) => !s?.trim();
  return (
    empty(p.standard_kandungan) &&
    empty(p.standard_pembelajaran) &&
    empty(p.objektif) &&
    empty(p.kriteria_kejayaan) &&
    empty(p.refleksi) &&
    empty(p.fasa_tema) &&
    empty(p.bidang) &&
    empty(p.tajuk) &&
    p.aktiviti.length === 0
  );
}

const slotKey = (classId: string, subjectCode: string, weekNo: number, planDate: string) =>
  `${classId}|${subjectCode}|${weekNo}|${planDate}`;

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
 * Open a completely new, empty RPH — never a plan that already has content.
 *
 * Two rules make it safe to hang off a button people will tap more than once:
 *
 *  - An untouched blank is reused rather than duplicated, so a double-tap
 *    cannot litter the dashboard with empty drafts — the same idempotency
 *    `createPlan` promises for "RPH baharu".
 *  - Otherwise it claims the next *free* lesson slot. The natural key
 *    (class, subject, session, week, date) is unique by design, so "new" has
 *    to mean a slot nobody has used yet; it spills into later weeks when the
 *    current one is full rather than colliding with `rph_document_uniq`.
 */
export async function createBlankRph(
  weekNo: number,
  classes: SchoolClass[],
): Promise<RphDocument | undefined> {
  const session = currentSession();
  const mine = await db.documents
    .where("[ownerId+session]")
    .equals([LOCAL_OWNER_ID, session])
    .toArray();

  const untouched = mine
    .filter((d) => d.status === "draft" && isBlank(d))
    .sort((a, b) => a.createdAt - b.createdAt)[0];
  if (untouched) return untouched;

  const taken = new Set(
    mine.map((d) => slotKey(d.classId, d.subjectCode, d.weekNo, d.planDate)),
  );

  // Soonest free slot: this week first, staying with a class before moving on.
  for (let w = weekNo; w < weekNo + 8; w++) {
    for (const cls of classes) {
      for (const day of schoolDays(w)) {
        if (taken.has(slotKey(cls.id, DEFAULT_SUBJECT.code, w, day))) continue;
        return createPlan({
          classId: cls.id,
          className: cls.nama,
          planDate: day,
          slotTime: "07:30",
          slotTimeEnd: "12:40",
          weekNo: w,
        });
      }
    }
  }

  return undefined;
}

/** Open the most urgent unfinished plan for this week, creating one if needed. */
export async function openDraft(
  weekNo: number,
  classes: SchoolClass[],
): Promise<RphDocument | undefined> {
  const mine = await db.documents
    .where("[ownerId+session]")
    .equals([LOCAL_OWNER_ID, currentSession()])
    .filter((d) => d.weekNo === weekNo && (d.status === "draft" || d.status === "returned"))
    .toArray();

  const priority = mine.sort((a, b) => (a.planDate < b.planDate ? -1 : 1));
  if (priority[0]) return priority[0];

  const cls = classes[0];
  if (!cls) return undefined;

  const days = schoolDays(weekNo);
  const target = days.find((d) => d >= todayIso()) ?? days[0] ?? todayIso();

  return createPlan({
    classId: cls.id,
    className: cls.nama,
    planDate: target,
    slotTime: "07:30",
    slotTimeEnd: "12:40",
    weekNo,
  });
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
  const source = await db.documents
    .where("[ownerId+session]")
    .equals([LOCAL_OWNER_ID, session])
    .filter((d) => d.weekNo === fromWeek)
    .toArray();

  if (source.length === 0) return 0;

  const days = schoolDays(toWeek);
  let created = 0;

  for (const [i, doc] of source.entries()) {
    const targetDate = days[i % days.length];
    if (!targetDate) continue;

    const exists = await findByNaturalKey(
      LOCAL_OWNER_ID,
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

  void classes;
  return created;
}
