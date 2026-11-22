import type { SignaturePayload } from "@/app/api/rph/[id]/signature/route";
import { ms } from "@/lib/i18n/ms";
import { normalisePayload, type RphPayload } from "@/lib/schemas/rph";
import type { adminDb } from "@/lib/server/db";
import { payloadHash, verifySignature } from "@/lib/signature";
import type { Jawatan } from "@/lib/types";

/**
 * The stored plan, as an export is allowed to describe it.
 *
 * The export route must never take the payload, class, subject, date or
 * signature from the request when a `document_id` names a real row: that turns
 * a statutory copy into whatever the caller typed. This loads the row, checks
 * that it belongs to the caller, and verifies the approval signature in Node
 * before any document is rendered.
 */
export interface ExportDocument {
  id: string;
  schoolId: string;
  ownerId: string;
  status: string;
  version: number;
  payload: RphPayload;
  session: string;
  weekNo: number;
  planDate: string;
  slotTime: string;
  slotTimeEnd: string;
  className: string;
  subjectName: string;
  teacherName: string;
}

export type LoadedExport =
  | { ok: true; doc: ExportDocument; seal: SignaturePayload | null }
  | { ok: false; status: number; error: string };

function jawatanLabel(value: string | null | undefined): string | null {
  if (!value || !(value in ms.jawatan)) return null;
  return ms.jawatan[value as Jawatan];
}

type Db = ReturnType<typeof adminDb>;

export async function loadExportDocument(
  db: Db,
  id: string,
  userId: string,
): Promise<LoadedExport> {
  const { data, error } = await db
    .from("rph_document")
    .select(
      "id, school_id, owner_id, class_ids, subject_code, session, week_no, plan_date, " +
        "slot_time, slot_time_end, status, version, reviewed_by, payload, " +
        "subject:subject_code(nama), owner:owner_id(full_name)",
    )
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    console.error("[export] document read failed:", error.message);
    return { ok: false, status: 500, error: "Ralat pelayan." };
  }
  const row = data as unknown as {
    id: string;
    school_id: string;
    owner_id: string;
    class_ids: string[] | null;
    subject_code: string;
    session: string;
    week_no: number;
    plan_date: string;
    slot_time: string | null;
    slot_time_end: string | null;
    status: string;
    version: number;
    reviewed_by: string | null;
    payload: unknown;
    subject: { nama: string } | null;
    owner: { full_name: string } | null;
  } | null;

  if (!row) return { ok: false, status: 404, error: "RPH tidak dijumpai" };
  if (row.owner_id !== userId) {
    return { ok: false, status: 403, error: "Dokumen bukan milik anda" };
  }

  const ids = row.class_ids ?? [];
  let className = "-";
  if (ids.length > 0) {
    const { data: classes, error: classErr } = await db
      .from("class")
      .select("id, nama")
      .in("id", ids);
    if (classErr) {
      console.error("[export] class read failed:", classErr.message);
      return { ok: false, status: 500, error: "Ralat pelayan." };
    }
    className =
      ((classes ?? []) as { id: string; nama: string }[]).map((c) => c.nama).join(", ") || "-";
  }

  const doc: ExportDocument = {
    id: row.id,
    schoolId: row.school_id,
    ownerId: row.owner_id,
    status: row.status,
    version: row.version,
    payload: normalisePayload(row.payload),
    session: row.session,
    weekNo: row.week_no,
    planDate: row.plan_date,
    slotTime: (row.slot_time ?? "07:30").slice(0, 5),
    slotTimeEnd: (row.slot_time_end ?? "12:40").slice(0, 5),
    className,
    subjectName: row.subject?.nama ?? row.subject_code,
    teacherName: row.owner?.full_name ?? "Guru",
  };

  if (row.status !== "approved") return { ok: true, doc, seal: null };

  const { data: sig, error: sigErr } = await db
    .from("rph_signature")
    .select(
      "envelope, signature, public_key, alg, signed_at, signer_id, " +
        "signer:signer_id(full_name, jawatan)",
    )
    .eq("document_id", id)
    .eq("document_version", row.version)
    .order("signed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (sigErr) {
    console.error("[export] signature read failed:", sigErr.message);
    return { ok: false, status: 500, error: "Ralat pelayan." };
  }
  const signature = sig as unknown as {
    envelope: unknown;
    signature: string;
    public_key: string;
    alg: string;
    signed_at: string;
    signer_id: string;
    signer: { full_name: string; jawatan: string | null } | null;
  } | null;
  if (!signature) {
    return {
      ok: false,
      status: 422,
      error: "RPH disahkan tidak mempunyai tandatangan yang boleh disahkan.",
    };
  }

  const envelope = signature.envelope as {
    doc?: unknown;
    ver?: unknown;
    decision?: unknown;
    hash?: unknown;
  };
  let valid = false;
  try {
    valid =
      envelope.doc === id &&
      envelope.ver === row.version &&
      envelope.decision === "sahkan" &&
      (!row.reviewed_by || signature.signer_id === row.reviewed_by) &&
      envelope.hash === (await payloadHash(doc.payload)) &&
      (await verifySignature(signature.public_key, signature.envelope, signature.signature));
  } catch {
    valid = false;
  }
  if (!valid) {
    console.error("[export] signature failed verification for", id);
    return {
      ok: false,
      status: 422,
      error: "Tandatangan RPH tidak sah atau kandungan telah berubah.",
    };
  }

  return {
    ok: true,
    doc,
    seal: {
      envelope: signature.envelope,
      signature: signature.signature,
      publicKey: signature.public_key,
      alg: signature.alg,
      signedAt: signature.signed_at,
      signerName: signature.signer?.full_name ?? null,
      signerTitle: jawatanLabel(signature.signer?.jawatan),
    },
  };
}
