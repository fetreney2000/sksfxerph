import type { RphPayload } from "@/lib/schemas/rph";

/* ── Mirrors of the enum types in db/schema.sql ────────────────────────────── */

export const MEMBER_ROLES = ["guru_biasa", "gpk", "guru_besar", "pentadbir", "system"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

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
