import { z } from "zod";

/**
 * eRPH payload — the JSONB `payload` column of `rph_document` (db/schema.sql).
 *
 * `payload_version` exists because KPM changes the form shape between circulars;
 * bump it and add a migration when that happens.
 */
export const PAYLOAD_VERSION = 1;

/* ── Primitive schemas ─────────────────────────────────────────────────────── */

/** A single PdPc activity row (the mini-table inside the RPH paper). */
export const aktivitiSchema = z.object({
  masa: z.string().min(1, "Masa diperlukan"),
  aktiviti_guru: z.string().min(1, "Aktiviti guru diperlukan"),
  aktiviti_murid: z.string().min(1, "Aktiviti murid diperlukan"),
});

export type Aktiviti = z.infer<typeof aktivitiSchema>;

/**
 * The lesson-plan body.
 *
 * Field names are intentionally identical to the SQL generated columns
 * (`standard_kandungan`, `standard_pembelajaran`) so `payload->>'x'` in the
 * schema indexes and the client schema can never drift apart.
 */
export const rphPayloadSchema = z.object({
  payload_version: z.number().int().default(PAYLOAD_VERSION),

  // ── Profil (Step 1) ──
  bilangan_murid: z.number().int().min(0).max(100).optional(),
  fasa_tema: z.string().optional(),

  // ── DSKP (Step 2) ──
  kod_sk: z.string().optional(),
  standard_kandungan: z.string().default(""),
  kod_sp: z.string().optional(),
  standard_pembelajaran: z.string().default(""),
  bidang: z.string().optional(),
  objektif: z.string().default(""),

  // ── PdPc (Step 3) ──
  aktiviti: z.array(aktivitiSchema).default([]),
  emk: z.array(z.string()).default([]),
  kbat: z.string().default(""),

  // ── Refleksi (Step 4) ──
  refleksi: z.string().default(""),
  intervensi: z.string().default(""),
});

export type RphPayload = z.infer<typeof rphPayloadSchema>;

export const emptyPayload = (): RphPayload => rphPayloadSchema.parse({});

/* ── KPM completeness rules ────────────────────────────────────────────────── */

/**
 * Four 25-point checks = 0..100.
 *
 * MUST stay byte-for-byte equivalent to `rph_completeness()` in db/schema.sql —
 * tests/unit/completeness.test.ts runs the same fixtures through both rules so
 * the editor's meter and `submit_rph`'s server gate can never disagree.
 *
 *   1. profil        → standard_kandungan + standard_pembelajaran + objektif
 *   2. aktiviti      → non-empty array whose first row has an aktiviti_guru
 *   3. refleksi      → non-empty
 *   4. intervensi    → non-empty  OR  emk has at least one element
 */
export function completeness(payload: RphPayload): 0 | 25 | 50 | 75 | 100 {
  let score = 0;

  const nonEmpty = (s: string | undefined) => s !== undefined && s.trim() !== "";

  if (
    nonEmpty(payload.standard_kandungan) &&
    nonEmpty(payload.standard_pembelajaran) &&
    nonEmpty(payload.objektif)
  ) {
    score += 25;
  }

  const first = payload.aktiviti[0];
  if (payload.aktiviti.length > 0 && first && nonEmpty(first.aktiviti_guru)) {
    score += 25;
  }

  if (nonEmpty(payload.refleksi)) {
    score += 25;
  }

  if (nonEmpty(payload.intervensi) || payload.emk.length > 0) {
    score += 25;
  }

  return score as 0 | 25 | 50 | 75 | 100;
}

/** Step-level completion flags — drives the stepper and the checklist. */
export function stepStatus(payload: RphPayload) {
  const ne = (s: string) => s.trim() !== "";
  const first = payload.aktiviti[0];
  return {
    profil: ne(payload.standard_kandungan) && ne(payload.standard_pembelajaran),
    dskp:
      ne(payload.standard_kandungan) &&
      ne(payload.standard_pembelajaran) &&
      ne(payload.objektif),
    pdpc:
      payload.aktiviti.length > 0 &&
      !!first &&
      ne(first.aktiviti_guru) &&
      ne(first.aktiviti_murid),
    refleksi: ne(payload.refleksi) && (ne(payload.intervensi) || payload.emk.length > 0),
  } as const;
}

/** KPM FAQ requires all four sections before a clean submit. */
export const isComplete = (p: RphPayload) => completeness(p) === 100;
