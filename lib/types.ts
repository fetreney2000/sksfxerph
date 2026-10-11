import type { RphPayload } from "@/lib/schemas/rph";

/* ── Mirrors of the enum types in db/schema.sql ────────────────────────────── */

export const MEMBER_ROLES = ["guru_biasa", "gpk", "guru_besar", "pentadbir", "system"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

/**
 * `erph.jawatan` — the office a person holds at the school, printed on the
 * JAWATAN row of the weekly cover sheet.
 *
 * Deliberately not derived from `MemberRole`: the app's roles say what an
 * *account* may do, and three completely different offices ('pk_pentadbiran',
 * 'pk_hem', 'pk_kokum') all live under the single role 'gpk'. Only the school
 * knows which one a given GPK holds, so it is stored and chosen, never
 * inferred — a cover sheet is read by people who have never met the signer.
 * `null` means "not set" and prints as "—".
 */
export const JAWATAN = [
  "guru_biasa",
  "pk_pentadbiran",
  "pk_hem",
  "pk_kokum",
  "guru_besar",
] as const;
export type Jawatan = (typeof JAWATAN)[number];

/**
 * The offices each role may hold — the accounts picker's option list.
 *
 * `erph.jawatan_for` in db/schema.sql is the same table, and it has to stay
 * in step with this one: an option offered here that SQL would refuse shows up
 * as a Malay error out of PostgREST instead of a saved row. `[]` is a real
 * answer, not a placeholder: the pentadbir and system accounts hold no office,
 * so their JAWATAN is "—" and stays that way.
 */
export const JAWATAN_BY_ROLE: Record<MemberRole, readonly Jawatan[]> = {
  guru_biasa: ["guru_biasa"],
  gpk: ["pk_pentadbiran", "pk_hem", "pk_kokum"],
  guru_besar: ["guru_besar"],
  pentadbir: [],
  system: [],
};

export const RPH_STATUSES = [
  "draft",
  "submitted",
  "forwarded",
  "approved",
  "returned",
] as const;
export type RphStatus = (typeof RPH_STATUSES)[number];

export type Curriculum = "KSSR" | "KSSM" | "PRASEKOLAH";
export type TemplateVisibility = "private" | "school" | "system";
export type NotificationType =
  | "deadline"
  | "forwarded"
  | "returned"
  | "approved"
  | "reminder"
  | "system";

/* ── Local (Dexie) records ─────────────────────────────────────────────────── */

/**
 * A lesson plan as stored on-device. Mirrors `rph_document`, plus the
 * offline-sync bookkeeping the server reconstructs from `sync_op`.
 *
 * `id` is minted on the client (crypto.randomUUID) so an offline-created plan
 * keeps its identity when it finally reaches the server.
 */
export interface RphDocument {
  id: string;
  schoolCode: string;
  ownerId: string;
  classId: string;
  className: string;
  subjectCode: string;
  subjectName: string;
  session: string;
  weekNo: number;
  planDate: string; // ISO yyyy-mm-dd
  slotTime: string; // '07:30' — Masa Mula
  /**
   * Masa Tamat. The school's form prints both, so both are stored — a single
   * start time leaves the printed page to invent an end time, which is how a
   * 5-hour lesson ends up on an approved document.
   */
  slotTimeEnd: string; // '12:40'
  status: RphStatus;
  payload: RphPayload;
  version: number;
  clientUpdatedAt: number;
  submittedAt?: number;
  reviewedAt?: number;
  grade?: 0 | 1;
  /**
   * The reviewer's catatan, from the newest `rph_review` row.
   *
   * Carried on the document rather than fetched alongside it because the cover
   * sheet needs it at the same moment it needs the signature — and because a
   * plan that has been returned once already should show the teacher what they
   * were told, not send them back to the queue to find out.
   */
  reviewComment?: string | null;
  /**
   * Who made the newest review decision.
   *
   * Carried alongside `reviewComment` and taken from the same `rph_review`
   * row, so a name can never be shown beside a note that a different person
   * wrote. Absent when nothing has been reviewed yet.
   */
  reviewerName?: string | null;
  createdAt: number;
}

/** One queued mutation waiting for the network. See lib/sync/queue.ts. */
export interface SyncOperation {
  opId: string;
  entity: "rph";
  entityId: string;
  payload: RphDocument;
  clientUpdatedAt: number;
  contentHash: string;
  attempts: number;
  nextAttemptAt: number;
  lastError?: string;
  createdAt: number;
}

export interface SchoolClass {
  id: string;
  nama: string;
  tahun?: number;
  tingkatan?: number;
  session: string;
}

export interface DskpStandard {
  id: number;
  kodSk: string;
  standardKandungan: string;
  kodSp: string;
  standardPembelajaran: string;
  bidang?: string;
}

export interface TeacherNotification {
  id: string;
  type: NotificationType;
  title: string;
  body?: string;
  readAt?: number;
  createdAt: number;
}

/* ── Reference / seed data shapes ──────────────────────────────────────────── */

export interface Subject {
  code: string;
  nama: string;
  curriculum: Curriculum;
}

export interface CalendarWeek {
  weekNo: number;
  startDate: string;
  endDate: string;
  deadline: string; // ISO timestamp
  label?: string;
}

export interface UserProfile {
  id: string;
  fullName: string;
  email: string;
  role: MemberRole;
  title?: string;
  schoolCode: string;
}

/* ── API contracts ─────────────────────────────────────────────────────────── */

export type SyncResultKind = "applied" | "duplicate" | "rejected";

export interface SyncResult {
  opId: string;
  result: SyncResultKind;
  id?: string;
  version?: number;
  status?: RphStatus;
  completeness?: number;
  error?: string;
}

export interface ReviewDecision {
  documentId: string;
  grade: 0 | 1;
  comment?: string;
}
