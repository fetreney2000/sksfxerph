import { z } from "zod";

/**
 * eRPH payload — the JSONB `payload` column of `rph_document` (db/schema.sql).
 *
 * ## This is the school's form, not the KPM circular
 *
 * Shaped against the template the school actually submits — a cover sheet plus
 * one page per plan, with pale-green label cells — rather than the generic KPM
 * RPH. The differences are not cosmetic and they are not mine to keep:
 *
 *   · activities are a **list of names**, some indented as sub-items, not a
 *     timed table of teacher/student actions;
 *   · **Kriteria Kejayaan** is a field and the KPM form has no such section;
 *   · EMK, KBAT, Intervensi, murid berkeperluan khas and the Kod SK/SP codes
 *     are not on the printed form at all, so requiring them would make a
 *     teacher fill in content nobody will ever see.
 *
 * `payload_version` is bumped because of that reshape. Old documents keep their
 * keys — zod strips what it does not know — so nothing written before this
 * change is unreadable, it simply carries less than a new one.
 */
export const PAYLOAD_VERSION = 2;

/* ── Primitive schemas ──────────────────────────────────────────────────── */

/**
 * One entry of "Aktiviti PdPC".
 *
 * A name, optionally an indented sub-item — which is what the printed form
 * does: a heading, then hyphen-prefixed entries beneath it ("Permainan
 * Dalaman" → "- Catur", "- Congkak").
 */
export const aktivitiSchema = z.object({
  nama: z.string().min(1, "Nama aktiviti diperlukan"),
  /**
   * Printed indented behind a hyphen rather than flush. Optional rather than
   * defaulted, so an activity saved before this field existed still parses —
   * every one of them is a top-level entry, which is what `undefined` means.
   */
  sub: z.boolean().optional(),
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

  // ── Profil ───────────────────────────────────────────────────────────────
  // Printed together as the single "Tema/Bidang/Tajuk" row. Kept as three
  // fields rather than one so an existing plan's `fasa_tema` and `bidang`
  // survive the reshape, and a teacher can fill whichever the school uses.
  fasa_tema: z.string().default(""),
  bidang: z.string().default(""),
  tajuk: z.string().default(""),

  // ── DSKP ─────────────────────────────────────────────────────────────────
  standard_kandungan: z.string().default(""),
  standard_pembelajaran: z.string().default(""),
  objektif: z.string().default(""),

  // ── PdPc ─────────────────────────────────────────────────────────────────
  aktiviti: z.array(aktivitiSchema).default([]),
  kriteria_kejayaan: z.string().default(""),

  // ── Refleksi ─────────────────────────────────────────────────────────────
  refleksi: z.string().default(""),
});

export type RphPayload = z.infer<typeof rphPayloadSchema>;

export const emptyPayload = (): RphPayload => rphPayloadSchema.parse({});

/** "Tema/Bidang/Tajuk" is one printed cell; the three parts are joined here. */
export const temaLengkap = (p: RphPayload): string =>
  [p.fasa_tema, p.bidang, p.tajuk]
    // Null-safe: a document read straight out of storage may predate any of
    // these, and the printed cell must still render.
    .map((s) => s?.trim() ?? "")
    .filter(Boolean)
    .join(" / ");

/* ── KPM completeness rules ─────────────────────────────────────────────── */

/**
 * Four 25-point checks = 0..100.
 *
 * MUST stay byte-for-byte equivalent to `rph_completeness()` in db/schema.sql
 * — tests/unit/completeness.test.ts runs the same fixtures through both rules
 * so the editor's meter and `submit_rph`'s server gate can never disagree.
 *
 * The four checkpoints are the four things the printed form cannot be issued
 * without:
 *
 *   1. Standard Kandungan + Standard Pembelajaran
 *   2. Objektif + Kriteria Kejayaan
 *   3. at least one Aktiviti PdPC
 *   4. Refleksi
 */
export function completeness(payload: RphPayload): 0 | 25 | 50 | 75 | 100 {
  let score = 0;

  const nonEmpty = (s: string | undefined) => s !== undefined && s.trim() !== "";

  if (nonEmpty(payload.standard_kandungan) && nonEmpty(payload.standard_pembelajaran)) {
    score += 25;
  }

  if (nonEmpty(payload.objektif) && nonEmpty(payload.kriteria_kejayaan)) {
    score += 25;
  }

  if (payload.aktiviti.some((a) => nonEmpty(a.nama))) {
    score += 25;
  }

  if (nonEmpty(payload.refleksi)) {
    score += 25;
  }

  return score as 0 | 25 | 50 | 75 | 100;
}

/** Step-level completion flags — drives the stepper and the checklist. */
export function stepStatus(payload: RphPayload) {
  const ne = (s: string) => s.trim() !== "";
  return {
    profil: ne(payload.standard_kandungan) && ne(payload.standard_pembelajaran),
    dskp:
      ne(payload.standard_kandungan) &&
      ne(payload.standard_pembelajaran) &&
      ne(payload.objektif),
    pdpc: payload.aktiviti.some((a) => ne(a.nama)) && ne(payload.kriteria_kejayaan),
    refleksi: ne(payload.refleksi),
  } as const;
}

/** The printed form needs all four sections before a clean submit. */
export const isComplete = (p: RphPayload) => completeness(p) === 100;

/* ── Reading old documents ──────────────────────────────────────────────── */

/**
 * Bring a payload read out of storage or off the wire up to the current shape.
 *
 * This exists because zod's defaults only apply if something *parses*, and a
 * document read straight out of Dexie or a JSONB column never does. Without
 * it, every plan written before the school's template reshape crashed the
 * editor on `payload.kriteria_kejayaan.trim()` — a v1 document simply has no
 * such key.
 *
 * Deliberately not `rphPayloadSchema.parse`. The activity schema requires a
 * non-empty name, which is right for *saving* — a teacher should not submit a
 * blank row — but wrong for *reading*: a half-typed activity is work in
 * progress, and failing the whole document to complain about it would trade a
 * crash for data loss. So this reads fields one at a time and never throws.
 *
 * v1 activities are migrated rather than dropped. Their content lived in
 * `aktiviti_guru`; v2 calls it `nama`. An old plan's teacher actions *were*
 * its activity names, so dropping them would turn a filled page into an empty
 * one the next time it printed.
 */
export function normalisePayload(input: unknown): RphPayload {
  const raw = (input ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const rows = Array.isArray(raw.aktiviti) ? raw.aktiviti : [];

  return {
    payload_version:
      typeof raw.payload_version === "number" ? raw.payload_version : PAYLOAD_VERSION,

    fasa_tema: str(raw.fasa_tema),
    bidang: str(raw.bidang),
    tajuk: str(raw.tajuk),

    standard_kandungan: str(raw.standard_kandungan),
    standard_pembelajaran: str(raw.standard_pembelajaran),
    objektif: str(raw.objektif),

    // `nama` first, `aktiviti_guru` as the fallback — rather than branching on
    // `payload_version`, so a plan edited across the change keeps whichever
    // half it actually has. Blank rows are dropped here rather than rejected
    // by zod, for the reason above.
    aktiviti: rows
      .map((a) => {
        const row = (a ?? {}) as Record<string, unknown>;
        return { nama: str(row.nama) || str(row.aktiviti_guru), sub: row.sub === true };
      })
      .filter((a) => a.nama.trim() !== ""),

    kriteria_kejayaan: str(raw.kriteria_kejayaan),
    refleksi: str(raw.refleksi),
  };
}
