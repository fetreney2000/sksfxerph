import { SESSION, schoolCode } from "@/lib/config";
import { schoolDays } from "@/lib/date";
import { db } from "@/lib/db";
import { emptyPayload, type RphPayload } from "@/lib/schemas/rph";
import type { RphDocument, SchoolClass } from "@/lib/types";

/**
 * Local-mode seed.
 *
 * When Supabase is not configured the app still has to *look* like a real
 * school on Monday morning — otherwise the dashboard, editor and review queue
 * are four empty rectangles and nobody can evaluate the product.
 *
 * Runs once, only when the document store is empty, and never overwrites
 * anything the teacher has actually written.
 */

export const CLASSES: SchoolClass[] = [
  { id: "c-5a", nama: "5 Amanah", tahun: 5, session: SESSION },
  { id: "c-5b", nama: "5 Bidara", tahun: 5, session: SESSION },
  { id: "c-4m", nama: "4 Melur", tahun: 4, session: SESSION },
];

export const SUBJECTS = [
  { code: "MAT", nama: "Matematik", curriculum: "KSSR" as const },
  { code: "BM", nama: "Bahasa Melayu", curriculum: "KSSR" as const },
  { code: "SAIN", nama: "Sains", curriculum: "KSSR" as const },
];

/** A complete plan — completeness = 100, ready to demonstrate the submit gate. */
const completePayload = () => ({
  ...emptyPayload(),
  fasa_tema: "Nombor & Operasi",
  bidang: "Nilai tempat",
  tajuk: "Nombor hingga 100,000",
  standard_kandungan:
    "3.1 Menulis semula nombor hingga 100,000 dalam bentuk angka dan perkataan",
  standard_pembelajaran:
    "3.1.1 Menulis semula nombor hingga 100,000 dalam bentuk angka dan perkataan",
  objektif:
    "Murid dapat menulis semula nombor hingga 100,000 dalam bentuk angka dan perkataan dengan ketepatan 80%.",
  aktiviti: [
    { nama: "Set induksi: slaid nombor harian (harga barang, bilangan penduduk)" },
    { nama: "Mengenal pasti nombor besar dalam kehidupan seharian", sub: true },
    { nama: "Penerangan nilai tempat menggunakan carta digit interaktif" },
    { nama: "Saling mengajar dalam kumpulan; melengkapkan carta", sub: true },
    { nama: "PdPc: agihan lembaran kerja & pemerhatian" },
    { nama: "Menyelesaikan 5 soalan nombor hingga 100,000", sub: true },
    { nama: "Penutup: kuiz pantas \u201cberi contoh nombor 4 angka\u201d" },
  ],
  kriteria_kejayaan:
    "Murid menulis semula nombor hingga 100,000 dengan ketepatan 80% dalam lembaran kerja.",
  refleksi:
    "7 daripada 28 murid keliru dengan nilai \u201cpuluhan\u201d; kebanyakan boleh diperbaiki melalui penerangan berulang.",
});

/**
 * A partial plan — completeness = 25, so the submit gate blocks on it.
 *
 * Only the two DSKP rows are filled. That is deliberate: it is the fixture
 * that proves `submit_rph` refuses an incomplete plan, and a half-filled plan
 * that happens to score 100 would stop proving it the moment the rules change.
 */
const partialPayload = () => ({
  ...emptyPayload(),
  standard_kandungan: "Pecahan setara dan ringkas",
  standard_pembelajaran: "2.4.1 Menyatakan pecahan yang setara",
});

export interface SeedPlan {
  classId: string;
  className: string;
  subjectCode: string;
  subjectName: string;
  dayIndex: number;
  time: string;
  endTime: string;
  status: RphDocument["status"];
  grade?: 0 | 1;
  /**
   * Explicitly `RphPayload`: inferring from the factory's return type made
   * `emk: never[]` (from `emk: []`) widen/collapse differently between the
   * complete and partial variants and broke assignability.
   */
  makePayload: () => RphPayload;
}

const OWNER = "local-teacher";
const OWNER_ID = OWNER;

const PLAN_SEED: SeedPlan[] = [
  {
    classId: "c-5a",
    className: "5 Amanah",
    subjectCode: "MAT",
    subjectName: "Matematik",
    dayIndex: 0,
    time: "07:30",
    endTime: "12:40",
    status: "approved",
    grade: 1,
    makePayload: completePayload,
  },
  {
    classId: "c-4m",
    className: "4 Melur",
    subjectCode: "MAT",
    subjectName: "Matematik",
    dayIndex: 0,
    time: "09:15",
    endTime: "12:40",
    status: "approved",
    grade: 1,
    makePayload: completePayload,
  },
  {
    classId: "c-5a",
    className: "5 Amanah",
    subjectCode: "MAT",
    subjectName: "Matematik",
    dayIndex: 2,
    time: "07:30",
    endTime: "12:40",
    status: "draft",
    makePayload: partialPayload,
  },
  {
    classId: "c-4m",
    className: "4 Melur",
    subjectCode: "MAT",
    subjectName: "Matematik",
    dayIndex: 3,
    time: "09:15",
    endTime: "12:40",
    status: "returned",
    makePayload: partialPayload,
  },
  {
    classId: "c-5b",
    className: "5 Bidara",
    subjectCode: "MAT",
    subjectName: "Matematik",
    dayIndex: 4,
    time: "11:00",
    endTime: "12:40",
    status: "submitted",
    makePayload: completePayload,
  },
];

const canUseCrypto = typeof crypto !== "undefined" && "randomUUID" in crypto;
const mintId = () =>
  canUseCrypto ? crypto.randomUUID() : `seed-${Math.random().toString(36).slice(2)}`;

/** Idempotent: safe to call on every boot. */
export async function seedLocalData(weekNo: number): Promise<void> {
  if (typeof window === "undefined") return;

  const existing = await db.documents.count();
  if (existing > 0) return;

  const days = schoolDays(weekNo);
  const now = Date.now();

  await db.transaction("rw", db.documents, db.classes, async () => {
    await db.classes.bulkPut(CLASSES);

    const docs: RphDocument[] = PLAN_SEED.map((seed, i) => {
      const planDate = days[seed.dayIndex] ?? days[0]!;
      return {
        id: mintId(),
        schoolCode,
        ownerId: OWNER_ID,
        classId: seed.classId,
        className: seed.className,
        subjectCode: seed.subjectCode,
        subjectName: seed.subjectName,
        session: SESSION,
        weekNo,
        planDate,
        slotTime: seed.time,
        slotTimeEnd: seed.endTime,
        status: seed.status,
        payload: seed.makePayload(),
        version: 1,
        clientUpdatedAt: now - (PLAN_SEED.length - i) * 60_000,
        submittedAt: seed.status === "draft" ? undefined : now - i * 3_600_000,
        reviewedAt: seed.grade !== undefined ? now - i * 1_800_000 : undefined,
        grade: seed.grade,
        createdAt: now - (PLAN_SEED.length - i) * 60_000,
      };
    });

    await db.documents.bulkPut(docs);
  });
}

export const LOCAL_OWNER_ID = OWNER_ID;
