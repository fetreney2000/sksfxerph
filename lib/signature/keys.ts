/**
 * Where a reviewer's signing key lives.
 *
 * The private half is generated in their browser and written to this origin's
 * `localStorage`, keyed by user id. It is never sent anywhere: the database
 * receives only the public key, which is what makes the signature the
 * *reviewer's* rather than the server's.
 *
 * ── Why localStorage, and what it costs ──────────────────────────────────────
 * It is readable by any script on this origin, exactly like IndexedDB, so this
 * is device-bound storage — not a hardware enclave. What it does *not* do is
 * weaken the signature: a stolen key lets an attacker sign as that reviewer
 * from that browser, which is the same exposure their session cookie already
 * carries, and the signature still names the reviewer who made it.
 *
 * The consequence worth stating out loud is that clearing site data — which is
 * the tidy way to wipe a demo account off a shared laptop — removes the key
 * with it. Old signatures still verify, because every row carries its own
 * public key; only *new* signing needs a fresh key, and generating one takes a
 * moment with no ceremony.
 *
 * A second device gets its own key. That is not a flaw so much as the honest
 * consequence of not having a CA issue one key per person — and it means two
 * signatures from the same GPK on different laptops legitimately carry
 * different `kid`s.
 */

import type { SigningKeyPair } from "./index";
import { generateSigningKey } from "./index";

const PREFIX = "erph.signkey.";

function store(): Storage | null {
  // Null rather than throwing: this module is imported by server components
  // through the signature index, and `localStorage` does not exist there.
  if (typeof localStorage === "undefined") return null;
  return localStorage;
}

export function loadSigningKey(userId: string): SigningKeyPair | null {
  const raw = store()?.getItem(PREFIX + userId);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { publicKey?: unknown; privateKey?: unknown };
    if (typeof parsed.publicKey === "string" && typeof parsed.privateKey === "string") {
      return { publicKey: parsed.publicKey, privateKey: parsed.privateKey };
    }
    return null;
  } catch {
    // A corrupt entry is indistinguishable from none, and neither is worth
    // throwing over during a review.
    return null;
  }
}

export function saveSigningKey(userId: string, pair: SigningKeyPair): void {
  store()?.setItem(PREFIX + userId, JSON.stringify(pair));
}

export function clearSigningKey(userId: string): void {
  store()?.removeItem(PREFIX + userId);
}

/**
 * The key to sign with, generating one on first use.
 *
 * No ceremony, no enrolment screen: the reviewer is already authenticated, the
 * action is one click, and a school with a handful of GPKs should not be asked
 * to manage key material to approve a lesson plan.
 */
export async function ensureSigningKey(userId: string): Promise<SigningKeyPair> {
  const existing = loadSigningKey(userId);
  if (existing) return existing;
  const pair = await generateSigningKey();
  saveSigningKey(userId, pair);
  return pair;
}
