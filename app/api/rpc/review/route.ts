import { type NextRequest, NextResponse } from "next/server";
import { reviewStageFor } from "@/lib/auth/permissions";
import { requireReviewer } from "@/lib/server/auth/guard";
import { payloadHash, verifySignature } from "@/lib/signature";

/**
 * POST /api/rpc/review — decide a plan: *sahkan* (approve, signed) or
 * *hantar balik* (return to the teacher).
 *
 * GPK and Guru Besar only, enforced here *and* inside the RPC. Which function
 * runs is derived from the role, never from the request. Scope — a GPK may
 * only reach the teachers assigned to them — is checked in SQL by
 * `erph.may_supervise`, which cannot be talked around from this layer.
 *
 * ── Why approval takes three steps instead of one ────────────────────────────
 *
 * `erph.sahkan_rph` accepts no signature, and refuses to approve a plan that
 * does not already have one on file for this exact version and signer. It has
 * to be that way round: PostgreSQL cannot verify an ECDSA signature (pgcrypto,
 * "No support for signing"), so if the signature travelled *inside* the RPC the
 * only check on it would be structural — and a GPK calling PostgREST directly,
 * skipping this handler, would record a signature nobody ever produced.
 *
 * Here instead:
 *   1. the envelope's payload hash is recomputed from the stored payload;
 *   2. the ECDSA signature is verified over the envelope;
 *   3. only then is the row appended — and only this server can append, because
 *      `erph.rph_signature` has no INSERT policy.
 *
 * A caller who skips this handler can still reach `sahkan_rph`, and gets
 * "Tandatangan diperlukan". An approved plan with no signature is therefore a
 * contradiction the schema cannot produce.
 *
 * `hantar_balik` needs no signature: nothing was approved, so there is nothing
 * to attest to.
 */
type Decision = "sahkan" | "hantar_balik";

interface ReviewBody {
  documentId?: string;
  decision?: Decision;
  comment?: string;
  envelope?: Record<string, unknown>;
  signature?: string;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const gate = await requireReviewer(request);
  if ("error" in gate) return gate.error;

  const stage = reviewStageFor(gate.user.role);
  if (!stage) {
    return NextResponse.json({ error: "Peranan penyemak diperlukan" }, { status: 403 });
  }

  let body: ReviewBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON tidak sah" }, { status: 400 });
  }
  if (!body.documentId || (body.decision !== "sahkan" && body.decision !== "hantar_balik")) {
    return NextResponse.json(
      { error: "documentId dan keputusan (sahkan|hantar_balik) diperlukan" },
      { status: 400 },
    );
  }

  const rpc = body.decision === "sahkan" ? stage.approveRpc : stage.returnRpc;

  if (body.decision === "sahkan") {
    const refusal = await verifyAndStore(gate, body.documentId, body.envelope, body.signature);
    if (refusal) return refusal;
  }

  const { data, error } = await gate.db.rpc(rpc, {
    p_document: body.documentId,
    p_comment: body.comment ?? null,
  });

  if (error) {
    console.error("[review] rpc failed:", error.message);
    // The signature row is now an orphan: a signature over a version that was
    // never approved. Harmless — nothing reads it, and a later attempt reuses
    // it if the version still matches — but tidier to take it back.
    if (body.decision === "sahkan") await discardSignature(gate, body.documentId);
    return NextResponse.json({ error: error.message }, { status: 422 });
  }
  return NextResponse.json(data);
}

type Gate = Awaited<ReturnType<typeof requireReviewer>>;

/**
 * Verify the signature, then append it. Returns a refusal to send back, or
 * `null` when the row is on file.
 */
