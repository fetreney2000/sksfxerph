/**
 * The reviewer's side of a decision: sign, then decide.
 *
 * Kept out of the page so the order — envelope, then signature, then the one
 * request that carries both — lives in one place. Reversing it, or sending a
 * signature over a payload the server no longer has, is rejected upstream
 * (the server recomputes the hash from the stored document).
 */

import { type ReviewDecision, reviewRph } from "@/lib/rpc";
import { buildEnvelope, signEnvelope } from "./index";
import { ensureSigningKey } from "./keys";

export type { ReviewDecision };

/**
 * Approve, or send back.
 *
 * An approval is signed with a key this browser already holds, generated on
 * first use. A return is not signed: nothing was approved, so there is nothing
 * to attest to — and requiring a signature there would make the common case,
 * "send this back, it needs work", slower for no assurance.
 */
export async function decide(input: {
  userId: string;
  documentId: string;
  /** `rph_document.version` — the server refuses a signature over another. */
  version: number;
  payload: unknown;
  decision: ReviewDecision;
  comment?: string;
}): Promise<{ ok: boolean; status: string } | null> {
  if (input.decision !== "hantar_balik") {
    const key = await ensureSigningKey(input.userId);
    const envelope = await buildEnvelope({
      documentId: input.documentId,
      version: input.version,
      payload: input.payload,
      signerId: input.userId,
      publicKey: key.publicKey,
    });
    const signature = await signEnvelope(envelope, key.privateKey);
    return reviewRph({
      documentId: input.documentId,
      decision: input.decision,
      comment: input.comment,
      envelope,
      signature,
    });
  }

  return reviewRph({
    documentId: input.documentId,
    decision: input.decision,
    comment: input.comment,
  });
}
