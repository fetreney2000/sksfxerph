import { supabaseConfigured } from "@/lib/config";
import { db } from "@/lib/db";

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
