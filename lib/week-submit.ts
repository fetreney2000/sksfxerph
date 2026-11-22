import type { RphPayload } from "@/lib/schemas/rph";

/**
 * Why a plan cannot be submitted, in the same four parts `completeness()` scores.
 *
 * Mirrors `rph_completeness()` in db/schema.sql: SK+SP, objektif+kriteria, one
 * activity, refleksi. Kept as sentences because the bulk dialog has to tell a
 * teacher *which* plan and *what* is missing, not merely that something is.
 */
export function missingRequirements(payload: RphPayload): string[] {
  const filled = (value: string | undefined) => Boolean(value?.trim());
  const missing: string[] = [];

  if (!filled(payload.standard_kandungan) || !filled(payload.standard_pembelajaran)) {
    missing.push("Standard Kandungan dan Standard Pembelajaran");
  }
  if (!filled(payload.objektif) || !filled(payload.kriteria_kejayaan)) {
    missing.push("Objektif dan Kriteria Kejayaan");
  }
  if (!payload.aktiviti.some((activity) => filled(activity.nama))) {
    missing.push("sekurang-kurangnya satu Aktiviti PdPC");
  }
  if (!filled(payload.refleksi)) {
    missing.push("Refleksi");
  }

  return missing;
}
