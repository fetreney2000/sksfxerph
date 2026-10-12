import { DEMO_OWNER_ID } from "@/lib/config";

/**
 * Whose plans this browser is holding.
 *
 * IndexedDB is shared by every account that signs into the same browser — the
 * school laptop, the shared staff room machine — so "the local owner" cannot
 * be a constant. It was one (`local-teacher`), and that is exactly how one
 * teacher's plans reached another's dashboard: the pull writes the caller's
 * own rows and never deletes one the server did not return, so the previous
 * account's plans stayed under the shared key and the next account read every
 * one of them as its own.
 *
 * It is the signed-in account's id now, set by `UserProvider` as soon as the
 * shell knows who is signed in. Rows are therefore filed per account, and a
 * second teacher signing in sees their own plans and nothing else — the
 * previous teacher's rows stay in the store for when they come back, which is
 * the whole point of an offline cache.
 */

let current: string = DEMO_OWNER_ID;

/** Called by the shell when the signed-in account is known, or changes. */
export function setOwnerId(id: string | null | undefined): void {
  current = id?.trim() ? id : DEMO_OWNER_ID;
}

/** The id every local plan is filed under for this browser's account. */
export function ownerId(): string {
  return current;
}