async function verifyAndStore(
  gate: Extract<Gate, { db: unknown }>,
  documentId: string,
  envelope: Record<string, unknown> | undefined,
  signature: string | undefined,
): Promise<NextResponse | null> {
  const refuse = (message: string) => NextResponse.json({ error: message }, { status: 422 });

  if (!envelope || !signature) return refuse("Tandatangan diperlukan");

  const { data, error } = await gate.db
    .from("rph_document")
    .select("id, version, payload, status, owner_id")
    .eq("id", documentId)
    // `.is(…, null)`, not `.eq(…, false)` — `deleted_at` is a timestamptz.
    // PostgREST rejects a boolean against it before the query reaches the
    // database, so every approval answered 500 "Ralat pelayan" from a branch
    // that could not possibly have been the cause. The same mistake was made
    // and fixed in ../rph/[id]/signature; both are the only two places this
    // column is filtered by hand.
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    console.error("[review] document read failed:", error.message);
    return NextResponse.json({ error: "Ralat pelayan." }, { status: 500 });
  }
  const doc = data as {
    id: string;
    version: number;
    payload: unknown;
    status: string;
    owner_id: string;
  } | null;
  if (!doc) return refuse("RPH tidak dijumpai");
  if (doc.status !== "submitted") return refuse("RPH tidak dalam peringkat semakan");

  // The envelope must describe *this* plan, at *this* version, signed by
  // *this* person, about *this* payload. Anything else is a signature over
  // something else, however valid it may be on its own terms.
  const wanted = envelope as {
    v?: unknown;
    alg?: unknown;
    kid?: string;
    doc?: string;
    ver?: number;
    hash?: string;
    signer?: string;
    decision?: string;
    at?: string;
  };

  if (wanted.v !== 1 || wanted.alg !== "ES256")
    return refuse("Buku tandatangan tidak disokong");
  if (wanted.doc !== documentId) return refuse("Tandatangan untuk RPH lain");
  if (wanted.ver !== doc.version) return refuse("Tandatangan untuk versi RPH yang lain");
  if (wanted.signer !== gate.user.id) return refuse("Tandatangan mesti oleh anda sendiri");
  if (wanted.decision !== "sahkan") return refuse("Tandatangan untuk keputusan lain");
  if (typeof wanted.kid !== "string" || typeof wanted.at !== "string") {
    return refuse("Buku tandatangan tidak lengkap");
  }

  // Recompute rather than trust: this is what makes the signature bind the
  // content instead of merely existing beside it.
  const digest = await payloadHash(doc.payload);
  if (wanted.hash !== digest) return refuse("Tandatangan tidak sepadan dengan kandungan RPH");

  if (!(await verifySignature(wanted.kid, envelope, signature))) {
    console.error("[review] signature failed verification for", documentId);
    return refuse("Tandatangan tidak sah");
  }

  // `unique (document_id, document_version, signer_id)` makes a second request
  // for the same decision fail the insert — so a double-click on "Sahkan"
  // reported a 500 while the first request had in fact succeeded, and the
  // reviewer was told an approval had failed when it had gone through.
  //
  // Reusing the row already there is correct rather than permissive: it is the
  // same signer, the same version and the same content we have just verified,
  // and `sahkan_rph` would accept it regardless.
  const { data: existing } = await gate.db
    .from("rph_signature")
    .select("id")
    .eq("document_id", documentId)
    .eq("document_version", doc.version)
    .eq("signer_id", gate.user.id)
    .limit(1)
    .maybeSingle();

  if (existing) return null;

  const { error: insertErr } = await gate.db.from("rph_signature").insert({
    document_id: documentId,
    document_version: doc.version,
    signer_id: gate.user.id,
    alg: "ES256",
    public_key: wanted.kid,
    signature,
    envelope,
  });
  if (insertErr) {
    console.error("[review] signature insert failed:", insertErr.message);
    return NextResponse.json({ error: "Gagal menyimpan tandatangan." }, { status: 500 });
  }

  return null;
}

/**
 * Best-effort removal of a signature row whose approval did not happen.
 *
 * "Best effort" on purpose: this runs on an error path, and a second failure
 * here must not replace the original message the reviewer is shown. The row
 * left behind is inert — `sahkan_rph` ignores signatures for a version it is
 * not approving, and a later attempt re-uses it while the version holds.
 */
async function discardSignature(
  gate: Extract<Gate, { db: unknown }>,
  documentId: string,
): Promise<void> {
  try {
    await gate.db
      .from("rph_signature")
      .delete()
      .eq("document_id", documentId)
      .eq("signer_id", gate.user.id);
  } catch (e) {
    console.error("[review] could not roll back the signature row:", e);
  }
}
