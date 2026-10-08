import { db, queueDepth } from "@/lib/db";
import { hashPayload } from "@/lib/sync/hash";
import type { RphDocument, SyncResult } from "@/lib/types";

/**
 * Offline mutation queue.
 *
 * Protocol (erph-backend-research.md §7):
 *   1. Every edit-commit mints one `opId` (crypto.randomUUID) — kept forever so
 *      a retry of the same op is a server-side no-op via `sync_op`.
 *   2. Writes only ever touch Dexie; the network is fire-and-forget.
 *   3. Flush is batched, retried with exponential backoff, and never blocks UI.
 *
 * The server contract is `POST /api/sync` → `{ results: SyncResult[] }`.
 */

const BASE_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 5 * 60_000;

const canUseCrypto = typeof crypto !== "undefined" && "randomUUID" in crypto;
const newId = () => (canUseCrypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

/**
 * Persist a document locally and enqueue it for sync.
 * This is the ONLY write path the editor uses.
 *
 * Writes are funnelled through a single drain so rows can never land out of
 * order: without it, Dexie runs overlapping transactions and a keystroke from
 * a moment ago can overwrite the one after it — the form would save stale text.
 * Only the newest doc is written; intermediate ones are superseded anyway.
 */
let pendingDoc: RphDocument | null = null;
let draining: Promise<void> | null = null;

async function drain(): Promise<void> {
  while (pendingDoc) {
    const doc = pendingDoc;
    pendingDoc = null;
    await writeDocument(doc);
  }
}

export function saveDocument(doc: RphDocument): Promise<void> {
  pendingDoc = doc;
  if (!draining) {
    draining = drain().finally(() => {
      draining = null;
      // Anything that slipped in after the loop's last check still needs a pass.
      if (pendingDoc) void saveDocument(pendingDoc);
    });
  }
  return draining;
}

async function writeDocument(doc: RphDocument): Promise<void> {
  const now = Date.now();

  // Local mode has no queue consumer — flushQueue() clears it on sight — so
  // enqueueing here would be a write followed immediately by a delete on every
  // keystroke, and the depth it produces would make the sync chip advertise
  // work that will never be sent. One put, nothing else.
  if (!hasBackend()) {
    await db.documents.put(doc);
    return;
  }

  const contentHash = hashPayload(doc.payload);

  await db.transaction("rw", db.documents, db.syncQueue, async () => {
    await db.documents.put(doc);

    // Coalesce: if an unsent op already exists for this document, replace it
    // instead of growing the queue on every keystroke-commit.
    const pending = await db.syncQueue.where("entityId").equals(doc.id).first();

    if (pending) {
      await db.syncQueue.update(pending.opId, {
        payload: doc,
        clientUpdatedAt: now,
        contentHash,
        nextAttemptAt: now,
        lastError: undefined,
      });
      return;
    }

    await db.syncQueue.put({
      opId: newId(),
      entity: "rph",
      entityId: doc.id,
      payload: doc,
      clientUpdatedAt: now,
      contentHash,
      attempts: 0,
      nextAttemptAt: now,
      createdAt: now,
    });
  });
}

/** Send everything due. Safe to call from online events, intervals and buttons. */
export async function flushQueue(): Promise<SyncResult[]> {
  // Local mode: there is no remote to sync to, and IndexedDB already *is* the
  // persisted copy. Drain the vestigial queue instead of showing "n belum diselesaikan"
  // to a teacher forever — the chip would otherwise lie about pending work.
  if (!hasBackend()) {
    await db.syncQueue.clear();
    return [];
  }

  if (!isOnline()) return [];

  const now = Date.now();
  const due = await db.syncQueue
    .filter((op) => op.nextAttemptAt <= now)
    .limit(25) // batched so one bad flush can't drain the whole queue
    .toArray();

  if (due.length === 0) return [];

  try {
    // No Authorization header to attach: /api/sync authenticates the httpOnly
    // session cookie, which the browser sends automatically on a same-origin
    // fetch. (There is no Supabase JWT any more — Supabase Auth is not used.)
    const res = await fetch("/api/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        ops: due.map((op) => ({
          op_id: op.opId,
          id: op.entityId,
          entity: op.entity,
          class_id: op.payload.classId,
          subject_code: op.payload.subjectCode,
          session: op.payload.session,
          week_no: op.payload.weekNo,
          plan_date: op.payload.planDate,
          status: op.payload.status,
          payload: op.payload.payload,
          client_updated_at: new Date(op.clientUpdatedAt).toISOString(),
          content_hash: op.contentHash,
        })),
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) throw new Error(`penyegerakan gagal: ${res.status}`);

    const { results } = (await res.json()) as { results: SyncResult[] };
    await reconcile(
      due.map((o) => o.opId),
      results,
    );
    return results;
  } catch (err) {
    await backoff(due, err);
    return [];
  }
}

