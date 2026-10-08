import { SESSION, schoolCode } from "@/lib/config";
import { schoolDays, todayIso } from "@/lib/date";
import { db, findByNaturalKey } from "@/lib/db";
import { LOCAL_OWNER_ID } from "@/lib/demo/seed";
import { emptyPayload } from "@/lib/schemas/rph";
import { commit } from "@/lib/sync/queue";
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

  const existing = await findByNaturalKey(
    LOCAL_OWNER_ID,
    input.classId,
    subjectCode,
    SESSION,
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
    session: SESSION,
    weekNo: input.weekNo,
    planDate: input.planDate,
    slotTime: input.slotTime,
    status: "draft",
    payload: emptyPayload(),
    version: 1,
    clientUpdatedAt: now,
    createdAt: now,
  };

  await commit(doc);
  return doc;
}

/** Open the most urgent unfinished plan for this week, creating one if needed. */
export async function openDraft(
  weekNo: number,
  classes: SchoolClass[],
): Promise<RphDocument | undefined> {
  const mine = await db.documents
    .where("[ownerId+session]")
    .equals([LOCAL_OWNER_ID, SESSION])
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
  const source = await db.documents
    .where("[ownerId+session]")
    .equals([LOCAL_OWNER_ID, SESSION])
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
      SESSION,
      toWeek,
      targetDate,
    );
    if (exists) continue;

    const now = Date.now();
    const clone: RphDocument = {
      ...doc,
      id: mintId(),
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
