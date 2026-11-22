"use client";

import { schoolCode, supabaseConfigured } from "@/lib/config";
import { db } from "@/lib/db";
import { hashPayload } from "@/lib/hash";
import { ownerId } from "@/lib/owner";
import type { WeekCopyCandidate } from "@/lib/week-copy";

/**
 * Write a week's copies, one plan at a time.
 *
 * Sequential on purpose. `POST /api/rph` owns every rule a new plan has to pass
 * - active classes, a real subject, the natural-key clash - and re-implementing
 * them here in a batch insert would be a second opinion the server could
 * disagree with. Doing it one at a time also means a clash on the third plan
 * does not throw away the two that were filed, which is what a teacher with
 * forty plans to file actually needs: a result per plan, not one failure.
 *
 * Nothing is silently skipped. Every candidate comes back with `ok` or the
 * server's own sentence.
 */
export interface WeekCopyResult {
  sourceId: string;
  ok: boolean;
  newId?: string;
  error?: string;
}

export async function copyCandidatesToWeek(
  candidates: readonly WeekCopyCandidate[],
  session: string,
  onProgress?: (done: number, total: number) => void,
): Promise<WeekCopyResult[]> {
  const results: WeekCopyResult[] = [];
  const total = candidates.length;

  for (const [index, candidate] of candidates.entries()) {
    onProgress?.(index, total);
    if (candidate.blocked || candidate.classIds.length === 0) {
      results.push({
        sourceId: candidate.sourceId,
        ok: false,
        error: candidate.conflicts[0] ?? "RPH ini tidak boleh disalin.",
      });
      continue;
    }

    if (!supabaseConfigured) {
      try {
        const now = Date.now();
        const id =
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `local-${now}-${index}`;
        await db.documents.put({
          id,
          schoolCode,
          ownerId: ownerId(),
          classIds: candidate.classIds,
          classNames: candidate.classNames,
          subjectCode: candidate.subjectCode,
          subjectName: candidate.subjectName,
          session,
          weekNo: candidate.weekNo,
          planDate: candidate.planDate,
          slotTime: candidate.slotTime,
          slotTimeEnd: candidate.slotTimeEnd,
          status: "draft",
          payload: candidate.payload,
          version: 1,
          clientUpdatedAt: now,
          createdAt: now,
        });
        results.push({ sourceId: candidate.sourceId, ok: true, newId: id });
      } catch (error) {
        results.push({
          sourceId: candidate.sourceId,
          ok: false,
          error: error instanceof Error ? error.message : "Gagal menyalin RPH.",
        });
      }
      continue;
    }

    try {
      const response = await fetch("/api/rph", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          classIds: candidate.classIds,
          subjectCode: candidate.subjectCode,
          weekNo: candidate.weekNo,
          planDate: candidate.planDate,
          slotTime: candidate.slotTime,
          slotTimeEnd: candidate.slotTimeEnd,
          payload: candidate.payload,
          contentHash: hashPayload(candidate.payload),
        }),
      });
      const body = (await response.json().catch(() => null)) as {
        id?: string;
        error?: string;
      } | null;
      if (!response.ok || !body?.id) {
        results.push({
          sourceId: candidate.sourceId,
          ok: false,
          error: body?.error ?? `Gagal menyalin (HTTP ${response.status}).`,
        });
      } else {
        results.push({ sourceId: candidate.sourceId, ok: true, newId: body.id });
      }
    } catch (error) {
      results.push({
        sourceId: candidate.sourceId,
        ok: false,
        error: error instanceof Error ? error.message : "Ralat rangkaian.",
      });
    }
  }

  onProgress?.(total, total);
  return results;
}