/** Apply server responses: drop acked ops, bump local versions, flag merges. */
async function reconcile(opIds: string[], results: SyncResult[]): Promise<void> {
  const byOp = new Map(results.map((r) => [r.opId, r]));
  const merges: { localId: string; serverId: string }[] = [];

  await db.transaction("rw", db.syncQueue, db.documents, async () => {
    for (const opId of opIds) {
      const res = byOp.get(opId);
      if (!res) continue;

      const op = await db.syncQueue.get(opId);
      if (res.result === "applied" && res.version !== undefined && op) {
        await db.documents.update(op.entityId, {
          version: res.version,
          status: res.status ?? op.payload.status,
        });

        // The server resolved this write to a DIFFERENT row than we sent —
        // our offline-created plan collided with one already on the server
        // and was merged into it (backend §7: surface this, don't hide it).
        if (res.id && res.id !== op.entityId) {
          merges.push({ localId: op.entityId, serverId: res.id });
        }
      }

      // duplicate/rejected both leave the queue permanently — a rejected op
      // would be rejected forever, so keeping it would block the queue.
      await db.syncQueue.delete(opId);
    }
  });

  if (merges.length > 0) {
    // One notification per flush rather than one per row — a burst of merges
    // after a long offline spell should not bury the teacher in identical
    // alerts. The user-facing message is the point; the ids are for support.
    await db.notifications.add({
      id: newId(),
      type: "system",
      title: "Versi lain dikemas kini",
      body:
        merges.length === 1
          ? "RPH ini wujud dalam pelayan dan telah digabungkan. Semak dokumen untuk memastikan kandungan terkini."
          : `${merges.length} RPH digabungkan dengan versi pelayan. Semak dokumen terjejas.`,
      createdAt: Date.now(),
    });
  }
}

/** Exponential backoff, capped, so a downed server doesn't hammer retries. */
async function backoff(ops: { opId: string; attempts: number }[], err: unknown): Promise<void> {
  for (const op of ops) {
    const attempts = op.attempts + 1;
    const delay = Math.min(BASE_BACKOFF_MS * 2 ** Math.min(attempts, 8), MAX_BACKOFF_MS);
    await db.syncQueue.update(op.opId, {
      attempts,
      nextAttemptAt: Date.now() + delay,
      lastError: err instanceof Error ? err.message : String(err),
    });
  }
}

export const isOnline = () => typeof navigator !== "undefined" && navigator.onLine === true;

/**
 * Local-only mode: no Supabase env configured (see lib/config.ts).
 * The app is fully usable; sync simply never leaves the device.
 */
export const hasBackend = () =>
  process.env.NEXT_PUBLIC_SUPABASE_URL !== undefined &&
  process.env.NEXT_PUBLIC_SUPABASE_URL !== "";

export const pendingCount = queueDepth;

let flushTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Trailing-edge flush, used by `commit()` only when a backend exists.
 *
 * Without it, saving a burst of keystrokes would POST once per character. The
 * `online` event and the 30s interval in providers.tsx are the safety net, so
 * a tab that closes before the timer fires still flushes next session.
 *
 * Deliberately *not* applied to the document write itself: `commit()` must
 * reach Dexie before the next keystroke, because controlled inputs read the
 * row back and an offline edit has to survive an immediate reload (the
 * "offline edit survives a reload" e2e test is exactly that contract).
 */
function scheduleFlush(delayMs = 1000): void {
  if (flushTimer !== undefined) return;
  flushTimer = setTimeout(() => {
    flushTimer = undefined;
    void flushQueue();
  }, delayMs);
}

/** Push a fresh document through the whole path — used by the editor. */
export async function commit(doc: RphDocument): Promise<void> {
  await saveDocument(doc);
  if (hasBackend()) scheduleFlush();
  else void flushQueue();
}
